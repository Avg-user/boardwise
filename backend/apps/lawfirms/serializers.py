from rest_framework import serializers

from .models import FirmMessage, FirmThread, LawFirmProfile, MatchRequest

PUBLIC_FIELDS = [
    "id", "name", "tagline", "description", "practice_areas", "languages", "provinces", "city",
    "years_in_practice", "free_consultation", "consultation_fee", "hourly_rate_min", "hourly_rate_max",
    "flat_fee_from", "contingency_percent", "sliding_scale", "legal_aid", "fee_notes",
    "website", "email", "phone", "is_verified",
]


class LawFirmPublicSerializer(serializers.ModelSerializer):
    """What workers see in the directory. No law society number, no account details."""

    class Meta:
        model = LawFirmProfile
        fields = PUBLIC_FIELDS
        read_only_fields = PUBLIC_FIELDS


class LawFirmOwnSerializer(serializers.ModelSerializer):
    """The firm editing its own profile."""

    is_listed = serializers.SerializerMethodField()

    class Meta:
        model = LawFirmProfile
        fields = PUBLIC_FIELDS + ["law_society_number", "verified_at", "accepting_clients", "is_listed",
                                  "created_at", "updated_at"]
        read_only_fields = ["id", "is_verified", "verified_at", "is_listed", "created_at", "updated_at"]

    def get_is_listed(self, obj):
        return LawFirmProfile.objects.listed().filter(pk=obj.pk).exists()

    def validate_provinces(self, value):
        value = [p.strip().upper() for p in value]
        if any(len(p) != 2 or not p.isalpha() for p in value):
            raise serializers.ValidationError("Use two-letter province codes, for example AB.")
        return sorted(set(value))

    def validate_practice_areas(self, value):
        return sorted(set(value))

    def validate_languages(self, value):
        return sorted(set(value))

    def validate_contingency_percent(self, value):
        if value is not None and value > 50:
            raise serializers.ValidationError("Enter a percentage between 0 and 50.")
        return value

    def validate(self, attrs):
        lo = attrs.get("hourly_rate_min", getattr(self.instance, "hourly_rate_min", None))
        hi = attrs.get("hourly_rate_max", getattr(self.instance, "hourly_rate_max", None))
        if lo is not None and hi is not None and lo > hi:
            raise serializers.ValidationError({"hourly_rate_max": "The maximum must be at least the minimum."})
        return attrs

    def update(self, instance, data):
        # A new law society number needs to be checked again before the firm is listed.
        number = data.get("law_society_number")
        if number is not None and number.strip() != instance.law_society_number:
            instance.unverify(save=False)
        return super().update(instance, data)


class CaseMatchRequestSerializer(serializers.ModelSerializer):
    """The worker's view of requests on one of their cases."""

    firm = serializers.PrimaryKeyRelatedField(queryset=LawFirmProfile.objects.listed())
    firm_name = serializers.CharField(source="firm.name", read_only=True)

    class Meta:
        model = MatchRequest
        fields = ["id", "firm", "firm_name", "message", "status", "created_at", "responded_at"]
        read_only_fields = ["id", "status", "created_at", "responded_at"]

    def validate_firm(self, firm):
        case = self.context["case"]
        if MatchRequest.objects.filter(case=case, firm=firm, status__in=["pending", "accepted"]).exists():
            raise serializers.ValidationError("You already have an open request with this firm for this case.")
        return firm


class FirmMatchRequestSerializer(serializers.ModelSerializer):
    """The firm's view of an incoming request. The case stays hidden until the firm accepts."""

    case_id = serializers.SerializerMethodField()
    case_title = serializers.SerializerMethodField()

    class Meta:
        model = MatchRequest
        fields = ["id", "message", "status", "created_at", "responded_at", "case_id", "case_title"]
        read_only_fields = fields

    def _shared(self, obj):
        return obj.status == MatchRequest.Status.ACCEPTED and obj.share and obj.share.revoked_at is None

    def get_case_id(self, obj):
        return obj.case_id if self._shared(obj) else None

    def get_case_title(self, obj):
        return obj.case.title if self._shared(obj) else None


# --- Messages between workers and firms -------------------------------------------------------

class FirmMessageSerializer(serializers.ModelSerializer):
    mine = serializers.SerializerMethodField()

    class Meta:
        model = FirmMessage
        fields = ["id", "sender", "body", "created_at", "mine"]
        read_only_fields = fields

    def get_mine(self, obj) -> bool:
        return obj.sender == self.context["side"]


class FirmThreadSerializer(serializers.ModelSerializer):
    """The firm sees no worker identity: no username, no ID, only what the worker wrote."""

    firm_name = serializers.CharField(source="firm.name", read_only=True)
    unread = serializers.BooleanField(read_only=True, default=False)
    last_message = serializers.SerializerMethodField()

    class Meta:
        model = FirmThread
        fields = ["id", "firm", "firm_name", "subject", "created_at", "last_message_at", "unread", "last_message"]
        read_only_fields = fields

    def get_last_message(self, obj) -> dict | None:
        last = obj.messages.order_by("-created_at").first()
        if last is None:
            return None
        return {"sender": last.sender, "preview": last.body[:160], "mine": last.sender == self.context["side"]}


class FirmThreadDetailSerializer(FirmThreadSerializer):
    messages = serializers.SerializerMethodField()
    can_reply = serializers.SerializerMethodField()

    class Meta(FirmThreadSerializer.Meta):
        fields = FirmThreadSerializer.Meta.fields + ["messages", "can_reply"]
        read_only_fields = fields

    def get_messages(self, obj) -> list[dict]:
        return FirmMessageSerializer(obj.messages.all(), many=True, context=self.context).data

    def get_can_reply(self, obj) -> bool:
        # A firm that has lost its verification can't keep writing to workers.
        return self.context["side"] == "worker" or obj.firm.is_verified


class StartThreadSerializer(serializers.Serializer):
    firm = serializers.PrimaryKeyRelatedField(queryset=LawFirmProfile.objects.listed())
    subject = serializers.CharField(max_length=200, trim_whitespace=True)
    body = serializers.CharField(max_length=5000, trim_whitespace=True)


class ReplySerializer(serializers.Serializer):
    body = serializers.CharField(max_length=5000, trim_whitespace=True)
