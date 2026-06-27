from django.contrib import admin

from .models import Integration, Repository


@admin.register(Integration)
class IntegrationAdmin(admin.ModelAdmin):
    list_display = ("provider", "organization", "base_url", "is_active", "created_at")
    list_filter = ("provider", "is_active")


@admin.register(Repository)
class RepositoryAdmin(admin.ModelAdmin):
    list_display = ("path_with_namespace", "integration", "default_branch")
    search_fields = ("path_with_namespace", "name")
