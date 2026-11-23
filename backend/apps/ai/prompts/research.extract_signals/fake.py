"""Fake provider output for research.extract_signals.

Builds one signal per supplied result. Variants: `out_of_list_url` adds a signal whose URL the
search never returned; `low_relevance` marks the last signal with relevance 10.
"""

from datetime import date, timedelta


def build(variables: dict, variant: str | None) -> dict:
    window_start = date.fromisoformat(variables.get("window_start") or date.today().isoformat())
    results = variables.get("results") or []
    signals = [
        {
            "url": r["url"],
            "title": r.get("title") or f"Finding {i}",
            "excerpt": "Sample excerpt: a café trend worth a short reel this week.",
            "author": "Example Publisher",
            "published_at": (window_start + timedelta(days=1 + i)).isoformat(),
            "relevance": 80,
        }
        for i, r in enumerate(results[: variables.get("max_signals", 8)])
    ]
    if variant == "out_of_list_url":
        signals.append({"url": "https://not-in-results.example.org/story", "title": "Invented",
                        "excerpt": "Not from the search.", "author": "Nobody",
                        "published_at": None, "relevance": 90})
    if variant == "low_relevance" and signals:
        signals[-1]["relevance"] = 10
    return {"signals": signals[:8]}
