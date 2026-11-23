"""Output schemas of the research AI tasks (E02-S02, E02-S04).

The prompt directories' `schema.py` files re-export these as `Output`, because a dotted directory
name such as `research.extract_signals` cannot be imported as a Python package.
"""

from datetime import date
from typing import Literal

from pydantic import BaseModel, Field

FormatValue = Literal["reel", "story", "feed_post"]


class ExtractedSignal(BaseModel):
    url: str = Field(description="Exactly one of the URLs in the supplied results list.")
    title: str = Field(max_length=300,
                       description="The page or article title, in its original language.")
    excerpt: str = Field(max_length=1000, description=(
        "Two or three sentences on what the source says and why it matters to the audience."))
    author: str = Field(max_length=120, description="Publisher or site name.")
    published_at: date | None = Field(
        description="Publication date if stated in the text, else null.")
    relevance: int = Field(ge=0, le=100,
                           description="How relevant this is to the query and audience.")


class ExtractedSignals(BaseModel):
    signals: list[ExtractedSignal] = Field(max_length=8, description="The findings, at most 8.")


class TopicDraft(BaseModel):
    title: str = Field(max_length=120,
                       description="Short name of the topic, in the content language.")
    summary: str = Field(max_length=600,
                         description="What is happening, in two or three sentences.")
    why_now: str = Field(max_length=300, description="Why this matters this week.")
    hooks: list[str] = Field(min_length=2, max_length=5, description=(
        "Opening lines or angles, each at most 160 characters."))
    suggested_formats: list[FormatValue] = Field(
        min_length=1, max_length=3, description="Formats this topic suits.")
    keywords: list[str] = Field(min_length=3, max_length=8, description=(
        "Search-style keywords, each at most 40 characters."))
    signal_ids: list[int] = Field(min_length=1, max_length=20, description=(
        "IDs of supplied signals that support this topic."))


class TopicSynthesis(BaseModel):
    topics: list[TopicDraft] = Field(max_length=8, description="The topics, strongest first.")
