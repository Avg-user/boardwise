from datetime import date

from rest_framework import serializers

from .dashboard import add_months, first_of_month
from .models import Company, IncidentCategory, IncidentReport, JobOffer, WorkerMembership

OFFER_MAX_BYTES = 5 * 1024 * 1024
OFFER_TYPES = ("pdf", "docx", "txt", "md")
REPORT_MONTHS_BACK = 24


class CompanyPublicSerializer(serializers.ModelSerializer):
    class Meta:
        model = Company
        fields = ["id", "name", "province", "city"]


class CompanyOwnSerializer(serializers.ModelSerializer):
    class Meta:
        model = Company
        fields = ["id", "name", "province", "city", "is_verified", "verified_at"]
        read_only_fields = ["id", "is_verified", "verified_at"]

    def validate_province(self, value):
        value = value.upper()
        if not (len(value) == 2 and value.isalpha()):
            raise serializers.ValidationError("Use a two-letter province code, e.g. AB.")
        return value

    def update(self, instance, data):
        # A new name is a new claim: staff check it again before HR sees reports.
        if "name" in data and data["name"].strip() != instance.name:
            instance.is_verified, instance.verified_at = False, None
        return super().update(instance, data)


class WorkplaceSerializer(serializers.ModelSerializer):
    company = serializers.PrimaryKeyRelatedField(queryset=Company.objects.listed(), allow_null=True)
    company_name = serializers.CharField(source="company.name", read_only=True, default=None)

    class Meta:
        model = WorkerMembership
        fields = ["company", "company_name", "reporting_opt_in"]

    def validate(self, attrs):
        company = attrs.get("company", getattr(self.instance, "company", None))
        if attrs.get("reporting_opt_in") and company is None:
            raise serializers.ValidationError({"reporting_opt_in": "Choose your company first."})
        if company is None:
            attrs["reporting_opt_in"] = False
        return attrs


class IncidentReportSerializer(serializers.ModelSerializer):
    # "2026-10" from <input type="month">, or a full date; stored as the first of the month.
    occurred_month = serializers.CharField()

    class Meta:
        model = IncidentReport
        fields = ["category", "occurred_month", "ongoing"]
        extra_kwargs = {"category": {"choices": IncidentCategory.choices}}

    def validate_occurred_month(self, value):
        try:
            month = date.fromisoformat(f"{value[:7]}-01")
        except ValueError:
            raise serializers.ValidationError("Use the format YYYY-MM.")
        this_month = first_of_month(date.today())
        if month > this_month:
            raise serializers.ValidationError("The month can't be in the future.")
        if month < add_months(this_month, -REPORT_MONTHS_BACK):
            raise serializers.ValidationError(f"Reports can go back {REPORT_MONTHS_BACK} months.")
        return month


class DashboardMonthSerializer(serializers.Serializer):
    month = serializers.DateField()
    count = serializers.IntegerField(allow_null=True, help_text="null = hidden because it's too small.")


class DashboardCategorySerializer(serializers.Serializer):
    category = serializers.ChoiceField(choices=IncidentCategory.choices)
    count = serializers.IntegerField(allow_null=True)


class DashboardOngoingSerializer(serializers.Serializer):
    ongoing = serializers.IntegerField(allow_null=True)
    resolved = serializers.IntegerField(allow_null=True)


class DashboardSerializer(serializers.Serializer):
    company = CompanyOwnSerializer()
    min_group_size = serializers.IntegerField()
    window_start = serializers.DateField()
    window_end = serializers.DateField()
    enough_data = serializers.BooleanField()
    total = serializers.IntegerField(allow_null=True)
    months = DashboardMonthSerializer(many=True)
    categories = DashboardCategorySerializer(many=True)
    ongoing = DashboardOngoingSerializer(allow_null=True)


class JobOfferSerializer(serializers.ModelSerializer):
    file = serializers.FileField(write_only=True, required=False)
    text = serializers.CharField(required=False, allow_blank=True, max_length=50000)

    class Meta:
        model = JobOffer
        fields = ["id", "title", "file", "text", "province", "status", "failure", "summary", "findings",
                  "parts_total", "parts_unchecked", "created_at", "reviewed_at"]
        read_only_fields = ["id", "status", "failure", "summary", "findings", "parts_total", "parts_unchecked",
                            "created_at", "reviewed_at"]
        extra_kwargs = {"title": {"required": False}, "province": {"required": False}}

    def to_representation(self, instance):
        data = super().to_representation(instance)
        if self.context.get("view") and self.context["view"].action == "list":
            data.pop("text")  # the list stays light; the detail has the full text
        return data

    def validate_file(self, f):
        ext = f.name.rsplit(".", 1)[-1].lower() if "." in f.name else ""
        if ext not in OFFER_TYPES:
            raise serializers.ValidationError("Upload a PDF, Word (.docx) or text file.")
        if f.size > OFFER_MAX_BYTES:
            raise serializers.ValidationError("The file must be 5 MB or smaller.")
        return f

    def validate(self, attrs):
        if bool(attrs.get("file")) == bool((attrs.get("text") or "").strip()):
            raise serializers.ValidationError("Upload a file or paste the offer text (one of the two).")
        return attrs
