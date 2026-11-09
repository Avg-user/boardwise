from rest_framework import serializers

from apps.hr.models import Company
from apps.lawfirms.models import LawFirmProfile


class StaffFirmSerializer(serializers.ModelSerializer):
    """Everything staff need to check a firm, including the private law society number."""

    account = serializers.CharField(source="user.username", read_only=True)
    verified_by = serializers.CharField(source="verified_by.username", read_only=True, default=None)
    is_listed = serializers.SerializerMethodField()
    missing = serializers.SerializerMethodField(help_text="Profile fields still empty.")

    class Meta:
        model = LawFirmProfile
        fields = ["id", "name", "tagline", "city", "provinces", "practice_areas", "website", "email", "phone",
                  "law_society_number", "accepting_clients", "is_verified", "verified_at", "verified_by",
                  "is_listed", "missing", "account", "created_at", "updated_at"]
        read_only_fields = fields

    def get_is_listed(self, obj) -> bool:
        return obj.is_verified and obj.accepting_clients and bool(obj.name) and bool(obj.description)

    def get_missing(self, obj) -> list[str]:
        return [field for field in ("description", "law_society_number") if not getattr(obj, field)]


class StaffCompanySerializer(serializers.ModelSerializer):
    hr_accounts = serializers.SerializerMethodField()
    verified_by = serializers.CharField(source="verified_by.username", read_only=True, default=None)

    class Meta:
        model = Company
        fields = ["id", "name", "province", "city", "is_verified", "verified_at", "verified_by", "hr_accounts",
                  "created_at"]
        read_only_fields = fields

    def get_hr_accounts(self, obj) -> list[str]:
        return [member.user.username for member in obj.hr_members.all()]
