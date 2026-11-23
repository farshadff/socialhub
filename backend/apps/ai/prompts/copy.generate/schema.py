"""Output of `copy.generate` (E06-S06, AI section)."""

from pydantic import BaseModel, Field


class CopyOutput(BaseModel):
    caption: str = Field(description="Caption in the content language. First line works on its "
                                     "own. No hashtags inside.", max_length=2000)
    hashtags: list[str] = Field(description="Topic hashtags without '#', most specific first. "
                                            "Do not repeat the brand defaults.", max_length=10)
    alt_text: str = Field(description="One sentence describing the visual for someone who "
                                      "cannot see it.", max_length=100)
    first_line: str = Field(description="The caption's first line, repeated, for a length check.",
                            max_length=140)


Output = CopyOutput
