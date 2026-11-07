from django.contrib import admin
from django.contrib.auth.admin import UserAdmin

from .models import User


@admin.register(User)
class BoardwiseUserAdmin(UserAdmin):
    fieldsets = UserAdmin.fieldsets + (("Boardwise", {"fields": ("role", "preferred_language")}),)
    list_display = ("username", "email", "role", "is_staff")
