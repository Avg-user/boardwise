from django.db.models import Count, IntegerField, OuterRef, Subquery
from django.db.models.functions import Coalesce
from rest_framework import mixins, viewsets
from rest_framework.exceptions import PermissionDenied

from apps.tasks.models import Task

from .models import Case, CaseShare, TimelineEntry
from .permissions import CaseScopedMixin
from .serializers import CaseSerializer, CaseShareSerializer, TimelineEntrySerializer


def _count(related_qs):
    """Rows of `related_qs` belonging to the outer case, as an integer (0 when none)."""
    counts = related_qs.filter(case=OuterRef("pk")).order_by().values("case").annotate(n=Count("pk")).values("n")
    return Coalesce(Subquery(counts, output_field=IntegerField()), 0)


class CaseViewSet(viewsets.ModelViewSet):
    """Cases the current user owns or has been shared. Only victims can create; only owners can edit."""

    serializer_class = CaseSerializer

    def get_queryset(self):
        qs = Case.objects.accessible_by(self.request.user)
        if self.action == "list":
            # Progress for the My issues cards. Subqueries, not Count(): accessible_by joins
            # shares, and a join there would multiply or filter the counts.
            qs = qs.annotate(
                timeline_count=_count(TimelineEntry.objects.all()),
                tasks_total=_count(Task.objects.all()),
                tasks_done=_count(Task.objects.filter(done=True)),
                shared_count=_count(CaseShare.objects.filter(revoked_at__isnull=True)),
            )
        return qs

    def perform_create(self, serializer):
        if self.request.user.role != "victim":
            raise PermissionDenied("Only victims can create cases.")
        serializer.save(owner=self.request.user)

    def check_object_permissions(self, request, obj):
        super().check_object_permissions(request, obj)
        if request.method not in ("GET", "HEAD", "OPTIONS") and obj.owner_id != request.user.pk:
            raise PermissionDenied("Only the case owner can modify this case.")


class CaseChildViewSet(CaseScopedMixin, viewsets.ModelViewSet):
    model = None

    def get_queryset(self):
        return self.model.objects.filter(case=self.get_case())

    def get_serializer_context(self):
        ctx = super().get_serializer_context()
        if "case_pk" in self.kwargs:
            ctx["case"] = self.get_case()
        return ctx

    def perform_create(self, serializer):
        serializer.save(case=self.get_case())


class TimelineEntryViewSet(CaseChildViewSet):
    model = TimelineEntry
    serializer_class = TimelineEntrySerializer
    queryset = TimelineEntry.objects.none()  # for schema generation


class CaseShareViewSet(CaseScopedMixin, mixins.ListModelMixin, mixins.CreateModelMixin,
                       mixins.DestroyModelMixin, viewsets.GenericViewSet):
    """Owner-only: grant or revoke HR / law-firm access. DELETE revokes (keeps the record)."""

    serializer_class = CaseShareSerializer
    queryset = CaseShare.objects.none()

    def get_queryset(self):
        case = self.get_case()
        if case.owner_id != self.request.user.pk:
            raise PermissionDenied("Only the case owner can manage sharing.")
        return case.shares.filter(revoked_at__isnull=True).select_related("grantee")

    def get_serializer_context(self):
        ctx = super().get_serializer_context()
        if "case_pk" in self.kwargs:
            ctx["case"] = self.get_case()
        return ctx

    def perform_create(self, serializer):
        self.get_queryset()  # owner check
        serializer.save(case=self.get_case())

    def perform_destroy(self, instance):
        instance.revoke()
        # A share created by accepting a marketplace request ends that match too.
        instance_request = getattr(instance, "match_request", None)
        if instance_request is not None and instance_request.status == "accepted":
            instance_request.respond("ended")
            instance_request.save()
