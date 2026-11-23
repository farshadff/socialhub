"""`python manage.py reencrypt_secrets`: re-encrypt stored tokens with the first key (rule 18).

Idempotent: a token already encrypted with the first key is left as is. A token no key can
decrypt is left untouched and counted; its connection fails with `token_invalid` on next use.
"""

from django.core.management.base import BaseCommand
from django.db import transaction

from apps.accounts.models import AccountConnection
from apps.core import crypto


class Command(BaseCommand):
    help = "Re-encrypt every stored Instagram access token with the first SOCIALHUB_ENCRYPTION_KEY."

    def handle(self, *args, **options):
        rotated = unchanged = unreadable = 0
        ids = (AccountConnection.objects.filter(access_token_encrypted__isnull=False)
               .exclude(access_token_encrypted="").values_list("pk", flat=True))
        for pk in list(ids):
            with transaction.atomic():
                connection = AccountConnection.objects.select_for_update().get(pk=pk)
                value = connection.access_token_encrypted
                if not value:
                    continue
                if not crypto.needs_rotation(value):
                    unchanged += 1
                    continue
                try:
                    connection.access_token_encrypted = crypto.rotate(value)
                except crypto.DecryptionError:
                    unreadable += 1
                    continue
                connection.save(update_fields=["access_token_encrypted", "updated_at"])
                rotated += 1
        self.stdout.write(f"Re-encrypted {rotated} token(s); {unchanged} already current; "
                          f"{unreadable} unreadable.")
