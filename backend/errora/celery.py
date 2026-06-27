"""Celery application — Redis broker (per project spec, not Kafka)."""

import os

from celery import Celery

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "errora.settings")

app = Celery("errora")
app.config_from_object("django.conf:settings", namespace="CELERY")
app.autodiscover_tasks()


@app.task(bind=True, ignore_result=True)
def debug_task(self) -> None:  # pragma: no cover
    print(f"Request: {self.request!r}")
