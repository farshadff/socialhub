import secrets

import pytest
from django.contrib.auth import get_user_model
from django.core.management import CommandError, call_command

pytestmark = pytest.mark.django_db


def test_seed_users_creates_admin_and_operator(settings):
    settings.DEBUG = True
    password = secrets.token_urlsafe(24)
    call_command("seed_users", password=password)
    call_command("seed_users", password=password)  # idempotent
    User = get_user_model()
    admin, operator = User.objects.get(username="admin"), User.objects.get(username="operator")
    assert admin.is_superuser and admin.is_staff and admin.check_password(password)
    assert not operator.is_superuser and operator.check_password(password)
    assert User.objects.count() == 2


def test_seed_users_needs_password_and_debug(settings, monkeypatch):
    monkeypatch.delenv("SOCIALHUB_E2E_PASSWORD", raising=False)
    settings.DEBUG = True
    with pytest.raises(CommandError, match="password"):
        call_command("seed_users")
    settings.DEBUG = False
    with pytest.raises(CommandError, match="DEBUG"):
        call_command("seed_users", password="x")
