"""Companies, anonymous incident reports, and job offer reviews for HR boards.

Privacy model:
- HR accounts manage a Company. Boardwise staff verify it before workers can pick it or HR
  can see anything, so nobody can claim someone else's company to read its stats.
- A worker picks their company from the list (WorkerMembership) and opts in to reporting.
- An IncidentReport is deliberately unlinkable: no user, no timestamp, random UUID key. Even
  someone with database access can't tell who sent it or when. HR only sees aggregates that
  respect HR_MIN_GROUP_SIZE (see dashboard.py).
"""
import uuid

from django.conf import settings
from django.db import models

from apps.documents.models import private_storage


class IncidentCategory(models.TextChoices):
    HARASSMENT = "harassment", "Harassment or bullying"
    SEXUAL_HARASSMENT = "sexual_harassment", "Sexual harassment"
    DISCRIMINATION = "discrimination", "Discrimination"
    VIOLENCE = "violence", "Violence or threats"
    SAFETY = "safety", "Health and safety"
    PAY = "pay", "Pay, hours or breaks"
    RETALIATION = "retaliation", "Retaliation for speaking up"
    OTHER = "other", "Other"


class CompanyQuerySet(models.QuerySet):
    def listed(self):
        """Companies workers can pick: verified by Boardwise staff."""
        return self.filter(is_verified=True)


class Company(models.Model):
    name = models.CharField(max_length=200)
    province = models.CharField(max_length=2, default="AB")
    city = models.CharField(max_length=100, blank=True)
    # Verification: set by Boardwise staff in the admin, never by HR.
    is_verified = models.BooleanField(default=False)
    verified_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    objects = CompanyQuerySet.as_manager()

    class Meta:
        ordering = ["name"]
        verbose_name_plural = "companies"

    def __str__(self):
        return self.name


class HRMembership(models.Model):
    """An HR account that manages a company. More can be added by staff in the admin."""

    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="hr_membership")
    company = models.ForeignKey(Company, on_delete=models.CASCADE, related_name="hr_members")
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"HR {self.user_id} @ {self.company_id}"


class WorkerMembership(models.Model):
    """A worker's employer, chosen from the list. HR never sees who has joined."""

    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="workplace")
    company = models.ForeignKey(Company, on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    reporting_opt_in = models.BooleanField(default=False)
    # Rate limit that doesn't link reports to the worker: a count per calendar month, nothing else.
    # Kept when the worker leaves or switches company, so leaving and rejoining doesn't reset it.
    report_window = models.DateField(null=True, blank=True)
    reports_in_window = models.PositiveSmallIntegerField(default=0)

    def __str__(self):
        return f"Worker {self.user_id}"


class IncidentReport(models.Model):
    """One anonymous report. No user, no creation time, and a random key so row order says nothing."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    company = models.ForeignKey(Company, on_delete=models.CASCADE, related_name="reports")
    category = models.CharField(max_length=30, choices=IncidentCategory.choices)
    occurred_month = models.DateField(help_text="First day of the month the incident happened.")
    ongoing = models.BooleanField(default=False)

    class Meta:
        indexes = [models.Index(fields=["company", "occurred_month"])]


def offer_upload_path(instance, filename):
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else "bin"
    return f"job_offers/{instance.company_id}/{uuid.uuid4().hex}.{ext}"


class JobOffer(models.Model):
    """A job offer HR uploaded for an AI check against the province's employment law."""

    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        PROCESSING = "processing", "Processing"
        DONE = "done", "Done"
        FAILED = "failed", "Failed"

    company = models.ForeignKey(Company, on_delete=models.CASCADE, related_name="job_offers")
    uploaded_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True)
    title = models.CharField(max_length=255)
    file = models.FileField(upload_to=offer_upload_path, storage=private_storage, blank=True)
    content_type = models.CharField(max_length=100, blank=True)
    text = models.TextField(blank=True)  # pasted, or extracted from the file by the review task
    province = models.CharField(max_length=2)
    class Failure(models.TextChoices):
        NO_TEXT = "no_text", "No text found (e.g. a scanned PDF)"
        UNREADABLE = "unreadable", "File couldn't be read"
        MODEL = "model", "AI model error or empty reply"
        QUEUE = "queue", "Couldn't start the check"
        PARTIAL = "partial", "Some parts couldn't be checked (status stays done)"

    status = models.CharField(max_length=20, choices=Status.choices, default=Status.PENDING)
    failure = models.CharField(max_length=20, choices=Failure.choices, blank=True)
    summary = models.TextField(blank=True)
    findings = models.JSONField(default=list, blank=True)
    # Long offers are checked in parts; these are the 1-based parts the AI didn't answer.
    parts_total = models.PositiveSmallIntegerField(default=0)
    parts_unchecked = models.JSONField(default=list, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    reviewed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"Job offer {self.pk}"
