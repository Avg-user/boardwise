import logging

from django.conf import settings
from django.db import IntegrityError, transaction
from django.utils import timezone
from drf_spectacular.utils import extend_schema
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import NotFound
from rest_framework.response import Response

from apps.cases.models import TimelineEntry
from apps.cases.permissions import CaseScopedMixin

from . import llm
from .crisis import CRISIS_RESOURCES, is_crisis
from .models import Conversation, Message
from .scope import OFF_TOPIC_MARKER, is_off_topic, is_off_topic_request, is_workplace_related, refusal
from .prompts import ProvinceNotFound, check_province, system_prompt
from .serializers import (ConversationSerializer, MessageSerializer, SendMessageResponseSerializer,
                          SendMessageSerializer)

logger = logging.getLogger(__name__)
LANGUAGES = {"en": "English", "fr": "French"}


def _ensure_timeline_entry(convo, title, occurred_at):
    """Each chat session is one timeline entry, created with its first saved message (or its next
    one, if the entry was deleted). Call inside the transaction that saves the message."""
    if TimelineEntry.objects.filter(conversation=convo).exists():
        return
    try:
        with transaction.atomic():  # savepoint: a concurrent send may have just created it
            TimelineEntry.objects.create(case_id=convo.case_id, conversation=convo, title=title,
                                         occurred_at=occurred_at)
    except IntegrityError:
        pass


def _drop_old_replies(newest_first: list[Message], keep: int) -> list[Message]:
    """Keep every user message but only the `keep` newest assistant replies. The user's messages
    hold the facts; old replies mostly carry the model's own earlier mistakes, and cost tokens."""
    out, replies = [], 0
    for m in newest_first:
        if m.role == Message.Role.ASSISTANT:
            replies += 1
            if replies > keep:
                continue
        out.append(m)
    return out


class ConversationViewSet(CaseScopedMixin, mixins.ListModelMixin, mixins.CreateModelMixin,
                          mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    """Conversation history, plus sending a message (synchronous for now; WebSocket streaming later)."""

    serializer_class = ConversationSerializer
    queryset = Conversation.objects.none()

    def get_queryset(self):
        return Conversation.objects.filter(case=self.get_case()).select_related("timeline_entry")

    @transaction.atomic
    def perform_create(self, serializer):
        # Only one chat is open per case: starting a new one closes the others.
        case = self.get_case()
        Conversation.objects.filter(case=case, closed_at__isnull=True).update(closed_at=timezone.now())
        serializer.save(case=case)

    @extend_schema(request=None, responses=ConversationSerializer)
    @action(detail=True, methods=["post"])
    def close(self, request, case_pk=None, pk=None):
        """Close a chat (owner only). It stays readable; new messages are refused. Idempotent."""
        convo = self.get_object()
        if convo.closed_at is None:
            convo.closed_at = timezone.now()
            convo.save(update_fields=["closed_at"])
        return Response(self.get_serializer(convo).data)

    @extend_schema(request=SendMessageSerializer, responses={201: SendMessageResponseSerializer})
    @action(detail=True, methods=["get", "post"], pagination_class=None)
    def messages(self, request, case_pk=None, pk=None):
        convo = self.get_object()  # get_case() enforces access; POST is owner-only
        if request.method == "GET":
            return Response(MessageSerializer(convo.messages.all(), many=True).data)

        data = SendMessageSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        content = data.validated_data["content"]
        if convo.closed_at is not None:
            body = {"detail": "This chat is closed. Start a new chat to keep going."}
            if is_crisis(content):  # still point someone in danger to help
                body["crisis_resources"] = CRISIS_RESOURCES
            return Response(body, status=status.HTTP_409_CONFLICT)
        entry = (data.validated_data.get("entry_title") or "Chat session",
                 data.validated_data.get("entry_date") or timezone.now().date())
        province = data.validated_data.get("province") or settings.CHAT_DEFAULT_PROVINCE
        language_code = data.validated_data.get("language", "en")[:2].lower()
        if language_code not in LANGUAGES:
            language_code = "en"
        language = LANGUAGES[language_code]
        try:
            check_province(province)  # no model calls yet: the crisis check must come first
        except ProvinceNotFound:
            raise NotFound(f"No labour law reference for province '{province}'.")

        # Crisis check runs before any model call. The message is saved (flagged) so the UI keeps
        # showing resources, but it is never sent to a model. The UI renders its own translated
        # resources; crisis_resources is for API clients without one.
        if is_crisis(content):
            with transaction.atomic():
                user_msg = Message.objects.create(conversation=convo, role=Message.Role.USER,
                                                  content=content, flagged_crisis=True)
                _ensure_timeline_entry(convo, *entry)
            logger.info("Crisis flagged: conversation=%s message=%s", convo.pk, user_msg.pk)
            return Response({"user_message": MessageSerializer(user_msg).data, "reply": None,
                             "crisis_resources": CRISIS_RESOURCES}, status=status.HTTP_201_CREATED)

        # Obvious off-topic requests are refused without any model call.
        if is_off_topic_request(content):
            logger.info("Off-topic request refused before model: conversation=%s", convo.pk)
            with transaction.atomic():
                user_msg = Message.objects.create(conversation=convo, role=Message.Role.USER, content=content)
                reply = Message.objects.create(conversation=convo, role=Message.Role.ASSISTANT,
                                               content=refusal(language_code))
                _ensure_timeline_entry(convo, *entry)
            return Response({"user_message": MessageSerializer(user_msg).data,
                             "reply": MessageSerializer(reply).data}, status=status.HTTP_201_CREATED)

        # Retrieval may call the embedding model, so it happens after the crisis check.
        prompt = system_prompt(province, query=content)
        prompt += f"\n\nWrite your reply in {language}."
        history = list(convo.messages.exclude(role=Message.Role.SYSTEM)
                       .exclude(flagged_crisis=True).order_by("-created_at")[:settings.CHAT_HISTORY_LIMIT - 1])
        history = _drop_old_replies(history, settings.CHAT_HISTORY_ASSISTANT_TURNS)
        payload = [{"role": "system", "content": prompt}]
        payload += [{"role": m.role, "content": m.content} for m in reversed(history)]
        payload.append({"role": "user", "content": content})

        try:
            completion = llm.chat(payload, temperature=settings.CHAT_TEMPERATURE)
            text = (completion.choices[0].message.content or "").strip()
            # Small models sometimes call a real workplace-law question off-topic because the
            # reference doesn't cover it. Ask once more before refusing.
            if OFF_TOPIC_MARKER in text and is_workplace_related(content):
                logger.info("Off-topic marker on a workplace question, retrying: conversation=%s", convo.pk)
                retry = payload + [{"role": "system", "content": (
                    "This question is about work or workplace law, so it is on-topic. Answer it. If the "
                    "reference doesn't cover it, say so and point to the right office."
                )}]
                text = (llm.chat(retry, temperature=settings.CHAT_TEMPERATURE).choices[0].message.content
                        or "").strip()
        except Exception as exc:  # never log content, only IDs and the error type
            logger.error("LLM call failed: conversation=%s error=%s", convo.pk, type(exc).__name__)
            text = ""
        if not text:
            # Nothing is saved, so the client can resend the same message without duplicates.
            return Response({"detail": "The assistant is unavailable right now. Please try again."},
                            status=status.HTTP_502_BAD_GATEWAY)

        if is_off_topic(text):
            logger.info("Off-topic request refused: conversation=%s", convo.pk)
            text = refusal(language_code)

        with transaction.atomic():
            user_msg = Message.objects.create(conversation=convo, role=Message.Role.USER, content=content)
            reply = Message.objects.create(conversation=convo, role=Message.Role.ASSISTANT, content=text)
            _ensure_timeline_entry(convo, *entry)
        return Response({"user_message": MessageSerializer(user_msg).data,
                         "reply": MessageSerializer(reply).data}, status=status.HTTP_201_CREATED)
