## Format
{{ format_label }}; caption limit {{ caption_max_chars }} characters; {{ disclosure_reserved_chars }} characters reserved for a disclosure line.

## Hashtags
Slots for your proposals: {{ hashtag_slots }}. Brand defaults (already included, do not repeat): {{ default_hashtags | tojson }}

## Brief
{{ brief | tojson }}

## Script
{{ script | tojson }}

## Frame text as it appears on the asset
{{ frames | tojson }}

## Brand
{{ brand | tojson }}
{% if avoid_terms %}

## Terms to avoid
{{ avoid_terms | tojson }}
{% endif %}
{% if feedback %}

## Current copy
{{ current | tojson }}

## Feedback to apply
{{ feedback }}
{% endif %}
