from django.contrib.auth import get_user_model
from rest_framework import serializers

from .models import Case, CaseShare, TimelineEntry

User = get_user_model()


class CaseSerializer(serializers.ModelSerializer):
    is_owner = serializers.SerializerMethodField()
    # Progress, in the list response only (null elsewhere).
    timeline_count = serializers.IntegerField(read_only=True, default=None)
    tasks_total = serializers.IntegerField(read_only=True, default=None)
    tasks_done = serializers.IntegerField(read_only=True, default=None)
    shared_count = serializers.SerializerMethodField()

    class Meta:
        model = Case
        fields = ["id", "title", "status", "is_owner", "created_at", "updated_at",
                  "timeline_count", "tasks_total", "tasks_done", "shared_count"]
        read_only_fields = ["id", "created_at", "updated_at"]

    def get_is_owner(self, obj) -> bool:
        return obj.owner_id == self.context["request"].user.pk

    def get_shared_count(self, obj) -> int | None:
        # Only the owner learns how many people the case is shared with.
        if not self.get_is_owner(obj):
            return None
        return getattr(obj, "shared_count", None)


class TimelineEntrySerializer(serializers.ModelSerializer):
    class Meta:
        model = TimelineEntry
        fields = ["id", "occurred_at", "title", "description", "source", "document", "conversation", "created_at"]
        # The chat link is set by the server when a chat's first message is saved.
        read_only_fields = ["id", "source", "conversation", "created_at"]

    def validate_document(self, doc):
        if doc and doc.case_id != self.context["case"].pk:
            raise serializers.ValidationError("Document belongs to another case.")
        return doc


class CaseShareSerializer(serializers.ModelSerializer):
    grantee = serializers.SlugRelatedField(
        slug_field="username",
        queryset=User.objects.filter(role__in=[User.Role.HR, User.Role.LAW_FIRM]),
    )
    grantee_role = serializers.CharField(source="grantee.role", read_only=True)

    class Meta:
        model = CaseShare
        fields = ["id", "grantee", "grantee_role", "granted_at", "revoked_at"]
        read_only_fields = ["id", "granted_at", "revoked_at"]

    def validate_grantee(self, user):
        if CaseShare.objects.filter(case=self.context["case"], grantee=user, revoked_at__isnull=True).exists():
            raise serializers.ValidationError("Already shared with this user.")
        return user
