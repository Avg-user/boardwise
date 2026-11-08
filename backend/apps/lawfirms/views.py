import logging

from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action, api_view
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError
from rest_framework.response import Response

from apps.cases.models import CaseShare
from apps.cases.permissions import CaseScopedMixin

from .models import LawFirmProfile, MatchRequest
from .serializers import (CaseMatchRequestSerializer, FirmMatchRequestSerializer, LawFirmOwnSerializer,
                          LawFirmPublicSerializer)

logger = logging.getLogger(__name__)


def _require_firm(user):
    if user.role != "law_firm":
        raise PermissionDenied("Only law firm accounts can do this.")


@extend_schema(parameters=[
    OpenApiParameter("area", str), OpenApiParameter("language", str),
    OpenApiParameter("free_consultation", bool), OpenApiParameter("q", str),
])
class LawFirmViewSet(viewsets.ReadOnlyModelViewSet):
    """The marketplace: verified firms that accept new clients."""

    serializer_class = LawFirmPublicSerializer
    lookup_value_regex = r"\d+"

    def get_queryset(self):
        qs = LawFirmProfile.objects.listed()
        p = self.request.query_params
        if p.get("area"):
            qs = qs.filter(practice_areas__contains=[p["area"]])
        if p.get("language"):
            qs = qs.filter(languages__contains=[p["language"]])
        if p.get("free_consultation") in ("1", "true"):
            qs = qs.filter(free_consultation=True)
        if p.get("q"):
            qs = qs.filter(Q(name__icontains=p["q"]) | Q(tagline__icontains=p["q"]) | Q(city__icontains=p["q"]))
        return qs


@extend_schema(request=LawFirmOwnSerializer, responses=LawFirmOwnSerializer)
@api_view(["GET", "PUT", "PATCH"])
def my_profile(request):
    """The signed-in firm's own profile. PUT creates it the first time."""
    _require_firm(request.user)
    profile = LawFirmProfile.objects.filter(user=request.user).first()
    if request.method == "GET":
        if profile is None:
            raise NotFound("No profile yet.")
        return Response(LawFirmOwnSerializer(profile).data)
    if profile is None and request.method == "PATCH":
        raise NotFound("No profile yet. Create it with PUT.")
    s = LawFirmOwnSerializer(profile, data=request.data, partial=request.method == "PATCH")
    s.is_valid(raise_exception=True)
    created = profile is None
    s.save(user=request.user) if created else s.save()
    return Response(s.data, status=status.HTTP_201_CREATED if created else status.HTTP_200_OK)


class FirmRequestViewSet(mixins.ListModelMixin, viewsets.GenericViewSet):
    """Requests sent to the signed-in firm. Accepting is what shares the case."""

    serializer_class = FirmMatchRequestSerializer
    queryset = MatchRequest.objects.none()

    def get_queryset(self):
        _require_firm(self.request.user)
        return MatchRequest.objects.filter(firm__user=self.request.user).select_related("case", "share")

    def _pending(self, pk):
        try:
            req = self.get_queryset().select_for_update(of=("self",)).get(pk=pk)
        except MatchRequest.DoesNotExist:
            raise NotFound()
        if req.status != MatchRequest.Status.PENDING:
            raise ValidationError("This request has already been answered or withdrawn.")
        return req

    @extend_schema(request=None)
    @action(detail=True, methods=["post"])
    @transaction.atomic
    def accept(self, request, pk=None):
        req = self._pending(pk)
        if not req.firm.is_verified:
            raise PermissionDenied("Your firm must be verified before accepting requests.")
        share = CaseShare.objects.filter(case=req.case, grantee=request.user, revoked_at__isnull=True).first()
        req.share = share or CaseShare.objects.create(case=req.case, grantee=request.user)
        req.respond(MatchRequest.Status.ACCEPTED)
        req.save()
        logger.info("Match accepted: request=%s case=%s firm=%s", req.pk, req.case_id, req.firm_id)
        return Response(self.get_serializer(req).data)

    @extend_schema(request=None)
    @action(detail=True, methods=["post"])
    @transaction.atomic
    def decline(self, request, pk=None):
        req = self._pending(pk)
        req.respond(MatchRequest.Status.DECLINED)
        req.save()
        return Response(self.get_serializer(req).data)


class CaseMatchViewSet(CaseScopedMixin, mixins.ListModelMixin, mixins.CreateModelMixin,
                       mixins.DestroyModelMixin, viewsets.GenericViewSet):
    """The case owner's requests to firms. DELETE withdraws a pending request or ends an accepted one."""

    serializer_class = CaseMatchRequestSerializer
    queryset = MatchRequest.objects.none()

    def get_queryset(self):
        case = self.get_case()
        if case.owner_id != self.request.user.pk:
            raise PermissionDenied("Only the case owner can see or send requests.")
        return case.match_requests.select_related("firm", "share")

    def get_serializer_context(self):
        ctx = super().get_serializer_context()
        if "case_pk" in self.kwargs:
            ctx["case"] = self.get_case()
        return ctx

    def perform_create(self, serializer):
        self.get_queryset()  # owner check
        req = serializer.save(case=self.get_case())
        logger.info("Match requested: request=%s case=%s firm=%s", req.pk, req.case_id, req.firm_id)

    @transaction.atomic
    def perform_destroy(self, req):
        if req.status == MatchRequest.Status.PENDING:
            req.respond(MatchRequest.Status.WITHDRAWN)
        elif req.status == MatchRequest.Status.ACCEPTED:
            if req.share and req.share.revoked_at is None:
                req.share.revoke()
            req.respond(MatchRequest.Status.ENDED)
        else:
            raise ValidationError("This request is already closed.")
        req.save()
