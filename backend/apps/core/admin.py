from django.contrib import admin

from .models import JobRun


@admin.register(JobRun)
class JobRunAdmin(admin.ModelAdmin):
    list_display = ("created_at", "kind", "status", "progress", "account", "target_type", "target_id")
    list_filter = ("status", "kind", "queue")
    search_fields = ("id", "target_id")
    readonly_fields = [field.name for field in JobRun._meta.fields]
