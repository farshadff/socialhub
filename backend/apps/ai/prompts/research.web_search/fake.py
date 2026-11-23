"""Fake provider output for research.web_search (E02-S02 fake-provider scenarios).

Variants: default `ok` (three results derived from the query, so different queries yield
different URLs), `empty` (no results), `refused`.
"""

import hashlib


def build(variables: dict, variant: str | None) -> dict:
    query = variables.get("query", "")
    if variant == "refused":
        from apps.ai.errors import ProviderRefused

        raise ProviderRefused("refused")
    if variant == "empty":
        return {"text": f"No recent material was found for “{query}”.", "citations": []}
    slug = hashlib.sha256(query.encode("utf-8")).hexdigest()[:10]
    citations = [
        {"url": f"https://example.com/research/{slug}/{n}", "title": f"Finding {n} on {query}"}
        for n in (1, 2, 3)
    ]
    lines = [f"- {c['url']} — {c['title']}: a recent article about {query}." for c in citations]
    return {"text": "\n".join(lines), "citations": citations}
