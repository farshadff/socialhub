from django.contrib import admin

from .models import BrandProfile, InstagramAccount


class BrandProfileInline(admin.StackedInline):
    model = BrandProfile
    can_delete = False
    extra = 0


@admin.register(InstagramAccount)
class InstagramAccountAdmin(admin.ModelAdmin):
    list_display = ("handle", "display_name", "timezone", "week_start_day", "status")
    list_filter = ("status", "content_language")
    search_fields = ("handle", "display_name")
    exclude = ("publishing_enabled",)
    inlines = [BrandProfileInline]
