"""Encryption of stored secrets (E00-S04 rules 17-18).

`SOCIALHUB_ENCRYPTION_KEY` is a list of Fernet keys (settings.py validates them at startup): the
first key encrypts and every key decrypts (`MultiFernet`). To rotate, put the new key first,
deploy, run `python manage.py reencrypt_secrets`, then remove the old key.
"""

from __future__ import annotations

from cryptography.fernet import Fernet, InvalidToken, MultiFernet
from django.conf import settings
from django.core.signals import setting_changed
from django.dispatch import receiver

_cached: tuple[tuple[str, ...], MultiFernet] | None = None


class DecryptionError(ValueError):
    """No configured key can decrypt the value (or it is not Fernet ciphertext)."""


def _keys() -> tuple[str, ...]:
    keys = settings.SOCIALHUB_ENCRYPTION_KEY
    if isinstance(keys, str):
        keys = [key.strip() for key in keys.split(",") if key.strip()]
    return tuple(keys)


def _fernet() -> MultiFernet:
    global _cached
    keys = _keys()
    if _cached is None or _cached[0] != keys:
        _cached = (keys, MultiFernet([Fernet(key) for key in keys]))
    return _cached[1]


@receiver(setting_changed)
def _reset(setting, **kwargs):
    global _cached
    if setting == "SOCIALHUB_ENCRYPTION_KEY":
        _cached = None


def encrypt(plaintext: str) -> str:
    """Fernet ciphertext (URL-safe base64 text) of `plaintext`, with the first key."""
    return _fernet().encrypt(plaintext.encode()).decode()


def decrypt(ciphertext: str) -> str:
    """The plaintext; raises `DecryptionError` when no key can decrypt it."""
    try:
        return _fernet().decrypt(ciphertext.encode()).decode()
    except (InvalidToken, ValueError, TypeError, AttributeError):
        raise DecryptionError("The value cannot be decrypted with any configured key.") from None


def needs_rotation(ciphertext: str) -> bool:
    """True when the first key cannot decrypt the value (it was written with an older key)."""
    try:
        Fernet(_keys()[0]).decrypt(ciphertext.encode())
    except (InvalidToken, ValueError, TypeError, AttributeError):
        return True
    return False


def rotate(ciphertext: str) -> str:
    """Re-encrypt with the first key; raises `DecryptionError` when no key can decrypt it."""
    try:
        return _fernet().rotate(ciphertext.encode()).decode()
    except (InvalidToken, ValueError, TypeError, AttributeError):
        raise DecryptionError("The value cannot be decrypted with any configured key.") from None
