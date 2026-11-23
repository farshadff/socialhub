"""Output of `script.generate`: the script package (DATA-MODEL.md, ScriptVersion payload).

Numeric ranges and text lengths depend on the format and are enforced by
`content.services.scripts.validate_script_package`, not by this schema.
"""

from typing import Literal

from pydantic import BaseModel, Field


class Shot(BaseModel):
    index: int = Field(description="1-based position of the shot, in order.")
    duration_seconds: int = Field(description="Whole seconds; 0 for image formats.")
    type: Literal["footage", "graphic", "text"] = Field(
        description="footage only in video mode; graphic or text otherwise.")
    description: str = Field(description="What is seen. 5–300 characters.")
    on_screen_text: str = Field(description="Text shown on screen. At most 120 characters.")
    voiceover: str = Field(description="Voiceover note, may be empty. At most 300 characters.")
    asset_hint: str = Field(description="What footage or image is needed; required for footage "
                                        "shots. At most 200 characters.")


class Frame(BaseModel):
    index: int = Field(description="1-based position of the frame, in order.")
    shot_index: int = Field(description="The shot this frame belongs to; never decreases.")
    template: Literal["title", "statement", "stat", "list", "quote", "image_caption", "cta"] = (
        Field(description="Render template; limits per template are given in the prompt."))
    headline: str = Field(description="Main text, within the template's headline limit.")
    body: str = Field(description="Supporting text; for list, 2–5 lines separated by \\n.")
    visual_prompt: str = Field(description="Background image description with no text, letters, "
                                           "logos or watermarks. At most 400 characters.")
    duration_seconds: int = Field(description="Whole seconds; 0 for image formats.")
    transition: Literal["cut", "fade", "slide"] = Field(description="cut for image formats.")


class DesignNotes(BaseModel):
    mood: str = Field(description="Required. At most 300 characters.")
    color_usage: str = Field(description="At most 300 characters.")
    typography: str = Field(description="At most 300 characters.")
    imagery_style: str = Field(description="At most 300 characters.")
    layout: str = Field(description="Required. At most 300 characters.")
    do: list[str] = Field(max_length=6, description="Up to 6 items, each at most 120 characters.")
    dont: list[str] = Field(max_length=6, description="Up to 6 items, each at most 120 "
                                                      "characters.")


class ScriptPackage(BaseModel):
    scenario: str = Field(description="What happens from first second to last. 20–1,200 "
                                      "characters.")
    hook: str = Field(description="The opening line or image. 5–140 characters.")
    duration_seconds: int = Field(description="Sum of the shots' durations; 0 for image formats.")
    shots: list[Shot] = Field(max_length=10, description="Shots in order.")
    frames: list[Frame] = Field(max_length=10, description="Frames in order.")
    design_notes: DesignNotes = Field(description="Design direction for every frame: mood, "
                                                  "colour, typography, imagery, layout.")
    cta: str = Field(description="Closing call to action. At most 120 characters.")
    music_hint: str = Field(description="Music direction; empty for image formats. At most 120 "
                                        "characters.")


Output = ScriptPackage
