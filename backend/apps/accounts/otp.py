"""OTP generation, delivery and verification."""

from __future__ import annotations

import hashlib
import hmac
import secrets

from django.conf import settings
from django.core.mail import send_mail
from django.utils import timezone

from .models import OTPCode
from .sms import get_sms_provider


def _hash(code: str) -> str:
    return hmac.new(settings.SECRET_KEY.encode(), code.encode(), hashlib.sha256).hexdigest()


def _generate_code() -> str:
    # Dev convenience: a deterministic all-ones code so no real OTP delivery is
    # needed locally. Never enabled when OTP_DEBUG_CODE is off (deployed envs).
    if settings.OTP_DEBUG_CODE:
        return "1" * settings.OTP_LENGTH
    upper = 10**settings.OTP_LENGTH
    return str(secrets.randbelow(upper)).zfill(settings.OTP_LENGTH)


def issue_otp(identifier: str, channel: str, purpose: str = OTPCode.Purpose.LOGIN) -> OTPCode:
    code = _generate_code()
    otp = OTPCode.objects.create(
        identifier=identifier,
        channel=channel,
        purpose=purpose,
        code_hash=_hash(code),
        expires_at=timezone.now() + timezone.timedelta(seconds=settings.OTP_TTL_SECONDS),
    )
    if channel == OTPCode.Channel.SMS:
        get_sms_provider().send_otp(identifier, code)
    else:
        send_mail(
            subject="Errora — code",
            message=f"Your verification code: {code}",
            from_email=settings.DEFAULT_FROM_EMAIL,
            recipient_list=[identifier],
        )
    return otp


def verify_otp(identifier: str, code: str, purpose: str = OTPCode.Purpose.LOGIN) -> bool:
    otp = (
        OTPCode.objects.filter(identifier=identifier, purpose=purpose, consumed_at__isnull=True)
        .order_by("-created_at")
        .first()
    )
    if otp is None or otp.is_expired or otp.attempts >= 5:
        return False
    otp.attempts += 1
    if hmac.compare_digest(otp.code_hash, _hash(code)):
        otp.consumed_at = timezone.now()
        otp.save(update_fields=["attempts", "consumed_at"])
        return True
    otp.save(update_fields=["attempts"])
    return False
