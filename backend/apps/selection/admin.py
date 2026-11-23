from django.contrib import admin

from .models import Candidate


@admin.register(Candidate)
class CandidateAdmin(admin.ModelAdmin):
    list_display = ("title", "kind", "plan", "status", "rank", "total_score")
    list_filter = ("kind", "status")
