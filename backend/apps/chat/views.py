import logging

from django.conf import settings
from drf_spectacular.utils import extend_schema
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import NotFound
from rest_framework.response import Response

from apps.cases.permissions import CaseScopedMixin

from . import llm
from .crisis import CRISIS_RESOURCES, is_crisis
from .models import Conversation, Message
from .prompts import ProvinceNotFound, check_province, system_prompt
from .serializers import ConversationSerializer, MessageSerializer, SendMessageSerializer

logger = logging.getLogger(__name__)


class ConversationViewSet(CaseScopedMixin, mixins.ListModelMixin, mixins.CreateModelMixin,
                          mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    """Conversation history, plus sending a message (synchronous for now; WebSocket streaming later)."""

    serializer_class = ConversationSerializer
    queryset = Conversation.objects.none()

    def get_queryset(self):
        return Conversation.objects.filter(case=self.get_case())

    def perform_create(self, serializer):
        serializer.save(case=self.get_case())

    @extend_schema(request=SendMessageSerializer, responses=MessageSerializer(many=True))
    @action(detail=True, methods=["get", "post"], pagination_class=None)
    def messages(self, request, case_pk=None, pk=None):
        convo = self.get_object()  # get_case() enforces access; POST is owner-only
        if request.method == "GET":
            return Response(MessageSerializer(convo.messages.all(), many=True).data)

        data = SendMessageSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        content = data.validated_data["content"]
        province = data.validated_data.get("province") or settings.CHAT_DEFAULT_PROVINCE
        try:
            check_province(province)  # no model calls yet: the crisis check must come first
        except ProvinceNotFound:
            raise NotFound(f"No labour law reference for province '{province}'.")

        # Crisis check runs before any model call. If flagged, we answer with resources only.
        if is_crisis(content):
            user_msg = Message.objects.create(conversation=convo, role=Message.Role.USER,
                                              content=content, flagged_crisis=True)
            reply = Message.objects.create(conversation=convo, role=Message.Role.ASSISTANT,
                                           content=CRISIS_RESOURCES, flagged_crisis=True)
            logger.info("Crisis flagged: conversation=%s message=%s", convo.pk, user_msg.pk)
            return Response(MessageSerializer([user_msg, reply], many=True).data,
                            status=status.HTTP_201_CREATED)

        user_msg = Message.objects.create(conversation=convo, role=Message.Role.USER, content=content)
        try:
            # Retrieval may call the embedding model, so it happens after the crisis check.
            prompt = system_prompt(province, query=content)
        except ProvinceNotFound:
            raise NotFound(f"No labour law reference for province '{province}'.")
        history = list(convo.messages.exclude(role=Message.Role.SYSTEM)
                       .exclude(flagged_crisis=True).order_by("-created_at")[:settings.CHAT_HISTORY_LIMIT])
        payload = [{"role": "system", "content": prompt}]
        payload += [{"role": m.role, "content": m.content} for m in reversed(history)]

        try:
            completion = llm.chat(payload)
            text = (completion.choices[0].message.content or "").strip()
        except Exception as exc:  # never log content, only IDs and the error type
            logger.error("LLM call failed: conversation=%s message=%s error=%s",
                         convo.pk, user_msg.pk, type(exc).__name__)
            return Response({"detail": "The assistant is unavailable right now. Please try again.",
                             "message": MessageSerializer(user_msg).data},
                            status=status.HTTP_502_BAD_GATEWAY)
        if not text:
            logger.error("LLM returned empty reply: conversation=%s", convo.pk)
            return Response({"detail": "The assistant returned an empty reply. Please try again.",
                             "message": MessageSerializer(user_msg).data},
                            status=status.HTTP_502_BAD_GATEWAY)

        reply = Message.objects.create(conversation=convo, role=Message.Role.ASSISTANT, content=text)
        return Response(MessageSerializer([user_msg, reply], many=True).data, status=status.HTTP_201_CREATED)
