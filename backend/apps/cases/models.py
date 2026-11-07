from django.conf import settings
from django.db import models
from django.db.models import Q
from django.utils import timezone


class CaseQuerySet(models.QuerySet):
    def accessible_by(self, user):
        """Cases the user owns, or has an active CaseShare grant for."""
        if not user.is_authenticated:
            return self.none()
        return self.filter(
            Q(owner=user)
            | Q(shares__grantee=user, shares__revoked_at__isnull=True)
        ).distinct()


class Case(models.Model):
    class Status(models.TextChoices):
        OPEN = "open", "Open"
        CLOSED = "closed", "Closed"

    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="cases")
    title = models.CharField(max_length=200)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.OPEN)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    objects = CaseQuerySet.as_manager()

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"Case {self.pk}"  # never put titles/content in logs or admin lists

    def can_access(self, user) -> bool:
        if not user.is_authenticated:
            return False
        if self.owner_id == user.pk:
            return True
        return self.shares.filter(grantee=user, revoked_at__isnull=True).exists()


class CaseShare(models.Model):
    """Access grant from the victim (case owner) to an HR or law-firm user."""

    case = models.ForeignKey(Case, on_delete=models.CASCADE, related_name="shares")
    grantee = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="case_shares")
    granted_at = models.DateTimeField(auto_now_add=True)
    revoked_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["case", "grantee"],
                condition=Q(revoked_at__isnull=True),
                name="unique_active_share",
            )
        ]

    def revoke(self):
        self.revoked_at = timezone.now()
        self.save(update_fields=["revoked_at"])


class TimelineEntry(models.Model):
    class Source(models.TextChoices):
        MANUAL = "manual", "Manual"
        AI = "ai", "AI generated"
        DOCUMENT = "document", "From document"

    case = models.ForeignKey(Case, on_delete=models.CASCADE, related_name="timeline")
    occurred_at = models.DateField()
    title = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    source = models.CharField(max_length=20, choices=Source.choices, default=Source.MANUAL)
    document = models.ForeignKey(
        "documents.Document", null=True, blank=True, on_delete=models.SET_NULL, related_name="timeline_entries"
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["occurred_at", "created_at"]
