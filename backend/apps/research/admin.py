from django.contrib import admin

from .models import ResearchRun, ResearchSource, TrendSignal, TrendTopic


@admin.register(ResearchSource)
class ResearchSourceAdmin(admin.ModelAdmin):
    list_display = ("account", "kind", "label", "value", "active", "last_run_at", "last_status")
    list_filter = ("kind", "active")


@admin.register(ResearchRun)
class ResearchRunAdmin(admin.ModelAdmin):
    list_display = ("id", "account", "plan", "status", "started_at", "finished_at")
    list_filter = ("status",)
    raw_id_fields = ("job", "plan")


@admin.register(TrendSignal)
class TrendSignalAdmin(admin.ModelAdmin):
    list_display = ("title", "account", "kind", "author", "published_at", "captured_at")
    list_filter = ("kind",)
    search_fields = ("title", "url", "author")
    raw_id_fields = ("run", "source")


@admin.register(TrendTopic)
class TrendTopicAdmin(admin.ModelAdmin):
    list_display = ("title", "account", "plan", "status", "origin", "evidence_score")
    list_filter = ("status", "origin")
    raw_id_fields = ("run", "plan", "signals")
