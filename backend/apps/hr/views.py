import logging
from datetime import date

from django.conf import settings
from django.db import transaction
from django.db.models import Q
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action, api_view
from rest_framework.exceptions import NotFound, PermissionDenied, Throttled, ValidationError
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.response import Response

from . import dashboard
from .models import Company, HRMembership, JobOffer, WorkerMembership
from .serializers import (CompanyOwnSerializer, CompanyPublicSerializer, DashboardSerializer,
                          IncidentReportSerializer, JobOfferSerializer, WorkplaceSerializer)
from .tasks import review_job_offer

logger = logging.getLogger(__name__)


def _require_role(user, role: str, message: str):
    if user.role != role:
        raise PermissionDenied(message)


def hr_company(user, verified: bool = True) -> Company:
    """The signed-in HR account's company. Most HR features need it verified."""
    _require_role(user, "hr", "Only HR accounts can do this.")
    membership = HRMembership.objects.select_related("company").filter(user=user).first()
    if membership is None:
        raise NotFound("No company yet.")
    if verified and not membership.company.is_verified:
        raise PermissionDenied("Your company must be verified by Boardwise before you can use this.")
    return membership.company


# --- Companies -------------------------------------------------------------------------------

@extend_schema(parameters=[OpenApiParameter("q", str)], responses=CompanyPublicSerializer(many=True))
@api_view(["GET"])
def companies(request):
    """Verified companies, for a worker to pick their employer."""
    qs = Company.objects.listed()
    if q := request.query_params.get("q", "").strip():
        qs = qs.filter(Q(name__icontains=q) | Q(city__icontains=q))
    return Response(CompanyPublicSerializer(qs[:50], many=True).data)


@extend_schema(request=CompanyOwnSerializer, responses=CompanyOwnSerializer)
@api_view(["GET", "PUT", "PATCH"])
@transaction.atomic
def my_company(request):
    """The HR account's company. PUT creates it the first time; staff then verify it."""
    _require_role(request.user, "hr", "Only HR accounts can do this.")
    membership = HRMembership.objects.select_related("company").filter(user=request.user).first()
    company = membership.company if membership else None
    if request.method == "GET":
        if company is None:
            raise NotFound("No company yet.")
        return Response(CompanyOwnSerializer(company).data)
    if company is None and request.method == "PATCH":
        raise NotFound("No company yet. Create it with PUT.")
    s = CompanyOwnSerializer(company, data=request.data, partial=request.method == "PATCH")
    s.is_valid(raise_exception=True)
    company = s.save()
    if membership is None:
        HRMembership.objects.create(user=request.user, company=company)
        logger.info("Company created: company=%s hr=%s", company.pk, request.user.pk)
        return Response(s.data, status=status.HTTP_201_CREATED)
    return Response(s.data)


@extend_schema(responses=DashboardSerializer)
@api_view(["GET"])
def hr_dashboard(request):
    """Anonymous report counts for the HR account's company, with small numbers hidden."""
    company = hr_company(request.user)
    return Response(DashboardSerializer({"company": company, **dashboard.build(company)}).data)


# --- Workers ---------------------------------------------------------------------------------

def _workplace(user) -> WorkerMembership:
    _require_role(user, "victim", "Only worker accounts have a workplace.")
    membership, _ = WorkerMembership.objects.get_or_create(user=user)
    return membership


@extend_schema(request=WorkplaceSerializer, responses=WorkplaceSerializer)
@api_view(["GET", "PUT", "PATCH", "DELETE"])
def workplace(request):
    """The worker's company and reporting opt-in. DELETE leaves the company (and opts out)."""
    membership = _workplace(request.user)
    if request.method == "DELETE":
        membership.company, membership.reporting_opt_in = None, False
        membership.save(update_fields=["company", "reporting_opt_in"])
        return Response(status=status.HTTP_204_NO_CONTENT)
    if request.method == "GET":
        return Response(WorkplaceSerializer(membership).data)
    s = WorkplaceSerializer(membership, data=request.data, partial=request.method == "PATCH")
    s.is_valid(raise_exception=True)
    s.save()
    return Response(s.data)


@extend_schema(request=IncidentReportSerializer, responses={204: None})
@api_view(["POST"])
@transaction.atomic
def report_incident(request):
    """Send an anonymous report to the worker's company.

    The report keeps no link to the worker. Nothing is logged here, and the response (204) has no ID,
    because there is nothing the worker (or anyone) can look up later.
    """
    _workplace(request.user)  # role check, and makes sure the row exists
    membership = WorkerMembership.objects.select_for_update(of=("self",)).select_related("company").get(user=request.user)
    if membership.company is None or not membership.reporting_opt_in:
        raise PermissionDenied("Choose your company and turn on anonymous reporting first.")
    if not membership.company.is_verified:
        raise PermissionDenied("Your company isn't accepting reports right now.")
    s = IncidentReportSerializer(data=request.data)
    s.is_valid(raise_exception=True)

    this_month = dashboard.first_of_month(date.today())
    if membership.report_window != this_month:
        membership.report_window, membership.reports_in_window = this_month, 0
    if membership.reports_in_window >= settings.HR_REPORTS_PER_MONTH:
        raise Throttled(detail="You've sent the most reports allowed this month. You can send more next month.")
    membership.reports_in_window += 1
    membership.save(update_fields=["report_window", "reports_in_window"])
    s.save(company=membership.company)
    return Response(status=status.HTTP_204_NO_CONTENT)


# --- Job offers ------------------------------------------------------------------------------

def _enqueue_review(offer_id: int):
    try:
        review_job_offer.delay(offer_id)
    except Exception as exc:  # broker down: say so instead of leaving it pending forever
        logger.error("Could not queue job offer review: offer=%s error=%s", offer_id, type(exc).__name__)
        JobOffer.objects.filter(pk=offer_id).update(status=JobOffer.Status.FAILED, failure=JobOffer.Failure.QUEUE)


class JobOfferViewSet(mixins.ListModelMixin, mixins.CreateModelMixin, mixins.RetrieveModelMixin,
                      mixins.DestroyModelMixin, viewsets.GenericViewSet):
    """Upload a job offer (multipart `file`: PDF, DOCX or TXT) or paste `text`; an AI checks it in
    the background. Poll the detail until `status` is done or failed."""

    serializer_class = JobOfferSerializer
    parser_classes = [MultiPartParser, FormParser, JSONParser]
    queryset = JobOffer.objects.none()

    def get_queryset(self):
        return JobOffer.objects.filter(company=hr_company(self.request.user))

    def perform_create(self, serializer):
        company = hr_company(self.request.user)
        f = serializer.validated_data.get("file")
        title = (serializer.validated_data.get("title") or (f.name if f else "") or "Pasted job offer")[:255]
        province = (serializer.validated_data.get("province") or company.province).upper()
        offer = serializer.save(company=company, uploaded_by=self.request.user, title=title, province=province,
                                content_type=(getattr(f, "content_type", "") or "") if f else "")
        logger.info("Job offer uploaded: offer=%s company=%s", offer.pk, company.pk)
        transaction.on_commit(lambda: _enqueue_review(offer.pk))

    def perform_destroy(self, offer):
        if offer.file:
            offer.file.delete(save=False)
        offer.delete()

    @extend_schema(request=None)
    @action(detail=True, methods=["post"])
    def retry(self, request, pk=None):
        offer = self.get_object()
        if offer.status != JobOffer.Status.FAILED and offer.failure != JobOffer.Failure.PARTIAL:
            raise ValidationError("Only a failed or incomplete review can be retried.")
        offer.status, offer.failure = JobOffer.Status.PENDING, ""
        offer.save(update_fields=["status", "failure"])
        transaction.on_commit(lambda: _enqueue_review(offer.pk))
        return Response(self.get_serializer(offer).data)
