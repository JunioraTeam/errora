from __future__ import annotations

import uuid

from django.contrib.auth.models import AbstractBaseUser, PermissionsMixin
from django.db import models
from django.utils import timezone

from apps.common.fields import EncryptedTextField

from .managers import UserManager


class User(AbstractBaseUser, PermissionsMixin):
    """
    Custom user keyed by UUID. Email is the login identifier (required, enforced
    in the manager/serializer).
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    email = models.EmailField(unique=True, null=True, blank=True)
    name = models.CharField(max_length=150, blank=True)
    first_name = models.CharField(max_length=75, blank=True)
    last_name = models.CharField(max_length=75, blank=True)

    email_verified = models.BooleanField(default=False)

    # Optional TOTP two-factor auth. The secret is encrypted at rest and only
    # enforced at password login once the user verifies and enables it.
    totp_secret = EncryptedTextField(blank=True)
    totp_enabled = models.BooleanField(default=False)

    is_active = models.BooleanField(default=True)
    is_staff = models.BooleanField(default=False)
    date_joined = models.DateTimeField(default=timezone.now)
    # Bumped on logout / password change to revoke all previously-issued JWTs
    # (tokens embed this value and are rejected when it no longer matches).
    token_version = models.PositiveIntegerField(default=0)

    objects = UserManager()

    USERNAME_FIELD = "id"  # auth happens through custom backend, not a single field
    REQUIRED_FIELDS: list[str] = []

    class Meta:
        indexes = [
            models.Index(fields=["email"]),
        ]

    def __str__(self) -> str:
        return self.email or str(self.id)

    @property
    def full_name(self) -> str:
        return f"{self.first_name} {self.last_name}".strip()

    @property
    def display_name(self) -> str:
        return self.full_name or self.name or self.email or "user"


class OTPCode(models.Model):
    """Short-lived one-time codes for email login & verification."""

    class Channel(models.TextChoices):
        EMAIL = "email", "Email"

    class Purpose(models.TextChoices):
        LOGIN = "login", "Login"
        VERIFY = "verify", "Verify"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    identifier = models.CharField(max_length=190, db_index=True)  # email
    channel = models.CharField(max_length=10, choices=Channel.choices)
    purpose = models.CharField(max_length=10, choices=Purpose.choices, default=Purpose.LOGIN)
    code_hash = models.CharField(max_length=128)
    attempts = models.PositiveSmallIntegerField(default=0)
    consumed_at = models.DateTimeField(null=True, blank=True)
    expires_at = models.DateTimeField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        indexes = [models.Index(fields=["identifier", "purpose"])]

    @property
    def is_expired(self) -> bool:
        return timezone.now() >= self.expires_at


class ApiToken(models.Model):
    """A personal access token, used as a bearer credential for the MCP server
    and other programmatic access. The raw token is shown to the user once at
    creation; only its SHA-256 hash is stored."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey("accounts.User", on_delete=models.CASCADE, related_name="api_tokens")
    name = models.CharField(max_length=120)
    # First chars of the raw token (e.g. "errora_pat_ab12cd"), for UI display.
    token_prefix = models.CharField(max_length=24)
    token_hash = models.CharField(max_length=64, unique=True, db_index=True)
    last_used_at = models.DateTimeField(null=True, blank=True)
    expires_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"{self.name} ({self.token_prefix}…)"

    @property
    def is_expired(self) -> bool:
        return bool(self.expires_at and timezone.now() >= self.expires_at)
