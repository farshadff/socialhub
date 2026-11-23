"""`render_brand_block`: the deterministic brand block of the cached AI prompt prefix."""

import pytest

from apps.accounts.brand import render_brand_block

from .factories import make_account

pytestmark = pytest.mark.django_db

BRAND = {
    "tone_of_voice": "Warm, practical.\r\nShort sentences.",
    "audience_summary": "Homeowners aged 28-45.",
    "content_pillars": ["Energy saving tips", "Before and after"],
    "banned_terms": ["guaranteed"],
    "cta_examples": ["Save this for later."],
    "handle_display": "@greenhome.ir",
    # Keys deliberately out of order and in lowercase: the block must not depend on either.
    "colors": {"text": "#1b1b1b", "background": "#FFFFFF", "accent": "#F2A541",
               "secondary": "#21295C", "primary": "#0B6E4F"},
    "fonts": {"body": "noto-sans-arabic", "heading": "vazirmatn"},
}

EXPECTED = """# Brand profile

## Tone of voice
Warm, practical.
Short sentences.

## Audience
Homeowners aged 28-45.

## Content pillars
- Energy saving tips
- Before and after

## Banned terms
- guaranteed

## CTA examples
- Save this for later.

## Handle
@greenhome.ir

## Content language
fa (Persian)

## Colours
- primary: #0B6E4F
- secondary: #21295C
- accent: #F2A541
- background: #FFFFFF
- text: #1B1B1B

## Fonts
- heading: vazirmatn
- body: noto-sans-arabic
"""


def test_render_brand_block_fixed_order():
    account = make_account(handle="greenhome.ir", brand=BRAND)
    assert render_brand_block(account) == EXPECTED


def test_render_brand_block_is_deterministic_and_has_no_ids_or_times():
    first = make_account(id=987654, handle="greenhome.ir", brand=BRAND)
    block = render_brand_block(first)
    first.brand.save()  # a new updated_at must not change the block
    first.refresh_from_db()
    assert render_brand_block(first) == block
    assert "987654" not in block
    assert str(first.brand.updated_at.year) not in block
    second = make_account(handle="other", brand={**BRAND, "colors": dict(BRAND["colors"])})
    assert render_brand_block(second) == block  # same brand, different account row


def test_render_brand_block_defaults():
    account = make_account(handle="plain", content_language="en")
    block = render_brand_block(account)
    assert "## Tone of voice\n(not set)\n" in block
    assert "## Content pillars\n- (none)\n" in block
    assert "## Handle\n@plain\n" in block
    assert "## Content language\nen (English)\n" in block
    assert "- heading: vazirmatn\n- body: vazirmatn\n" in block
