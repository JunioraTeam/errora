from __future__ import annotations

from django.contrib.auth import get_user_model
from django.contrib.auth.backends import ModelBackend
from django.db.models import Q


class PhoneOrEmailBackend(ModelBackend):
    """Authenticate with a password using either phone or email as identifier."""

    def authenticate(self, request, identifier=None, password=None, **kwargs):
        if not identifier or not password:
            return None
        User = get_user_model()
        try:
            user = User.objects.get(Q(email__iexact=identifier) | Q(phone=identifier))
        except (User.DoesNotExist, User.MultipleObjectsReturned):
            User().set_password(password)  # mitigate timing attacks
            return None
        if user.check_password(password) and self.user_can_authenticate(user):
            return user
        return None
