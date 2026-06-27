from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin

from .models import OTPCode, User


@admin.register(User)
class UserAdmin(BaseUserAdmin):
    ordering = ("-date_joined",)
    list_display = ("id", "email", "phone", "name", "is_staff", "date_joined")
    search_fields = ("email", "phone", "name")
    fieldsets = (
        (None, {"fields": ("email", "phone", "password")}),
        ("Profile", {"fields": ("name", "email_verified", "phone_verified")}),
        ("Permissions", {"fields": ("is_active", "is_staff", "is_superuser", "groups")}),
    )
    add_fieldsets = (
        (None, {"classes": ("wide",), "fields": ("email", "phone", "password1", "password2")}),
    )


@admin.register(OTPCode)
class OTPCodeAdmin(admin.ModelAdmin):
    list_display = ("identifier", "channel", "purpose", "attempts", "consumed_at", "expires_at")
    list_filter = ("channel", "purpose")
