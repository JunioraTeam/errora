from __future__ import annotations

from django.contrib.auth.base_user import BaseUserManager


class UserManager(BaseUserManager):
    use_in_migrations = True

    def _create(self, *, email=None, phone=None, password=None, **extra):
        if not email and not phone:
            raise ValueError("User must have an email or a phone number.")
        if email:
            email = self.normalize_email(email).lower()
        user = self.model(email=email or None, phone=phone or None, **extra)
        if password:
            user.set_password(password)
        else:
            user.set_unusable_password()
        user.save(using=self._db)
        return user

    def create_user(self, email=None, phone=None, password=None, **extra):
        extra.setdefault("is_staff", False)
        extra.setdefault("is_superuser", False)
        return self._create(email=email, phone=phone, password=password, **extra)

    def create_superuser(self, email=None, phone=None, password=None, **extra):
        extra.setdefault("is_staff", True)
        extra.setdefault("is_superuser", True)
        extra.setdefault("email_verified", True)
        if extra.get("is_staff") is not True or extra.get("is_superuser") is not True:
            raise ValueError("Superuser must have is_staff=True and is_superuser=True.")
        return self._create(email=email, phone=phone, password=password, **extra)
