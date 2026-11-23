"""Create demo content items for E04-E06 (thin foundation until E01-E03 screens exist).

    python manage.py seed_content_demo [--handle demo.greenhome] [--advance]

Creates (or reuses) an account with a brand profile, an active plan for the current week with
one slot per demo item, a candidate per item, and items in `selected` through the pipeline
service. With `--advance` the pipeline runs for each item (the brief job starts when the job
system and the AI gateway are available).
"""

from __future__ import annotations

from datetime import datetime, time, timedelta
from zoneinfo import ZoneInfo

from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone

from apps.accounts.models import InstagramAccount
from apps.planning.models import PlanSlot, WeeklyPlan
from apps.selection.models import Candidate

from ... import formats
from ...models import ContentItem
from ...services import pipeline

ITEMS = [
    {"title": "پنج دقیقه برای میز مرتب", "format": "reel", "role": "educate", "day": 1,
     "summary": "روال‌های کوتاه مرتب کردن میز کار در حساب‌های خانه و دفتر خانگی پخش شده‌اند.",
     "sources": [{"title": "Why tidy desks are trending again",
                  "url": "https://example.org/articles/tidy-desks"}]},
    {"title": "سه نشانه که قبض گازتان زیاد است", "format": "feed_post", "role": "attract",
     "day": 2, "summary": "با سرد شدن هوا جست‌وجوی راه‌های کم کردن قبض گاز بالا رفته است.",
     "sources": [{"title": "Winter energy saving guide",
                  "url": "https://example.org/guides/winter-energy"}]},
    {"title": "قبل و بعد از عایق‌کاری پنجره", "format": "story", "role": "build_trust",
     "day": 3, "summary": "مشتری‌ها نتیجه‌ی عایق‌کاری پنجره را با عکس قبل و بعد نشان می‌دهند.",
     "sources": [{"title": "Customer story: double glazing",
                  "url": "https://example.org/stories/double-glazing"}]},
    {"title": "ست نظم‌دهنده‌ی میز این هفته", "format": "reel", "role": "convert", "day": 4,
     "mode": "video", "summary": "ست جدید نظم‌دهنده‌ی میز این هفته با ارسال رایگان عرضه می‌شود.",
     "sources": [{"title": "Organiser set launch", "url": "https://example.org/launch"}]},
]


class Command(BaseCommand):
    help = "Create demo content items for the E04-E06 workspace."

    def add_arguments(self, parser):
        parser.add_argument("--handle", default="demo.greenhome")
        parser.add_argument("--advance", action="store_true",
                            help="Run the pipeline for each item (starts brief generation).")

    def handle(self, *args, handle, advance, **options):
        with transaction.atomic():
            account, created = InstagramAccount.objects.get_or_create(
                handle=handle, defaults={"display_name": "Green Home (demo)",
                                         "content_language": "fa"})
            brand = getattr(account, "brand", None)
            if brand is not None:
                brand.colors = {"primary": "#0B6E4F", "secondary": "#21295C",
                                "accent": "#F2A541", "background": "#FFFFFF", "text": "#1B1B1B"}
                brand.fonts = {"heading": "vazirmatn", "body": "vazirmatn"}
                brand.tone_of_voice = ("گرم، کاربردی و دلگرم‌کننده. جمله‌های کوتاه. مخاطب را "
                                       "«شما» خطاب می‌کند. بدون اغراق.")
                brand.audience_summary = "صاحب‌خانه‌های ۲۸ تا ۴۵ ساله در شهرهای بزرگ."
                brand.content_pillars = ["صرفه‌جویی انرژی", "قبل و بعد", "داستان مشتری"]
                brand.default_hashtags = ["خانه_سبز"]
                brand.banned_terms = ["تضمینی", "ارزان‌ترین"]
                brand.cta_examples = ["این پست را برای تعمیر بعدی ذخیره کنید."]
                brand.save()
            tz = ZoneInfo(account.timezone)
            today = timezone.now().astimezone(tz).date()
            start = today - timedelta(days=(today.weekday() - account.week_start_day) % 7)
            plan, _ = WeeklyPlan.objects.get_or_create(
                account=account, week_start=start,
                defaults={"week_end": start + timedelta(days=6), "status": "active",
                          "title": f"Week of {start.day} {start:%b}",
                          "objective": "Grow saves and shares among homeowners this week.",
                          "audience_summary": "Homeowners aged 28–45 in large cities.",
                          "success_metrics": ["reach", "saves", "shares"],
                          "activated_at": timezone.now()})
            if plan.status != "active":
                plan.status = "active"
                plan.save(update_fields=["status", "updated_at"])
            made = []
            for n, spec in enumerate(ITEMS):
                if ContentItem.objects.filter(plan=plan, title=spec["title"]).exclude(
                        status="cancelled").exists():
                    continue
                day = max(spec["day"], (today - start).days + 1)
                when = datetime.combine(start + timedelta(days=min(day, 6)), time(19, 0),
                                        tzinfo=tz)
                if when <= timezone.now() + timedelta(hours=1):
                    when = timezone.now() + timedelta(days=1, hours=n)
                slot = PlanSlot.objects.create(plan=plan, scheduled_at=when,
                                               format=spec["format"], role=spec["role"],
                                               status="reserved")
                candidate = Candidate.objects.create(
                    account=account, plan=plan, kind="trend", title=spec["title"],
                    summary=spec["summary"], suggested_formats=[spec["format"]],
                    suggested_role=spec["role"], sources=spec["sources"], evidence_score=70,
                    goal_fit_score=80, freshness_score=75, total_score="75.50",
                    rationale="Fits the week's goals and the brand's content pillars.",
                    rank=n + 1, status="selected", proposed_slot=slot)
                media, mode = formats.defaults_for(spec["format"])
                mode = spec.get("mode", mode)
                item = pipeline.create_item(
                    account=account, plan=plan, slot=slot, candidate=candidate,
                    title=spec["title"], format=spec["format"], media_kind=media,
                    production_mode=mode, role=spec["role"],
                    message=f"Selected for the {spec['format']} slot",
                    data={"candidate_id": candidate.pk, "slot_id": slot.pk, "rank": n + 1})
                made.append(item)
        for item in made:
            self.stdout.write(f"Item #{item.pk}: {item.title} ({item.format}/"
                              f"{item.production_mode})")
            if advance:
                pipeline.advance(item.pk)
        self.stdout.write(self.style.SUCCESS(
            f"Account @{account.handle} (id {account.pk}), plan {plan.pk}: "
            f"{len(made)} new item(s)."))
