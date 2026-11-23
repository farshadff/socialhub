from apps.core.jobs import register_job_kind, register_job_target

from .models import DummyItem

register_job_target("test_item", DummyItem)
register_job_kind("test.echo", task="core_testapp.echo", queue="default",
                  target_type="test_item")
register_job_kind("test.verify", task="core_testapp.verify", queue="default",
                  target_type="test_connection", conflicts_with=["test.refresh"])
register_job_kind("test.refresh", task="core_testapp.refresh", queue="default",
                  target_type="test_connection", conflicts_with=["test.verify"])
register_job_kind("test.render", task="core_testapp.render", queue="render",
                  target_type="test_item")
register_job_kind("test.prunable", task="core_testapp.prunable", queue="default",
                  target_type="system", prunable=True)
register_job_kind("test.pipeline", task=None, queue="default", target_type="test_item")
