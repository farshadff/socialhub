from django.contrib import admin

from .models import ResearchRun, ResearchSource, TrendSignal, TrendTopic


@admin.register(ResearchSource)
class ResearchSourceAdmin(admin.ModelAdmin):
    list_display = ("label", "kind", "account", "active", "last_status", "last_run_at")
    list_filter = ("kind", "active", "account")
    search_fields = ("value", "label")


@admin.register(ResearchRun)
class ResearchRunAdmin(admin.ModelAdmin):
    list_display = ("id", "account", "plan", "status", "started_at", "finished_at")
    list_filter = ("status", "account")
    readonly_fields = ("job", "params", "stats", "started_at", "finished_at", "started_by")


@admin.register(TrendSignal)
class TrendSignalAdmin(admin.ModelAdmin):
    list_display = ("title", "kind", "account", "author", "published_at", "captured_at")
    list_filter = ("kind", "account")
    search_fields = ("title", "excerpt", "author", "url")
    readonly_fields = ("fingerprint", "raw")


@admin.register(TrendTopic)
class TrendTopicAdmin(admin.ModelAdmin):
    list_display = ("title", "account", "plan", "status", "origin", "evidence_score")
    list_filter = ("status", "origin", "account")
    search_fields = ("title", "summary")
    filter_horizontal = ("signals",)
