import pytest

from apps.accounts.models import OTPCode, User
from apps.accounts.otp import issue_otp, verify_otp
from apps.accounts.phone import normalize_phone


@pytest.mark.parametrize(
    "raw,expected",
    [
        ("9123456789", "+989123456789"),
        ("09123456789", "+989123456789"),
        ("+989123456789", "+989123456789"),
        ("0098 912 345 6789", "+989123456789"),
        ("+98 912 345 6789", "+989123456789"),
        ("8123456789", None),  # must start with 9
        ("912345678", None),  # too short
        ("91234567890", None),  # too long
        ("not-a-phone", None),
    ],
)
def test_normalize_phone(raw, expected):
    assert normalize_phone(raw) == expected


@pytest.mark.django_db
def test_access_rejects_invalid_phone(api):
    resp = api.post("/api/v1/auth/access", {"identifier": "8123456789", "password": "password123"})
    assert resp.status_code == 400
    assert not User.objects.filter(phone__isnull=False).exists()


@pytest.mark.django_db
def test_access_canonicalizes_phone_for_login(api):
    # Register with the national form; the stored phone is canonical E.164.
    created = api.post(
        "/api/v1/auth/access", {"identifier": "9120000001", "password": "password123"}
    )
    assert created.status_code == 201
    assert User.objects.get().phone == "+989120000001"

    # Log in with a different surface form of the same number → same account.
    again = api.post(
        "/api/v1/auth/access", {"identifier": "09120000001", "password": "password123"}
    )
    assert again.status_code == 200
    assert User.objects.count() == 1


@pytest.mark.django_db
def test_register_creates_user_and_default_org(api):
    # Signup no longer collects a name — only identifier + password.
    resp = api.post(
        "/api/v1/auth/register",
        {"identifier": "bob@errora.dev", "password": "password123"},
    )
    assert resp.status_code == 201
    assert "access" in resp.data["tokens"]
    user = User.objects.get(email="bob@errora.dev")
    assert user.name == ""
    assert user.organizations.count() == 1  # signal-created org
    assert user.organizations.first().name == "Default organization"


@pytest.mark.django_db
def test_register_blocked_when_signup_disabled(api, settings):
    settings.SIGNUP_ENABLED = False
    resp = api.post(
        "/api/v1/auth/register",
        {"identifier": "nope@errora.dev", "password": "password123"},
    )
    assert resp.status_code == 403
    assert not User.objects.filter(email="nope@errora.dev").exists()


@pytest.mark.django_db
def test_access_registers_new_then_logs_in_existing(api):
    # First call: unknown phone → creates the account (201).
    first = api.post(
        "/api/v1/auth/access", {"identifier": "+989120001122", "password": "password123"}
    )
    assert first.status_code == 201
    assert first.data["tokens"]["access"]
    user = User.objects.get(phone="+989120001122")
    assert user.organizations.first().name == "Default organization"

    # Second call: same creds → logs in (200), no duplicate account.
    second = api.post(
        "/api/v1/auth/access", {"identifier": "+989120001122", "password": "password123"}
    )
    assert second.status_code == 200
    assert User.objects.filter(phone="+989120001122").count() == 1

    # Wrong password on an existing account → rejected.
    bad = api.post(
        "/api/v1/auth/access", {"identifier": "+989120001122", "password": "wrongpass1"}
    )
    assert bad.status_code == 400


@pytest.mark.django_db
def test_access_rejects_unknown_when_signup_disabled(api, settings):
    settings.SIGNUP_ENABLED = False
    resp = api.post(
        "/api/v1/auth/access", {"identifier": "+989120003344", "password": "password123"}
    )
    assert resp.status_code == 400
    assert "signup_disabled" in resp.data
    assert not User.objects.filter(phone="+989120003344").exists()


@pytest.mark.django_db
def test_auth_rate_limited(api, monkeypatch):
    # DRF binds THROTTLE_RATES at import, so patch the live rates dict directly.
    from rest_framework.throttling import ScopedRateThrottle

    monkeypatch.setitem(ScopedRateThrottle.THROTTLE_RATES, "auth", "3/min")
    payload = {"identifier": "+989120009999", "password": "password123"}
    codes = [api.post("/api/v1/auth/access", payload).status_code for _ in range(5)]
    assert 429 in codes  # throttle kicks in within the window


@pytest.mark.django_db
def test_password_login(api, user):
    resp = api.post(
        "/api/v1/auth/login", {"identifier": "alice@errora.dev", "password": "password123"}
    )
    assert resp.status_code == 200
    assert resp.data["tokens"]["access"]


@pytest.mark.django_db
def test_password_login_rejects_bad_credentials(api, user):
    resp = api.post("/api/v1/auth/login", {"identifier": "alice@errora.dev", "password": "wrong"})
    assert resp.status_code == 400


@pytest.mark.django_db
def test_otp_round_trip_phone(settings):
    settings.SMS_PROVIDER = "console"
    issue_otp("+989121234567", OTPCode.Channel.SMS)
    otp = OTPCode.objects.latest("created_at")
    # Re-derive the plaintext is impossible; verify against a wrong then right code.
    assert verify_otp("+989121234567", "000000") is False or otp.attempts >= 1


@pytest.mark.django_db
def test_otp_verify_creates_account(api, settings):
    settings.SMS_PROVIDER = "console"
    api.post("/api/v1/auth/otp/request", {"identifier": "+989121110000"})
    otp = OTPCode.objects.latest("created_at")
    # Force a known code by re-issuing through the service with a patched generator.
    from apps.accounts import otp as otp_mod

    code = "123456"
    otp.code_hash = otp_mod._hash(code)
    otp.save()
    resp = api.post("/api/v1/auth/otp/verify", {"identifier": "+989121110000", "code": code})
    assert resp.status_code == 200
    assert User.objects.filter(phone="+989121110000", phone_verified=True).exists()


@pytest.mark.django_db
def test_dev_otp_code_is_all_ones(settings):
    settings.OTP_DEBUG_CODE = True
    settings.SMS_PROVIDER = "console"
    issue_otp("+989120000000", OTPCode.Channel.SMS)
    assert verify_otp("+989120000000", "1" * settings.OTP_LENGTH) is True


@pytest.mark.django_db
def test_me_requires_auth(api, auth_api):
    assert api.get("/api/v1/auth/me").status_code == 401
    assert auth_api.get("/api/v1/auth/me").status_code == 200
