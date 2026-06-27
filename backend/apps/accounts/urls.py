from django.urls import path

from . import token_views, views

app_name = "accounts"

urlpatterns = [
    path("tokens", token_views.ApiTokenListView.as_view(), name="tokens"),
    path("tokens/<uuid:pk>", token_views.ApiTokenDetailView.as_view(), name="token-detail"),
    path("access", views.AccessView.as_view(), name="access"),
    path("register", views.RegisterView.as_view(), name="register"),
    path("login", views.PasswordLoginView.as_view(), name="login"),
    path("otp/request", views.OTPRequestView.as_view(), name="otp-request"),
    path("otp/verify", views.OTPVerifyView.as_view(), name="otp-verify"),
    path("refresh", views.RefreshView.as_view(), name="refresh"),
    path("logout", views.LogoutView.as_view(), name="logout"),
    path("me", views.MeView.as_view(), name="me"),
    path("password", views.ChangePasswordView.as_view(), name="password"),
    path("totp/setup", views.TOTPSetupView.as_view(), name="totp-setup"),
    path("totp/enable", views.TOTPEnableView.as_view(), name="totp-enable"),
    path("totp/disable", views.TOTPDisableView.as_view(), name="totp-disable"),
]
