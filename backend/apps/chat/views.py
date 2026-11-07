from rest_framework import mixins, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.cases.permissions import CaseScopedMixin

from .models import Conversation
from .serializers import ConversationSerializer, MessageSerializer


class ConversationViewSet(CaseScopedMixin, mixins.ListModelMixin, mixins.CreateModelMixin,
                          mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    """Conversation history. Sending messages / streaming replies happens over WebSocket (TBD)."""

    serializer_class = ConversationSerializer
    queryset = Conversation.objects.none()

    def get_queryset(self):
        return Conversation.objects.filter(case=self.get_case())

    def perform_create(self, serializer):
        serializer.save(case=self.get_case())

    @action(detail=True, methods=["get"], serializer_class=MessageSerializer, pagination_class=None)
    def messages(self, request, case_pk=None, pk=None):
        convo = self.get_object()
        return Response(MessageSerializer(convo.messages.all(), many=True).data)
