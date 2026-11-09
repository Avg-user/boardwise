from django.urls import include, path
from rest_framework.routers import DefaultRouter

from . import views

router = DefaultRouter()
router.include_root_view = False
router.register("firms", views.StaffFirmViewSet, basename="staff-firms")
router.register("companies", views.StaffCompanyViewSet, basename="staff-companies")

urlpatterns = [
    path("overview/", views.overview),
    path("", include(router.urls)),
]
