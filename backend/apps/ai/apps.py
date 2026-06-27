from django.apps import AppConfig


class AIConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.ai"
    label = "ai"

    def ready(self) -> None:
        from apps.issues.signals import issue_created

        from .tasks import maybe_auto_trigger

        def _on_issue_created(sender, issue, event, **kwargs):
            maybe_auto_trigger.delay(str(issue.id))

        issue_created.connect(_on_issue_created, dispatch_uid="ai_auto_trigger", weak=False)
