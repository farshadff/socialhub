"""AI task registry: runtime options per prompt task (E00-S05 rules 5-6, AI-INTEGRATION.md 4).

Each key names a directory `apps/ai/prompts/<key>/` with `system.md`, `user.md`, `VERSION`,
`fixture.json` (text tasks), optional `fixture.<variant>.json`, optional `fake.py` and optional
`schema.py` exporting `Output`. Image tasks need only `VERSION`; their prompt is built in code.
The `ai.E0xx` system check fails startup when a registered task is missing a file.

Note: this module is the task *table*, not Celery tasks (those live in `apps/ai/jobs.py`).

Later stories add their rows in their own block at the end of this file:

    # --- E0x --- <story> ----------------------------------------------------------
    TASKS.update({
        "brief.generate": TaskSpec(provider="text", effort="medium", max_tokens=4000),
    })

Effort per task comes from AI-INTEGRATION.md section 4.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

PROVIDERS = ("text", "image")
EFFORTS = ("low", "medium", "high")
NON_STREAMING_MAX_TOKENS = 16000


@dataclass(frozen=True)
class TaskSpec:
    """Runtime options of one AI task.

    - `provider`: `text` (Claude) or `image` (OpenAI image generation).
    - `effort`: `low`, `medium` or `high`; sent as `output_config.effort`. None for image tasks.
    - `max_tokens`: output cap; non-streaming calls are capped at 16,000 (rule 17).
    - `stream`: stream long outputs and use the SDK's final-message helper.
    - `cache_brand`: with an `account_id`, add the account's brand block to the cached prefix.
    """

    provider: Literal["text", "image"]
    effort: Literal["low", "medium", "high"] | None = None
    max_tokens: int = NON_STREAMING_MAX_TOKENS
    stream: bool = False
    cache_brand: bool = True


TASKS: dict[str, TaskSpec] = {
    # --- E00 --- AI gateway connectivity checks (E00-S05) ---------------------------------------
    "system.ping": TaskSpec(provider="text", effort="low", max_tokens=64, stream=False),
    "system.ping_image": TaskSpec(provider="image"),
}

# --- end E00 tasks --- later stories append `TASKS.update({...})` blocks below this line ------

# --- E04-E06 --- briefs, scripts, copy and background images (E04-S03, E05-S01, E06-S05/S06) ----
TASKS.update({
    "brief.generate": TaskSpec(provider="text", effort="medium", max_tokens=4000),
    "script.generate": TaskSpec(provider="text", effort="high", max_tokens=16000, stream=True),
    "copy.generate": TaskSpec(provider="text", effort="medium", max_tokens=4000),
    "image.generate": TaskSpec(provider="image"),
})

# --- E02 --- trend research: web search, signal extraction, topic synthesis (E02-S02, E02-S04) --
TASKS.update({
    "research.web_search": TaskSpec(provider="text", effort="medium"),
    "research.extract_signals": TaskSpec(provider="text", effort="low"),
    "research.synthesize_topics": TaskSpec(provider="text", effort="high", max_tokens=32000,
                                           stream=True),
})
