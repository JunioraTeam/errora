from __future__ import annotations

from adrf.views import APIView
from asgiref.sync import sync_to_async
from django.conf import settings
from django.contrib.auth import get_user_model
from rest_framework import status
from rest_framework.exceptions import NotFound
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle

from . import totp as totp_lib
from .authentication import decode_token, issue_token_pair
from .otp import issue_otp, verify_otp
from .serializers import (
    AccessSerializer,
    ChangePasswordSerializer,
    OTPRequestSerializer,
    OTPVerifySerializer,
    PasswordLoginSerializer,
    ProfileUpdateSerializer,
    RegisterSerializer,
    UserSerializer,
)

User = get_user_model()


class RegisterView(APIView):
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "auth"

    async def post(self, request):
        if not settings.SIGNUP_ENABLED:
            return Response({"detail": "Signup is currently disabled."}, status=403)
        ser = RegisterSerializer(data=request.data)
        await sync_to_async(ser.is_valid)(raise_exception=True)
        user = await sync_to_async(ser.save)()
        return Response(
            {"user": await UserSerializer(user).adata, "tokens": issue_token_pair(user)},
            status=status.HTTP_201_CREATED,
        )


class PasswordLoginView(APIView):
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "auth"

    async def post(self, request):
        ser = PasswordLoginSerializer(data=request.data)
        await sync_to_async(ser.is_valid)(raise_exception=True)
        user = ser.validated_data["user"]
        return Response(
            {"user": await UserSerializer(user).adata, "tokens": issue_token_pair(user)}
        )


class AccessView(APIView):
    """Merged login-or-register endpoint (single email + password form)."""

    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "auth"

    async def post(self, request):
        ser = AccessSerializer(data=request.data)
        await sync_to_async(ser.is_valid)(raise_exception=True)
        user = ser.validated_data["user"]
        created = ser.validated_data["created"]
        return Response(
            {"user": await UserSerializer(user).adata, "tokens": issue_token_pair(user)},
            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )


class OTPRequestView(APIView):
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "otp"

    async def post(self, request):
        if not settings.OTP_ENABLED:
            raise NotFound("OTP login is disabled.")
        ser = OTPRequestSerializer(data=request.data)
        await sync_to_async(ser.is_valid)(raise_exception=True)
        await sync_to_async(issue_otp)(
            ser.validated_data["identifier"], ser.validated_data["channel"]
        )
        # Never leak whether the identifier exists.
        return Response({"detail": "Code sent if the identifier is valid."})


class OTPVerifyView(APIView):
    permission_classes = [AllowAny]

    async def post(self, request):
        if not settings.OTP_ENABLED:
            raise NotFound("OTP login is disabled.")
        ser = OTPVerifySerializer(data=request.data)
        await sync_to_async(ser.is_valid)(raise_exception=True)
        ident = ser.validated_data["identifier"]
        if not await sync_to_async(verify_otp)(ident, ser.validated_data["code"]):
            return Response({"detail": "Invalid or expired code."}, status=400)
        user, _ = await User.objects.aget_or_create(email=ident, defaults={"email_verified": True})
        if not user.email_verified:
            user.email_verified = True
            await user.asave(update_fields=["email_verified"])
        return Response(
            {"user": await UserSerializer(user).adata, "tokens": issue_token_pair(user)}
        )


class RefreshView(APIView):
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "auth"

    async def post(self, request):
        token = request.data.get("refresh", "")
        payload = decode_token(token, expected_type="refresh")
        try:
            user = await User.objects.aget(id=payload["sub"], is_active=True)
        except User.DoesNotExist:
            return Response({"detail": "User not found."}, status=401)
        # Reject refresh tokens issued before a logout / password change.
        if payload.get("ver", 0) != user.token_version:
            return Response({"detail": "Token has been revoked."}, status=401)
        return Response({"tokens": issue_token_pair(user)})


class LogoutView(APIView):
    """Revoke every token issued to the current user (bumps their token version)
    so a stolen access/refresh token stops working immediately."""

    permission_classes = [IsAuthenticated]

    async def post(self, request):
        user = request.user
        user.token_version = (user.token_version or 0) + 1
        await user.asave(update_fields=["token_version"])
        return Response({"detail": "Logged out."})


class MeView(APIView):
    permission_classes = [IsAuthenticated]

    async def get(self, request):
        return Response(await UserSerializer(request.user).adata)

    async def patch(self, request):
        ser = ProfileUpdateSerializer(
            request.user, data=request.data, partial=True, context={"request": request}
        )
        await sync_to_async(ser.is_valid)(raise_exception=True)
        user = await ser.asave()
        # Keep the legacy ``name`` in sync with first/last when those are sent.
        if "first_name" in ser.validated_data or "last_name" in ser.validated_data:
            full = user.full_name
            if full:
                user.name = full
                await user.asave(update_fields=["name"])
        return Response(await UserSerializer(user).adata)


class ChangePasswordView(APIView):
    permission_classes = [IsAuthenticated]

    async def post(self, request):
        ser = ChangePasswordSerializer(data=request.data, context={"request": request})
        await sync_to_async(ser.is_valid)(raise_exception=True)
        user = request.user
        user.set_password(ser.validated_data["new_password"])
        # Bump the token version so tokens issued before the change are revoked,
        # then hand back a fresh pair (carrying the new version) for this session.
        user.token_version = (user.token_version or 0) + 1
        await user.asave(update_fields=["password", "token_version"])
        return Response({"detail": "Password updated.", "tokens": issue_token_pair(user)})


class TOTPSetupView(APIView):
    """Begin enrollment: generate a secret and return its provisioning URI.

    The secret is stored but 2FA is not enforced until verified via TOTPEnableView."""

    permission_classes = [IsAuthenticated]

    async def post(self, request):
        user = request.user
        secret = totp_lib.generate_secret()
        user.totp_secret = secret
        user.totp_enabled = False
        await user.asave(update_fields=["totp_secret", "totp_enabled"])
        label = user.email or str(user.id)
        return Response(
            {"secret": secret, "otpauth_uri": totp_lib.provisioning_uri(secret, label=label)}
        )


class TOTPEnableView(APIView):
    permission_classes = [IsAuthenticated]

    async def post(self, request):
        user = request.user
        code = str(request.data.get("code", "")).strip()
        if not user.totp_secret:
            return Response({"detail": "Start TOTP setup first."}, status=400)
        if not totp_lib.verify(user.totp_secret, code):
            return Response({"detail": "Invalid authentication code."}, status=400)
        user.totp_enabled = True
        await user.asave(update_fields=["totp_enabled"])
        return Response(await UserSerializer(user).adata)


class TOTPDisableView(APIView):
    permission_classes = [IsAuthenticated]

    async def post(self, request):
        user = request.user
        code = str(request.data.get("code", "")).strip()
        # Require a valid current code (or password) to turn 2FA off.
        if user.totp_enabled and not totp_lib.verify(user.totp_secret, code):
            if not user.check_password(str(request.data.get("password", ""))):
                return Response(
                    {"detail": "Provide a valid authentication code or your password."},
                    status=400,
                )
        user.totp_enabled = False
        user.totp_secret = ""
        await user.asave(update_fields=["totp_enabled", "totp_secret"])
        return Response(await UserSerializer(user).adata)
