from unittest import mock

from django.db import transaction
from django.test import TestCase, TransactionTestCase

from apps.core.errors import InvalidTransition

from ..models import ContentEvent, ContentItem
from ..services import pipeline
from .factories import make_item, make_user

S = ContentItem.Status


class TransitionTableTests(TestCase):
    def test_every_listed_move_succeeds_and_writes_one_event(self):
        for source, targets in pipeline.ALLOWED_TRANSITIONS.items():
            for target in targets:
                with self.subTest(source=source, target=target):
                    item = make_item(status=source)
                    before = ContentEvent.objects.filter(content_item=item).count()
                    with mock.patch.object(pipeline, "advance"):
                        pipeline.transition(item, target)
                    item.refresh_from_db()
                    self.assertEqual(item.status, target)
                    self.assertEqual(ContentEvent.objects.filter(content_item=item).count(),
                                     before + 1)

    def test_unlisted_move_raises_and_writes_nothing(self):
        item = make_item(status=S.SELECTED)
        with self.assertRaises(InvalidTransition):
            pipeline.transition(item, S.SCRIPTED)
        item.refresh_from_db()
        self.assertEqual(item.status, S.SELECTED)
        self.assertEqual(ContentEvent.objects.filter(content_item=item).count(), 1)

    def test_create_item_writes_selected_event(self):
        item = make_item()
        event = ContentEvent.objects.get(content_item=item)
        self.assertEqual((event.type, event.to_status), ("status_changed", "selected"))

    def test_transition_clears_hold_reason(self):
        item = make_item()
        pipeline.set_hold_reason(item, "Brief waiting for approval")
        with mock.patch.object(pipeline, "advance"):
            pipeline.transition(item, S.BRIEFED, actor=make_user())
        item.refresh_from_db()
        self.assertEqual(item.hold_reason, "")


class OnCommitTests(TransactionTestCase):
    def test_handler_runs_after_commit_not_after_rollback(self):
        calls = []
        item = make_item()
        with mock.patch.dict(pipeline._handlers, {S.BRIEFED: lambda i: calls.append(i.pk)}):
            try:
                with transaction.atomic():
                    pipeline.transition(item, S.BRIEFED)
                    raise RuntimeError("rollback")
            except RuntimeError:
                pass
            self.assertEqual(calls, [])
            pipeline.transition(item, S.BRIEFED)
            self.assertEqual(calls, [item.pk])

    def test_handler_failure_is_isolated(self):
        item = make_item()

        def boom(_item):
            raise ValueError("bad")

        with mock.patch.dict(pipeline._handlers, {S.SELECTED: boom}):
            pipeline.advance(item.pk)
        item.refresh_from_db()
        self.assertEqual(item.status, S.SELECTED)
        self.assertTrue(item.hold_reason.startswith("Automatic step failed"))
        self.assertTrue(ContentEvent.objects.filter(content_item=item, type="job_failed").exists())


class CancelTests(TestCase):
    def test_cancel_releases_future_slot(self):
        item = make_item(status=S.BRIEFED)
        slot = item.slot
        pipeline.cancel(item, reason="No longer relevant", actor=make_user())
        item.refresh_from_db()
        slot.refresh_from_db()
        self.assertEqual(item.status, S.CANCELLED)
        self.assertIsNone(item.slot)
        self.assertEqual(slot.status, "open")
        self.assertEqual(item.candidate.status, "selected")

    def test_cancel_releases_candidate(self):
        item = make_item(status=S.BRIEFED)
        pipeline.cancel(item, reason="Again later", release_candidate=True)
        item.candidate.refresh_from_db()
        self.assertEqual(item.candidate.status, "candidate")

    def test_cannot_cancel_while_publishing(self):
        item = make_item(status=S.PUBLISHING)
        with self.assertRaises(InvalidTransition) as ctx:
            pipeline.cancel(item, reason="Stop it")
        self.assertEqual(ctx.exception.details["reason"], "publishing_in_progress")
