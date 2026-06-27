"""Signals emitted by the auto-fix flow (notifications app subscribes)."""

import django.dispatch

autofix_started = django.dispatch.Signal()  # kwargs: run
autofix_mr_created = django.dispatch.Signal()  # kwargs: run
autofix_failed = django.dispatch.Signal()  # kwargs: run
