from rest_framework import mixins, viewsets
from rest_framework.exceptions import PermissionDenied

from .models import Case, CaseShare, TimelineEntry
from .permissions import CaseScopedMixin
from .serializers import CaseSerializer, CaseShareSerializer, TimelineEntrySerializer


class CaseViewSet(viewsets.ModelViewSet):
    """Cases the current user owns or has been shared. Only victims can create; only owners can edit."""

    serializer_class = CaseSerializer

    def get_queryset(self):
        return Case.objects.accessible_by(self.request.user)

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
