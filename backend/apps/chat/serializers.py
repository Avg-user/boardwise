from django.utils import timezone
from rest_framework import serializers

from .models import Conversation, Message


class MessageSerializer(serializers.ModelSerializer):
    class Meta:
        model = Message
        fields = ["id", "role", "content", "flagged_crisis", "created_at"]
        read_only_fields = fields


class ConversationSerializer(serializers.ModelSerializer):
    timeline_entry = serializers.SerializerMethodField(help_text="The chat's timeline entry, once it has one.")

    class Meta:
        model = Conversation
        fields = ["id", "created_at", "closed_at", "timeline_entry"]
        read_only_fields = fields

    def get_timeline_entry(self, obj) -> int | None:
        entry = getattr(obj, "timeline_entry", None)  # reverse one-to-one: missing raises, getattr catches
        return entry.pk if entry else None


class SendMessageSerializer(serializers.Serializer):
    content = serializers.CharField(max_length=8000, trim_whitespace=True)
    province = serializers.RegexField(r"^[A-Z]{2}$", required=False)
    # UI language; the reply is written in it. Region suffixes ("fr-CA") are accepted.
    language = serializers.RegexField(r"^[a-zA-Z]{2}([-_][a-zA-Z]{2})?$", required=False)
    # For the chat's timeline entry, created with its first saved message: a title in the
    # person's language and their local date (the server runs on UTC).
    entry_title = serializers.CharField(max_length=200, required=False, trim_whitespace=True)
    entry_date = serializers.DateField(required=False)

    def validate_entry_date(self, value):
        today = timezone.now().date()
        if abs((value - today).days) > 1:
            raise serializers.ValidationError("Use today's date.")
        return value


class SendMessageResponseSerializer(serializers.Serializer):
    """Docs only. reply is null when the message was flagged as a crisis."""
    user_message = MessageSerializer()
    reply = MessageSerializer(allow_null=True)
    crisis_resources = serializers.CharField(required=False)
