from django.db import models


class DummyItem(models.Model):
    """Stands in for ContentItem (E03): a job target with an `active_job` field."""

    title = models.CharField(max_length=40, default="")
    active_job = models.ForeignKey("core.JobRun", null=True, blank=True,
                                   on_delete=models.SET_NULL, related_name="+")


class JobReference(models.Model):
    """Stands in for AIRun.job and similar rows that keep a job from being pruned."""

    job = models.ForeignKey("core.JobRun", on_delete=models.CASCADE, related_name="+")
