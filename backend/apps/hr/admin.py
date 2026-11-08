from django.contrib import admin
from django.utils import timezone

from .models import Company, HRMembership, JobOffer


class HRMemberInline(admin.TabularInline):
    model = HRMembership
    extra = 0
    autocomplete_fields = ["user"]


@admin.register(Company)
class CompanyAdmin(admin.ModelAdmin):
    # Worker memberships and reports are deliberately not shown here.
    list_display = ["name", "province", "city", "is_verified", "created_at"]
    list_filter = ["is_verified", "province"]
    search_fields = ["name", "city"]
    readonly_fields = ["verified_at", "created_at"]
    inlines = [HRMemberInline]
    actions = ["verify", "unverify"]

    @admin.action(description="Mark as verified (HR contact checked)")
    def verify(self, request, queryset):
        queryset.update(is_verified=True, verified_at=timezone.now())

    @admin.action(description="Remove verification")
    def unverify(self, request, queryset):
        queryset.update(is_verified=False, verified_at=None)


@admin.register(JobOffer)
class JobOfferAdmin(admin.ModelAdmin):
    # IDs and status only: an offer can name the candidate and their pay.
    list_display = ["id", "company", "province", "status", "created_at"]
    list_filter = ["status"]
    fields = ["company", "province", "status", "created_at", "reviewed_at"]
    readonly_fields = fields
