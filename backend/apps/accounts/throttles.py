"""Failed sign-in throttle (E00-S01 rule 5).

Five failed attempts for one lowercase username and client IP within 15 minutes block further
attempts until the oldest of them leaves the window. Only failures count; a successful sign-in
clears the counter. Counters live in the Django cache (Redis), shared between processes.
"""

import hashlib
import math
from datetime import timedelta

from django.core.cache import cache
from rest_framework.throttling import BaseThrottle

from apps.core import clock


class LoginThrottle(BaseThrottle):
    max_failures = 5
    window = timedelta(minutes=15)
    cache_prefix = "auth:login-failures:"

    def _key(self, request, username: str) -> str:
        ident = f"{username.strip().lower()}|{self.get_ident(request)}"
        return self.cache_prefix + hashlib.sha256(ident.encode()).hexdigest()

    def _recent(self, key: str) -> list[float]:
        cutoff = clock.now().timestamp() - self.window.total_seconds()
        return [t for t in cache.get(key, []) if t > cutoff]

    def wait_seconds(self, request, username: str) -> int | None:
        """Seconds until another attempt is allowed, or None when not blocked."""
        failures = self._recent(self._key(request, username))
        if len(failures) < self.max_failures:
            return None
        oldest_blocking = sorted(failures)[-self.max_failures]
        wait = oldest_blocking + self.window.total_seconds() - clock.now().timestamp()
        return max(1, math.ceil(wait))

    def record_failure(self, request, username: str) -> None:
        key = self._key(request, username)
        failures = self._recent(key) + [clock.now().timestamp()]
        cache.set(key, failures[-self.max_failures:], timeout=int(self.window.total_seconds()))

    def reset(self, request, username: str) -> None:
        cache.delete(self._key(request, username))

    def allow_request(self, request, view):  # not used as a DRF view throttle
        return True
