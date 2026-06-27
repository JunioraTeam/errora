from django.apps import AppConfig


class NotificationsConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.notifications"

    def ready(self) -> None:
        from apps.ai.signals import autofix_failed, autofix_mr_created, autofix_started
        from apps.issues.signals import event_stored, issue_created, issue_regressed

        from .dispatch import dispatch
        from .events import EventType

        def on_issue_created(sender, issue, event, **kw):
            dispatch(
                EventType.ISSUE_CREATED,
                organization=issue.project.organization,
                project=issue.project,
                issue=issue,
            )

        def on_event_stored(sender, issue, event, is_new_issue, **kw):
            dispatch(
                EventType.EVENT_RECEIVED,
                organization=issue.project.organization,
                project=issue.project,
                issue=issue,
            )

        def on_issue_regressed(sender, issue, event, **kw):
            dispatch(
                EventType.ISSUE_REGRESSED,
                organization=issue.project.organization,
                project=issue.project,
                issue=issue,
            )

        def on_autofix(event_type):
            def handler(sender, run, **kw):
                dispatch(
                    event_type,
                    organization=run.issue.project.organization,
                    project=run.issue.project,
                    run=run,
                )

            return handler

        issue_created.connect(on_issue_created, dispatch_uid="notif_issue_created", weak=False)
        event_stored.connect(on_event_stored, dispatch_uid="notif_event_stored", weak=False)
        issue_regressed.connect(on_issue_regressed, dispatch_uid="notif_regressed", weak=False)

        # Keep the per-org "has matching rule?" cache fresh when rules change.
        from django.db.models.signals import post_delete, post_save

        from .dispatch import invalidate_rule_flag
        from .models import AlertRule

        def on_rule_changed(sender, instance, **kw):
            invalidate_rule_flag(instance.organization_id, instance.event_type)

        post_save.connect(on_rule_changed, sender=AlertRule, dispatch_uid="notif_rule_flag_save")
        post_delete.connect(on_rule_changed, sender=AlertRule, dispatch_uid="notif_rule_flag_del")
        autofix_started.connect(
            on_autofix(EventType.AUTOFIX_STARTED), dispatch_uid="notif_af_started", weak=False
        )
        autofix_mr_created.connect(
            on_autofix(EventType.AUTOFIX_MR_CREATED), dispatch_uid="notif_af_mr", weak=False
        )
        autofix_failed.connect(
            on_autofix(EventType.AUTOFIX_FAILED), dispatch_uid="notif_af_failed", weak=False
        )
