"""Fake provider output for research.synthesize_topics (E02-S04 fake scenario).

Three topics: one valid, built from the supplied signals; one that references only an unknown
signal ID; one whose title repeats an existing topic (with none, a dismissed one, else the
valid topic's own title), so validation always drops two. Text is
Persian with zero-width non-joiners, so storage round-trips can be checked.
"""


def build(variables: dict, variant: str | None) -> dict:
    ids = [s["id"] for s in variables.get("signals", [])]
    existing = [t["title"] for t in variables.get("existing_topics", [])]
    valid = {
        "title": "بازگشت قهوه دمی به منوی کافه‌ها",
        "summary": "کافه‌ها از افزایش سفارش قهوه دمی خبر می‌دهند؛ مشتری‌ها دنبال فنجان سبک‌تر هستند.",
        "why_now": "در یک هفته گذشته چند منبع به این تغییر پرداخته‌اند.",
        "hooks": ["چرا همه دوباره سراغ قهوه دمی رفته‌اند؟",
                  "اسپرسو یا دمی؟ جواب کافه‌دارها عوض شده"],
        "suggested_formats": ["reel", "feed_post"],
        "keywords": ["قهوه دمی", "بچ برو", "پور اور"],
        "signal_ids": ids[:4] or [1],
    }
    repeated = (existing or variables.get("dismissed_topics") or [valid["title"]])[0]
    unknown = {**valid, "title": "موضوع بدون شاهد", "signal_ids": [max(ids or [0]) + 100000]}
    duplicate = {**valid, "title": repeated, "signal_ids": ids[:1] or [1]}
    return {"topics": [valid, unknown, duplicate]}
