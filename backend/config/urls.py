from django.contrib import admin
from django.http import JsonResponse
from django.urls import include, path
from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView
from rest_framework.routers import DefaultRouter

from apps.cases.views import CaseShareViewSet, CaseViewSet, TimelineEntryViewSet
from apps.chat.views import ConversationViewSet
from apps.documents.views import DocumentViewSet
from apps.hr.views import JobOfferViewSet, companies, hr_dashboard, my_company, report_incident, workplace
from apps.lawfirms.views import CaseMatchViewSet, FirmRequestViewSet, FirmThreadViewSet, LawFirmViewSet, my_profile
from apps.speech.views import DictationTicketView
from apps.tasks.views import TaskViewSet


def health(request):
    return JsonResponse({"status": "ok"})


router = DefaultRouter()
router.register("cases", CaseViewSet, basename="case")
router.register("lawfirms", LawFirmViewSet, basename="lawfirm")
router.register("messages", FirmThreadViewSet, basename="messages")

hr_router = DefaultRouter()
hr_router.register("job-offers", JobOfferViewSet, basename="hr-job-offers")
hr_router.include_root_view = False

firm_router = DefaultRouter()
firm_router.register("requests", FirmRequestViewSet, basename="firm-requests")
firm_router.include_root_view = False

case_router = DefaultRouter()
case_router.register("timeline", TimelineEntryViewSet, basename="case-timeline")
case_router.register("tasks", TaskViewSet, basename="case-tasks")
case_router.register("documents", DocumentViewSet, basename="case-documents")
case_router.register("shares", CaseShareViewSet, basename="case-shares")
case_router.register("conversations", ConversationViewSet, basename="case-conversations")
case_router.register("matches", CaseMatchViewSet, basename="case-matches")
case_router.include_root_view = False

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/health/", health),
    path("api/auth/", include("apps.accounts.urls")),
    # Before the router, so "me" is never read as a firm id.
    path("api/lawfirms/me/", my_profile),
    path("api/lawfirms/me/", include(firm_router.urls)),
    path("api/companies/", companies),
    path("api/hr/company/", my_company),
    path("api/hr/dashboard/", hr_dashboard),
    path("api/hr/", include(hr_router.urls)),
    path("api/workplace/", workplace),
    path("api/workplace/reports/", report_incident),
    path("api/", include(router.urls)),
    path("api/cases/<int:case_pk>/dictation-ticket/", DictationTicketView.as_view(), name="case-dictation-ticket"),
    path("api/cases/<int:case_pk>/", include(case_router.urls)),
    path("api/schema/", SpectacularAPIView.as_view(), name="schema"),
    path("api/docs/", SpectacularSwaggerView.as_view(url_name="schema"), name="swagger-ui"),
]
