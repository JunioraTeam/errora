"""DRF permission classes that enforce RBAC capabilities.

Views set ``required_capability`` and expose ``get_organization()`` /
``get_project()`` so these classes stay generic.
"""

from __future__ import annotations

from rest_framework.permissions import BasePermission

from .services import has_permission


class HasOrgCapability(BasePermission):
    message = "You do not have permission to perform this action."

    def has_permission(self, request, view) -> bool:
        capability = getattr(view, "required_capability", None)
        if capability is None:
            return True
        org = view.get_organization() if hasattr(view, "get_organization") else None
        if org is None:
            return False
        project = view.get_project() if hasattr(view, "get_project") else None
        return has_permission(request.user, capability, organization=org, project=project)
