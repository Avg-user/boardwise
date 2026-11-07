import logging

from django.conf import settings
from django.db import transaction
from drf_spectacular.utils import extend_schema
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import NotFound
from rest_framework.response import Response

from apps.cases.permissions import CaseScopedMixin

from . import llm
from .crisis import CRISIS_RESOURCES, is_crisis
from .models import Conversation, Message
from .scope import is_off_topic, is_off_topic_request, refusal
from .prompts import ProvinceNotFound, check_province, system_prompt
from .serializers import (ConversationSerializer, MessageSerializer, SendMessageResponseSerializer,
                          SendMessageSerializer)

logger = logging.getLogger(__name__)
LANGUAGES = {"en": "English", "fr": "French"}


class ConversationViewSet(CaseScopedMixin, mixins.ListModelMixin, mixins.CreateModelMixin,
                          mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    """Conversation history, plus sending a message (synchronous for now; WebSocket streaming later)."""

    serializer_class = ConversationSerializer
    queryset = Conversation.objects.none()

    def get_queryset(self):
        return Conversation.objects.filter(case=self.get_case())

    def perform_create(self, serializer):
        serializer.save(case=self.get_case())

    @extend_schema(request=SendMessageSerializer, responses={201: SendMessageResponseSerializer})
    @action(detail=True, methods=["get", "post"], pagination_class=None)
    def messages(self, request, case_pk=None, pk=None):
        convo = self.get_object()  # get_case() enforces access; POST is owner-only
        if request.method == "GET":
            return Response(MessageSerializer(convo.messages.all(), many=True).data)

        data = SendMessageSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        content = data.validated_data["content"]
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
            user_msg = Message.objects.create(conversation=convo, role=Message.Role.USER,
                                              content=content, flagged_crisis=True)
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
            return Response({"user_message": MessageSerializer(user_msg).data,
                             "reply": MessageSerializer(reply).data}, status=status.HTTP_201_CREATED)

        # Retrieval may call the embedding model, so it happens after the crisis check.
        prompt = system_prompt(province, query=content)
        prompt += f"\n\nWrite your reply in {language}."
        history = list(convo.messages.exclude(role=Message.Role.SYSTEM)
                       .exclude(flagged_crisis=True).order_by("-created_at")[:settings.CHAT_HISTORY_LIMIT - 1])
        payload = [{"role": "system", "content": prompt}]
        payload += [{"role": m.role, "content": m.content} for m in reversed(history)]
        payload.append({"role": "user", "content": content})

        try:
            completion = llm.chat(payload)
            text = (completion.choices[0].message.content or "").strip()
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
        return Response({"user_message": MessageSerializer(user_msg).data,
                         "reply": MessageSerializer(reply).data}, status=status.HTTP_201_CREATED)
