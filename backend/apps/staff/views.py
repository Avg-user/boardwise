"""Staff tools: verify law firms and HR companies without the Django admin.

Staff are Django staff users (is_staff). Nothing here exposes cases, chats, reports or messages:
only the accounts and profiles staff need to check.
"""
import logging

from django.contrib.auth import get_user_model
from django.db.models import Count, Q
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import mixins, viewsets
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.permissions import IsAdminUser
from rest_framework.response import Response

from apps.hr.models import Company
from apps.lawfirms.models import LawFirmProfile

from .serializers import StaffCompanySerializer, StaffFirmSerializer

logger = logging.getLogger(__name__)
STATUS_PARAM = OpenApiParameter("status", str, enum=["pending", "verified", "all"], description="Default: pending")


def _by_status(qs, request):
    status = request.query_params.get("status", "pending")
    if status == "pending":
        return qs.filter(is_verified=False)
    if status == "verified":
        return qs.filter(is_verified=True)
    return qs


@extend_schema(responses={200: dict})
@api_view(["GET"])
@permission_classes([IsAdminUser])
def overview(request):
    """Counts for the top of the staff dashboard."""
    firms = LawFirmProfile.objects.aggregate(pending=Count("pk", filter=Q(is_verified=False)),
                                             verified=Count("pk", filter=Q(is_verified=True)))
    companies = Company.objects.aggregate(pending=Count("pk", filter=Q(is_verified=False)),
                                          verified=Count("pk", filter=Q(is_verified=True)))
    users = dict(get_user_model().objects.filter(is_staff=False).values_list("role").annotate(n=Count("pk")))
    return Response({"firms": firms, "companies": companies,
                     "accounts": {role: users.get(role, 0) for role in ("victim", "hr", "law_firm")}})


class _VerifyMixin:
    permission_classes = [IsAdminUser]
    kind = ""

    @extend_schema(request=None)
    @action(detail=True, methods=["post"])
    def verify(self, request, pk=None):
        obj = self.get_object()
        obj.verify(by=request.user)
        logger.info("Verified %s=%s staff=%s", self.kind, obj.pk, request.user.pk)
        return Response(self.get_serializer(obj).data)

    @extend_schema(request=None)
    @action(detail=True, methods=["post"])
    def unverify(self, request, pk=None):
        obj = self.get_object()
        obj.unverify()
        logger.info("Verification removed %s=%s staff=%s", self.kind, obj.pk, request.user.pk)
        return Response(self.get_serializer(obj).data)


@extend_schema(parameters=[STATUS_PARAM, OpenApiParameter("q", str)])
class StaffFirmViewSet(_VerifyMixin, mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    serializer_class = StaffFirmSerializer
    queryset = LawFirmProfile.objects.none()
    kind = "firm"

    def get_queryset(self):
        qs = LawFirmProfile.objects.select_related("user", "verified_by").order_by("-created_at")
        if self.action == "list":
            qs = _by_status(qs, self.request)
            if q := self.request.query_params.get("q", "").strip():
                qs = qs.filter(Q(name__icontains=q) | Q(law_society_number__icontains=q) | Q(city__icontains=q))
        return qs


@extend_schema(parameters=[STATUS_PARAM, OpenApiParameter("q", str)])
class StaffCompanyViewSet(_VerifyMixin, mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    serializer_class = StaffCompanySerializer
    queryset = Company.objects.none()
    kind = "company"

    def get_queryset(self):
        qs = Company.objects.select_related("verified_by").prefetch_related("hr_members__user").order_by("-created_at")
        if self.action == "list":
            qs = _by_status(qs, self.request)
            if q := self.request.query_params.get("q", "").strip():
                qs = qs.filter(Q(name__icontains=q) | Q(city__icontains=q))
        return qs
