from django.contrib import admin

from .models import AccountConnection, BrandProfile, InstagramAccount

# The encrypted Instagram token never appears in the admin (E00-S03-BE1).
_SECRET_FIELDS = ("access_token_encrypted",)


class BrandProfileInline(admin.StackedInline):
    model = BrandProfile
    can_delete = False


class AccountConnectionInline(admin.StackedInline):
    model = AccountConnection
    can_delete = False
    exclude = _SECRET_FIELDS


@admin.register(InstagramAccount)
class InstagramAccountAdmin(admin.ModelAdmin):
    list_display = ("handle", "display_name", "content_language", "timezone", "status",
                    "publishing_enabled")
    list_filter = ("status", "content_language")
    search_fields = ("handle", "display_name")
    inlines = [BrandProfileInline, AccountConnectionInline]


@admin.register(AccountConnection)
class AccountConnectionAdmin(admin.ModelAdmin):
    list_display = ("account", "provider", "status", "username", "token_expires_at")
    list_filter = ("provider", "status")
    search_fields = ("account__handle", "username")
    exclude = _SECRET_FIELDS
