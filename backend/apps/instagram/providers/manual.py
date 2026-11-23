"""The `manual` provider (E00-S04 rule 15): no token, never calls Instagram.

Choosing it connects the account at once with every capability false. Its connection methods
are never called by Social Hub; every method raises `NotSupported`, which makes publishing and
analytics use their manual flows (E08 manual delivery, E09 manual entry).
"""

from __future__ import annotations

from .base import NotSupported


class ManualProvider:
    name = "manual"

    def _unsupported(self, *args, **kwargs):
        raise NotSupported("Manual posting does not call Instagram.")

    authorize_url = exchange_code = refresh_token = verify = _unsupported
    publishing_quota = create_container = container_status = publish_container = _unsupported
    get_media = list_recent_media = list_active_stories = _unsupported
    media_insights = account_stats = _unsupported
