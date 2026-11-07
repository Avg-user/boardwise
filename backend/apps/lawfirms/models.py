"""Law firm marketplace.

Firms describe themselves in a LawFirmProfile. Only verified firms that accept new clients are
listed. A worker asks to connect with a MatchRequest (with an optional note). The firm sees only
that note until it accepts; accepting creates a CaseShare, which is what grants access to the case.
"""
from django.conf import settings
from django.contrib.postgres.fields import ArrayField
from django.db import models
from django.db.models import Q
from django.utils import timezone


class PracticeArea(models.TextChoices):
    HARASSMENT = "harassment", "Workplace harassment"
    DISCRIMINATION = "discrimination", "Discrimination and human rights"
    DISMISSAL = "dismissal", "Wrongful or constructive dismissal"
    WAGES = "wages", "Unpaid wages and overtime"
    SAFETY = "safety", "Health and safety"
    WORKERS_COMP = "workers_comp", "Workers' compensation"
    CONTRACTS = "contracts", "Employment contracts"
    OTHER = "other", "Other employment law"


class Language(models.TextChoices):
    EN = "en", "English"
    FR = "fr", "French"
    ES = "es", "Spanish"
    PA = "pa", "Punjabi"
    TL = "tl", "Tagalog"
    ZH = "zh", "Chinese"
    AR = "ar", "Arabic"
    HI = "hi", "Hindi"
    OTHER = "other", "Other"


class LawFirmProfileQuerySet(models.QuerySet):
    def listed(self):
        """What workers can browse: verified, accepting clients, and with the essentials filled in."""
        return self.filter(is_verified=True, accepting_clients=True).exclude(name="").exclude(description="")


class LawFirmProfile(models.Model):
    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="law_firm_profile")

    # About
    name = models.CharField(max_length=200)
    tagline = models.CharField(max_length=160, blank=True)
    description = models.TextField(max_length=4000)
    practice_areas = ArrayField(models.CharField(max_length=30, choices=PracticeArea.choices), default=list)
    languages = ArrayField(models.CharField(max_length=10, choices=Language.choices), default=list)
    provinces = ArrayField(models.CharField(max_length=2), default=list)
    city = models.CharField(max_length=100, blank=True)
    years_in_practice = models.PositiveSmallIntegerField(null=True, blank=True)

    # Fees (all optional; a firm fills in what applies)
    free_consultation = models.BooleanField(default=False)
    consultation_fee = models.DecimalField(max_digits=8, decimal_places=2, null=True, blank=True)
    hourly_rate_min = models.DecimalField(max_digits=8, decimal_places=2, null=True, blank=True)
    hourly_rate_max = models.DecimalField(max_digits=8, decimal_places=2, null=True, blank=True)
    flat_fee_from = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    contingency_percent = models.PositiveSmallIntegerField(null=True, blank=True)
    sliding_scale = models.BooleanField(default=False)
    legal_aid = models.BooleanField(default=False)
    fee_notes = models.TextField(max_length=1000, blank=True)

    # Contact (public once listed)
    website = models.URLField(blank=True)
    email = models.EmailField(blank=True)
    phone = models.CharField(max_length=30, blank=True)

    # Verification: set by Boardwise staff in the admin, never by the firm.
    law_society_number = models.CharField(max_length=50)
    is_verified = models.BooleanField(default=False)
    verified_at = models.DateTimeField(null=True, blank=True)

    accepting_clients = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    objects = LawFirmProfileQuerySet.as_manager()

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return f"LawFirmProfile {self.pk}"


class MatchRequest(models.Model):
    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        ACCEPTED = "accepted", "Accepted"
        DECLINED = "declined", "Declined"
        WITHDRAWN = "withdrawn", "Withdrawn"
        ENDED = "ended", "Ended"

    case = models.ForeignKey("cases.Case", on_delete=models.CASCADE, related_name="match_requests")
    firm = models.ForeignKey(LawFirmProfile, on_delete=models.CASCADE, related_name="match_requests")
    # The only thing the firm sees before accepting. Written by the worker; they choose what to say.
    message = models.TextField(max_length=1000, blank=True)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.PENDING)
    share = models.OneToOneField(
        "cases.CaseShare", null=True, blank=True, on_delete=models.SET_NULL, related_name="match_request"
    )
    created_at = models.DateTimeField(auto_now_add=True)
    responded_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["case", "firm"],
                condition=Q(status__in=["pending", "accepted"]),
                name="unique_open_match_request",
            )
        ]

    def __str__(self):
        return f"MatchRequest {self.pk}"

    def respond(self, status):
        self.status = status
        self.responded_at = timezone.now()
