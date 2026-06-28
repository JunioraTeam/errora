from __future__ import annotations

from django.contrib.auth import get_user_model
from django.contrib.auth.backends import ModelBackend


class EmailBackend(ModelBackend):
    """Authenticate with a password using email as the identifier."""

    def authenticate(self, request, identifier=None, password=None, **kwargs):
        if not identifier or not password:
            return None
        User = get_user_model()
        try:
            user = User.objects.get(email__iexact=identifier)
        except (User.DoesNotExist, User.MultipleObjectsReturned):
            User().set_password(password)  # mitigate timing attacks
            return None
        if user.check_password(password) and self.user_can_authenticate(user):
            return user
        return None
