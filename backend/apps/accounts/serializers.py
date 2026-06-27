from __future__ import annotations

from adrf.serializers import ModelSerializer, Serializer
from django.contrib.auth import authenticate, get_user_model
from rest_framework import serializers

from .models import OTPCode
from .phone import normalize_phone

User = get_user_model()

INVALID_IDENTIFIER = "Enter a valid email or Iranian mobile number (9XXXXXXXXX, e.g. 9123456789)."


def normalize_identifier(identifier: str) -> tuple[str, str]:
    """Classify + canonicalize a raw identifier → (channel, normalized value).

    Phones are normalized to E.164 (``+98XXXXXXXXXX``); emails are lowercased.
    Raises a validation error for anything else.
    """
    identifier = (identifier or "").strip()
    if "@" in identifier:
        return OTPCode.Channel.EMAIL, identifier.lower()
    phone = normalize_phone(identifier)
    if phone:
        return OTPCode.Channel.SMS, phone
    raise serializers.ValidationError(INVALID_IDENTIFIER)


def classify_identifier(identifier: str) -> str:
    """Return the channel ('email'/'sms') for a raw identifier (back-compat)."""
    return normalize_identifier(identifier)[0]


class UserSerializer(ModelSerializer):
    display_name = serializers.CharField(read_only=True)
    has_password = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = [
            "id",
            "email",
            "phone",
            "name",
            "first_name",
            "last_name",
            "display_name",
            "email_verified",
            "phone_verified",
            "totp_enabled",
            "has_password",
            "date_joined",
        ]
        read_only_fields = fields

    def get_has_password(self, obj) -> bool:
        return obj.has_usable_password()


class ProfileUpdateSerializer(ModelSerializer):
    """Editable profile fields (name/contact)."""

    class Meta:
        model = User
        fields = ["first_name", "last_name", "name", "email", "phone"]
        extra_kwargs = {f: {"required": False} for f in fields}

    def validate_email(self, value):
        if value and User.objects.exclude(pk=self.instance.pk).filter(email=value).exists():
            raise serializers.ValidationError("This email is already in use.")
        return value

    def validate_phone(self, value):
        if not value:
            return value
        canonical = normalize_phone(value)
        if not canonical:
            raise serializers.ValidationError(INVALID_IDENTIFIER)
        if User.objects.exclude(pk=self.instance.pk).filter(phone=canonical).exists():
            raise serializers.ValidationError("This phone number is already in use.")
        return canonical


class ChangePasswordSerializer(Serializer):
    current_password = serializers.CharField(write_only=True, required=False, allow_blank=True)
    new_password = serializers.CharField(write_only=True, min_length=8)

    def validate(self, attrs):
        user = self.context["request"].user
        # If the account already has a usable password, the current one is required.
        if user.has_usable_password():
            if not user.check_password(attrs.get("current_password") or ""):
                raise serializers.ValidationError(
                    {"current_password": "Current password is incorrect."}
                )
        return attrs


class RegisterSerializer(Serializer):
    """Create a new account. Name is NOT collected here — users set their first
    and last name later on the dashboard profile page."""

    identifier = serializers.CharField()
    password = serializers.CharField(write_only=True, min_length=8)

    def validate(self, attrs):
        attrs["channel"], attrs["identifier"] = normalize_identifier(attrs["identifier"])
        return attrs

    def create(self, validated):
        channel = validated["channel"]
        ident = validated["identifier"]
        kwargs = {"password": validated["password"]}
        kwargs["email" if channel == OTPCode.Channel.EMAIL else "phone"] = ident
        if User.objects.filter(email=ident).exists() or User.objects.filter(phone=ident).exists():
            raise serializers.ValidationError("An account with this identifier already exists.")
        return User.objects.create_user(**kwargs)


class AccessSerializer(Serializer):
    """Merged login-or-register: one identifier + password form.

    If an account exists for the identifier, authenticate it (enforcing TOTP when
    enabled). Otherwise create a new account — unless signup is disabled, in which
    case the unknown identifier is rejected. ``created`` flags which path ran.
    """

    identifier = serializers.CharField()
    password = serializers.CharField(write_only=True, min_length=8)
    totp = serializers.CharField(required=False, allow_blank=True)

    def validate(self, attrs):
        from django.conf import settings

        from .totp import verify as verify_totp

        channel, ident = normalize_identifier(attrs["identifier"])
        lookup = {"email": ident} if channel == OTPCode.Channel.EMAIL else {"phone": ident}
        exists = User.objects.filter(**lookup).exists()

        if exists:
            user = authenticate(identifier=ident, password=attrs["password"])
            if user is None:
                raise serializers.ValidationError("Invalid credentials.")
            if user.totp_enabled:
                code = (attrs.get("totp") or "").strip()
                if not code:
                    raise serializers.ValidationError({"totp_required": True})
                if not verify_totp(user.totp_secret, code):
                    raise serializers.ValidationError({"totp": "Invalid authentication code."})
            attrs["user"] = user
            attrs["created"] = False
            return attrs

        if not settings.SIGNUP_ENABLED:
            raise serializers.ValidationError({"signup_disabled": True})
        attrs["user"] = User.objects.create_user(**{**lookup, "password": attrs["password"]})
        attrs["created"] = True
        return attrs


class PasswordLoginSerializer(Serializer):
    identifier = serializers.CharField()
    password = serializers.CharField(write_only=True)
    totp = serializers.CharField(required=False, allow_blank=True)

    def validate(self, attrs):
        from .totp import verify as verify_totp

        _channel, ident = normalize_identifier(attrs["identifier"])
        user = authenticate(identifier=ident, password=attrs["password"])
        if user is None:
            raise serializers.ValidationError("Invalid credentials.")
        if user.totp_enabled:
            code = (attrs.get("totp") or "").strip()
            if not code:
                # Signal the client to collect a 2FA code and retry.
                raise serializers.ValidationError({"totp_required": True})
            if not verify_totp(user.totp_secret, code):
                raise serializers.ValidationError({"totp": "Invalid authentication code."})
        attrs["user"] = user
        return attrs


class OTPRequestSerializer(Serializer):
    identifier = serializers.CharField()

    def validate(self, attrs):
        attrs["channel"], attrs["identifier"] = normalize_identifier(attrs["identifier"])
        return attrs


class OTPVerifySerializer(Serializer):
    identifier = serializers.CharField()
    code = serializers.CharField()

    def validate(self, attrs):
        _channel, attrs["identifier"] = normalize_identifier(attrs["identifier"])
        return attrs
