"""Create or update the `admin` (superuser) and `operator` users for local use and E2E tests.

The password comes from `--password` or `SOCIALHUB_E2E_PASSWORD`; nothing is hard-coded.
Refused when DEBUG is off unless `--allow-production` is given.
"""

import os

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError

USERS = (
    {"username": "admin", "is_superuser": True, "is_staff": True},
    {"username": "operator", "is_superuser": False, "is_staff": False},
)


def seed_users(password: str):
    User = get_user_model()
    created = []
    for spec in USERS:
        user, was_created = User.objects.get_or_create(username=spec["username"])
        user.is_superuser = spec["is_superuser"]
        user.is_staff = spec["is_staff"]
        user.is_active = True
        user.set_password(password)
        user.save()
        created.append((user, was_created))
    return created


class Command(BaseCommand):
    help = "Create or update the admin and operator users (local development and E2E only)."

    def add_arguments(self, parser):
        parser.add_argument("--password", help="Defaults to SOCIALHUB_E2E_PASSWORD.")
        parser.add_argument("--allow-production", action="store_true")

    def handle(self, *args, password=None, allow_production=False, **options):
        if not settings.DEBUG and not allow_production:
            raise CommandError("Refusing to seed users with DEBUG off; pass --allow-production.")
        password = password or os.environ.get("SOCIALHUB_E2E_PASSWORD", "")
        if not password:
            raise CommandError("Pass --password or set SOCIALHUB_E2E_PASSWORD.")
        for user, was_created in seed_users(password):
            role = "admin" if user.is_superuser else "operator"
            verb = "Created" if was_created else "Updated"
            self.stdout.write(f"{verb} {user.username} ({role})")
