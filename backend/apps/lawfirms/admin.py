from django.contrib import admin
from django.utils import timezone

from .models import LawFirmProfile, MatchRequest


@admin.register(LawFirmProfile)
class LawFirmProfileAdmin(admin.ModelAdmin):
    list_display = ["name", "law_society_number", "is_verified", "accepting_clients", "updated_at"]
    list_filter = ["is_verified", "accepting_clients"]
    search_fields = ["name", "law_society_number"]
    readonly_fields = ["verified_at", "created_at", "updated_at"]
    actions = ["verify", "unverify"]

    @admin.action(description="Mark as verified (law society number checked)")
    def verify(self, request, queryset):
        queryset.update(is_verified=True, verified_at=timezone.now())

    @admin.action(description="Remove verification")
    def unverify(self, request, queryset):
        queryset.update(is_verified=False, verified_at=None)


@admin.register(MatchRequest)
class MatchRequestAdmin(admin.ModelAdmin):
    # IDs and status only: the message is the worker's private words.
    list_display = ["id", "case_id", "firm", "status", "created_at"]
    list_filter = ["status"]
    exclude = ["message"]
