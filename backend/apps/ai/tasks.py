"""Runtime options of every AI task (AI-INTEGRATION.md section 4, E00-S05 rules 5–6)."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class TaskSpec:
    provider: str  # "text" or "image"
    effort: str  # "low", "medium", "high"
    max_tokens: int = 16000
    stream: bool = False
    cache_brand: bool = True


TASKS: dict[str, TaskSpec] = {
    "system.ping": TaskSpec(provider="text", effort="low", max_tokens=64, stream=False),
    "research.web_search": TaskSpec(provider="text", effort="medium"),
    "research.extract_signals": TaskSpec(provider="text", effort="low"),
    "research.synthesize_topics": TaskSpec(
        provider="text", effort="high", max_tokens=32000, stream=True
    ),
}


def register_task(key: str, spec: TaskSpec) -> None:
    """Lets other apps add their tasks from their AppConfig.ready()."""
    existing = TASKS.get(key)
    if existing is not None and existing != spec:
        raise ValueError(f"AI task {key!r} is registered twice with different options")
    TASKS[key] = spec
