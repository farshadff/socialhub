"""`job_finished` receivers (E04-S03 rule 20)."""

from .services import briefs

try:
    from apps.core.jobs import job_finished
except ImportError:  # E00-S06 signal not available yet
    job_finished = None

if job_finished is not None:
    job_finished.connect(briefs.update_batch_parent, dispatch_uid="content.update_batch_parent")
