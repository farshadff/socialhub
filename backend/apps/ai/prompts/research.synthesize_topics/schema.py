from typing import Literal

from pydantic import BaseModel, Field

Format = Literal["reel", "story", "feed_post"]


class TopicDraft(BaseModel):
    title: str = Field(max_length=120, description="Short name of the topic, in the content language.")
    summary: str = Field(max_length=600, description="What is happening, in two or three sentences.")
    why_now: str = Field(max_length=300, description="Why this matters this week.")
    hooks: list[str] = Field(
        min_length=2, max_length=5, description="Opening lines or angles, each at most 160 characters."
    )
    suggested_formats: list[Format] = Field(
        min_length=1, max_length=3, description="Formats this topic suits."
    )
    keywords: list[str] = Field(
        min_length=3, max_length=8, description="Search-style keywords, each at most 40 characters."
    )
    signal_ids: list[int] = Field(
        min_length=1, max_length=20, description="IDs of supplied signals that support this topic."
    )


class TopicSynthesis(BaseModel):
    topics: list[TopicDraft] = Field(max_length=8, description="The topics, strongest first.")


Output = TopicSynthesis  # name required by the gateway registry (E00-S05 rule 5)
