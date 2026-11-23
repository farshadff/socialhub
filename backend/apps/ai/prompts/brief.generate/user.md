Write the brief for this piece.

## Item
{{ item | tojson }}

## Role
{% if role %}{{ role | tojson }}{% else %}No role is set. Choose the best fit from these roles and return its key in `role`:
{{ roles | tojson }}{% endif %}

## Slot
{{ slot | tojson }}

## Weekly plan
{{ plan | tojson }}

## Candidate and sources
{{ candidate | tojson }}

## Source detail
{{ source_detail | tojson }}

## Format rules
{{ format_rules | tojson }}

## Other items this week
{{ week_items | tojson }}
{% if previous %}

## Previous version
{{ previous | tojson }}

## Feedback to apply
{{ feedback }}
{% endif %}
{% if repair %}

## Repair
Your previous output broke these rules. Fix exactly these issues and keep everything else.
{{ repair | tojson }}
{% endif %}
