from django.contrib import admin

from .models import JobRun


@admin.register(JobRun)
class JobRunAdmin(admin.ModelAdmin):
    list_display = ("kind", "status", "account", "target_type", "target_id", "progress",
                    "created_at")
    list_filter = ("status", "kind")
    readonly_fields = [f.name for f in JobRun._meta.fields]
