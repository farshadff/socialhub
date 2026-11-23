"""Output of `brief.generate` (E04-S03, AI section).

Character limits are stated in descriptions and enforced in code by `validate_brief`, because
structured output does not guarantee string lengths. References and the success metric are set
in code, not by the model.
"""

from typing import Literal

from pydantic import BaseModel, Field

Role = Literal["attract", "educate", "build_trust", "convert", "engage"]


class Output(BaseModel):
    role: Role = Field(description="The role of this piece. Must equal the given role when one "
                                   "is given.")
    objective: str = Field(description="What this piece must achieve for the week's goals. "
                                       "20–400 characters.")
    key_message: str = Field(description="The one thing the viewer should take away. 10–200 "
                                         "characters.")
    hook_direction: str = Field(description="How the first second or first line grabs "
                                            "attention. 10–300 characters.")
    audience_note: str = Field(description="Who exactly this piece speaks to within the week's "
                                           "audience. At most 300 characters.")
    cta: str = Field(description="Call to action, at most 120 characters. Required for the "
                                 "convert role, otherwise may be empty.")
    must_include: list[str] = Field(max_length=6, description="Points or facts that must "
                                    "appear, each at most 120 characters, taken from the sources.")
    must_avoid: list[str] = Field(max_length=6, description="Things the piece must not say or "
                                  "show, each at most 120 characters.")
    format_notes: str = Field(description="Length, pacing and format-specific guidance for the "
                                          "script writer. 10–600 characters.")
