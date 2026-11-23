"""E00-S04 token encryption (rules 17-18), key rotation and the startup checks (rule 42)."""

import os
import subprocess
import sys
from io import StringIO
from pathlib import Path

import pytest
from cryptography.fernet import Fernet
from django.core.management import call_command

from apps.core import crypto

KEY_A = Fernet.generate_key().decode()
KEY_B = Fernet.generate_key().decode()
BACKEND = Path(__file__).resolve().parents[3]


def test_round_trip_is_fernet_ciphertext():
    ciphertext = crypto.encrypt("fake-token-1-1")
    assert ciphertext != "fake-token-1-1" and ciphertext.startswith("gAAAAA")
    assert crypto.decrypt(ciphertext) == "fake-token-1-1"
    assert crypto.encrypt("same") != crypto.encrypt("same")  # random IV


def test_undecryptable_value(settings):
    settings.SOCIALHUB_ENCRYPTION_KEY = [KEY_A]
    ciphertext = crypto.encrypt("secret")
    settings.SOCIALHUB_ENCRYPTION_KEY = [KEY_B]
    with pytest.raises(crypto.DecryptionError) as caught:
        crypto.decrypt(ciphertext)
    assert "secret" not in str(caught.value)
    with pytest.raises(crypto.DecryptionError):
        crypto.decrypt("not-fernet")


def test_first_key_encrypts_every_key_decrypts(settings):
    settings.SOCIALHUB_ENCRYPTION_KEY = [KEY_A]
    old = crypto.encrypt("secret")
    settings.SOCIALHUB_ENCRYPTION_KEY = [KEY_B, KEY_A]
    assert crypto.decrypt(old) == "secret"
    assert crypto.needs_rotation(old) is True
    new = crypto.encrypt("secret")
    assert crypto.needs_rotation(new) is False
    settings.SOCIALHUB_ENCRYPTION_KEY = [KEY_B]
    assert crypto.decrypt(new) == "secret"


@pytest.mark.django_db
def test_reencrypt_secrets_rotates_every_token(settings):
    """AC9 (second half): tokens under key A, setting `B,A`, command, then `B` alone."""
    from apps.accounts.models import AccountConnection
    from apps.accounts.tests.factories import make_account

    settings.SOCIALHUB_ENCRYPTION_KEY = [KEY_A]
    accounts = [make_account(connected=True) for _ in range(2)]
    make_account(connection={"provider": "manual", "status": "connected"})
    settings.SOCIALHUB_ENCRYPTION_KEY = [KEY_B, KEY_A]
    out = StringIO()
    call_command("reencrypt_secrets", stdout=out)
    assert "Re-encrypted 2 token(s); 0 already current; 0 unreadable." in out.getvalue()
    out = StringIO()
    call_command("reencrypt_secrets", stdout=out)  # idempotent
    assert "Re-encrypted 0 token(s); 2 already current" in out.getvalue()
    settings.SOCIALHUB_ENCRYPTION_KEY = [KEY_B]
    for account in accounts:
        stored = AccountConnection.objects.get(account=account).access_token_encrypted
        assert crypto.decrypt(stored) == f"fake-token-{account.pk}-0"


# --- startup checks (subprocess: settings are read once per process) ------------------------

HOSTED_ENV = {
    "DJANGO_SECRET_KEY": "hosted-secret-key-for-a-test",
    "DJANGO_DEBUG": "false",
    "SOCIALHUB_DB_ENGINE": "postgresql",
    "SOCIALHUB_AI_TEXT_PROVIDER": "anthropic",
    "SOCIALHUB_AI_IMAGE_PROVIDER": "openai",
    "SOCIALHUB_MEDIA_BACKEND": "s3",
    "SOCIALHUB_S3_BUCKET": "socialhub-media",
    "SOCIALHUB_S3_ACCESS_KEY_ID": "testing",
    "SOCIALHUB_S3_SECRET_ACCESS_KEY": "testing",
    "SOCIALHUB_IG_ALLOWED_PROVIDERS": "manual",
}


def _load_settings(extra: dict, drop=()) -> subprocess.CompletedProcess:
    env = {key: value for key, value in os.environ.items()
           if not key.startswith(("SOCIALHUB_", "DJANGO_"))}
    env.update(HOSTED_ENV)
    env.update(extra)
    for key in drop:
        env.pop(key, None)
    return subprocess.run([sys.executable, "-c", "import config.settings"], cwd=BACKEND,
                          env=env, capture_output=True, text=True, timeout=60)


def test_hosted_settings_load_with_a_key_and_without_the_old_publisher_settings():
    """AC21: no SOCIALHUB_PUBLISHER_PROVIDER / SOCIALHUB_PUBLISHING_ENABLED needed."""
    result = _load_settings({"SOCIALHUB_ENCRYPTION_KEY": f"{KEY_B},{KEY_A}"})
    assert result.returncode == 0, result.stderr


@pytest.mark.parametrize("value", [None, "not-a-fernet-key", f"{KEY_A},broken"])
def test_missing_or_invalid_key_fails_startup(value):
    """AC9 (first half)."""
    extra = {} if value is None else {"SOCIALHUB_ENCRYPTION_KEY": value}
    result = _load_settings(extra, drop=() if value else ("SOCIALHUB_ENCRYPTION_KEY",))
    assert result.returncode != 0
    assert "ImproperlyConfigured" in result.stderr
    assert "SOCIALHUB_ENCRYPTION_KEY" in result.stderr


def test_graph_api_default_provider_is_refused():
    result = _load_settings({"SOCIALHUB_ENCRYPTION_KEY": KEY_A,
                             "SOCIALHUB_IG_ALLOWED_PROVIDERS": "graph_api,manual",
                             "SOCIALHUB_IG_DEFAULT_PROVIDER": "graph_api",
                             "SOCIALHUB_META_APP_ID": "1", "SOCIALHUB_META_APP_SECRET": "s",
                             "SOCIALHUB_META_REDIRECT_URI": "https://social.example.com/cb/",
                             "SOCIALHUB_IG_API_VERSION": "v23.0"})
    assert result.returncode != 0
    assert "graph_api adapter is not built" in result.stderr


def test_hosted_graph_api_needs_the_meta_settings():
    result = _load_settings({"SOCIALHUB_ENCRYPTION_KEY": KEY_A,
                             "SOCIALHUB_IG_ALLOWED_PROVIDERS": "graph_api,manual",
                             "SOCIALHUB_IG_DEFAULT_PROVIDER": "manual"})
    assert result.returncode != 0
    assert "SOCIALHUB_META_APP_ID" in result.stderr


def test_default_provider_outside_the_allowed_list_is_refused():
    result = _load_settings({"SOCIALHUB_ENCRYPTION_KEY": KEY_A,
                             "SOCIALHUB_IG_DEFAULT_PROVIDER": "fake"})
    assert result.returncode != 0
    assert "SOCIALHUB_IG_ALLOWED_PROVIDERS" in result.stderr
