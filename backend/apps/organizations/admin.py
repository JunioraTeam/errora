from django.contrib import admin

from .models import (
    Membership,
    Organization,
    OrganizationInvite,
    Project,
    ProjectKey,
    ProjectMembership,
)


class MembershipInline(admin.TabularInline):
    model = Membership
    extra = 0


@admin.register(Organization)
class OrganizationAdmin(admin.ModelAdmin):
    list_display = ("name", "slug", "created_at")
    search_fields = ("name", "slug")
    inlines = [MembershipInline]


@admin.register(Project)
class ProjectAdmin(admin.ModelAdmin):
    list_display = ("name", "organization", "platform", "created_at")
    list_filter = ("platform",)
    search_fields = ("name",)


admin.site.register([ProjectKey, ProjectMembership, OrganizationInvite])
