"""
SMS providers. The active provider is selected by ``settings.SMS_PROVIDER`` so
swapping Kavenegar for another gateway is a config change, not a code change.

Add a new provider by subclassing ``BaseSMSProvider`` and registering it in
``PROVIDERS``.
"""

from __future__ import annotations

import logging
from abc import ABC, abstractmethod

import httpx
from django.conf import settings

logger = logging.getLogger(__name__)


class BaseSMSProvider(ABC):
    @abstractmethod
    def send_otp(self, phone: str, code: str) -> None: ...

    @abstractmethod
    def send_text(self, phone: str, text: str) -> None: ...


class ConsoleSMSProvider(BaseSMSProvider):
    """Dev provider — prints to logs instead of sending."""

    def send_otp(self, phone: str, code: str) -> None:
        logger.info("[SMS:console] OTP to %s: %s", phone, code)

    def send_text(self, phone: str, text: str) -> None:
        logger.info("[SMS:console] to %s: %s", phone, text)


class KavenegarSMSProvider(BaseSMSProvider):
    """Iranian SMS gateway. Uses the verify/lookup endpoint for OTP templates."""

    BASE = "https://api.kavenegar.com/v1/{key}/{method}.json"

    def __init__(self) -> None:
        self.api_key = settings.KAVENEGAR_API_KEY
        self.template = settings.KAVENEGAR_OTP_TEMPLATE
        self.timeout = 10

    def _url(self, method: str) -> str:
        return self.BASE.format(key=self.api_key, method=method)

    def send_otp(self, phone: str, code: str) -> None:
        resp = httpx.post(
            self._url("verify/lookup"),
            data={"receptor": phone, "token": code, "template": self.template},
            timeout=self.timeout,
        )
        resp.raise_for_status()

    def send_text(self, phone: str, text: str) -> None:
        resp = httpx.post(
            self._url("sms/send"),
            data={"receptor": phone, "message": text},
            timeout=self.timeout,
        )
        resp.raise_for_status()


PROVIDERS: dict[str, type[BaseSMSProvider]] = {
    "console": ConsoleSMSProvider,
    "kavenegar": KavenegarSMSProvider,
}


def get_sms_provider() -> BaseSMSProvider:
    name = settings.SMS_PROVIDER
    if name == "kavenegar" and not settings.KAVENEGAR_API_KEY:
        # Fall back to console in dev when no key configured.
        return ConsoleSMSProvider()
    provider_cls = PROVIDERS.get(name, ConsoleSMSProvider)
    return provider_cls()
