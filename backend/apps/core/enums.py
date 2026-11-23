"""Shared enums from DATA-MODEL.md section 1. Values are stored as lowercase text."""

from django.db import models


class Format(models.TextChoices):
    REEL = "reel", "Reel"
    STORY = "story", "Story"
    FEED_POST = "feed_post", "Feed post"


class Role(models.TextChoices):
    ATTRACT = "attract", "Attract"
    EDUCATE = "educate", "Educate"
    BUILD_TRUST = "build_trust", "Build trust"
    CONVERT = "convert", "Convert"
    ENGAGE = "engage", "Engage"


class Metric(models.TextChoices):
    REACH = "reach", "Reach"
    VIEWS = "views", "Views"
    LIKES = "likes", "Likes"
    COMMENTS = "comments", "Comments"
    SAVES = "saves", "Saves"
    SHARES = "shares", "Shares"
    REPLIES = "replies", "Replies"
    FOLLOWER_GROWTH = "follower_growth", "Follower growth"


# Reels and feed posts share the daily feed limit and the minimum gap; stories do not.
FEED_FORMATS = frozenset({Format.REEL, Format.FEED_POST})
