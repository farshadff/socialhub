from django.contrib import admin

from .models import PlanGoal, PlanSlot, SlotTemplate, WeeklyPlan


class PlanGoalInline(admin.TabularInline):
    model = PlanGoal
    extra = 0


class PlanSlotInline(admin.TabularInline):
    model = PlanSlot
    extra = 0


@admin.register(WeeklyPlan)
class WeeklyPlanAdmin(admin.ModelAdmin):
    list_display = ("title", "account", "week_start", "week_end", "status")
    list_filter = ("status", "account")
    exclude = ("week_end",)
    inlines = [PlanGoalInline, PlanSlotInline]


@admin.register(SlotTemplate)
class SlotTemplateAdmin(admin.ModelAdmin):
    list_display = ("account", "weekday", "local_time", "format", "default_role", "active")
    list_filter = ("account", "format", "active")
