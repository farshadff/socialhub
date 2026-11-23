from django.contrib import admin

from .models import AIRun


@admin.register(AIRun)
class AIRunAdmin(admin.ModelAdmin):
    list_display = ("id", "created_at", "task", "provider", "model", "status", "cost_usd",
                    "latency_ms")
    list_filter = ("provider", "status", "task")
    readonly_fields = [field.name for field in AIRun._meta.fields]

    def has_add_permission(self, request):
        return False
