from rest_framework import serializers

from .models import Conversation, Message


class MessageSerializer(serializers.ModelSerializer):
    class Meta:
        model = Message
        fields = ["id", "role", "content", "flagged_crisis", "created_at"]
        read_only_fields = fields


class ConversationSerializer(serializers.ModelSerializer):
    class Meta:
        model = Conversation
        fields = ["id", "created_at"]
        read_only_fields = fields


class SendMessageSerializer(serializers.Serializer):
    content = serializers.CharField(max_length=8000, trim_whitespace=True)
    province = serializers.RegexField(r"^[A-Z]{2}$", required=False)
    # UI language; the reply is written in it. Region suffixes ("fr-CA") are accepted.
    language = serializers.RegexField(r"^[a-zA-Z]{2}([-_][a-zA-Z]{2})?$", required=False)


class SendMessageResponseSerializer(serializers.Serializer):
    """Docs only. reply is null when the message was flagged as a crisis."""
    user_message = MessageSerializer()
    reply = MessageSerializer(allow_null=True)
    crisis_resources = serializers.CharField(required=False)
