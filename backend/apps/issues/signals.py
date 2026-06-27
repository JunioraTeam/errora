"""Domain signals other apps subscribe to (notifications, billing, ai)."""

import django.dispatch

# Fired once when a brand-new unique issue (exception type) is created.
issue_created = django.dispatch.Signal()  # kwargs: issue, event
# Fired for every stored event.
event_stored = django.dispatch.Signal()  # kwargs: issue, event, is_new_issue
# Fired when a resolved issue starts receiving events again.
issue_regressed = django.dispatch.Signal()  # kwargs: issue, event
