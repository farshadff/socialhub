from datetime import date

from pydantic import BaseModel, Field


class ExtractedSignal(BaseModel):
    url: str = Field(description="Exactly one of the URLs in the supplied results list.")
    title: str = Field(
        max_length=300, description="The page or article title, in its original language."
    )
    excerpt: str = Field(
        max_length=1000,
        description="Two or three sentences on what the source says and why it matters to the audience.",
    )
    author: str = Field(max_length=120, description="Publisher or site name.")
    published_at: date | None = Field(
        description="Publication date if stated in the text, else null."
    )
    relevance: int = Field(ge=0, le=100, description="How relevant this is to the query and audience.")


class ExtractedSignals(BaseModel):
    signals: list[ExtractedSignal] = Field(max_length=8, description="The extracted signals.")


Output = ExtractedSignals  # name required by the gateway registry (E00-S05 rule 5)
