Today: {{ today }}
Maximum topics: {{ max_topics }}

Brand
- Content pillars: {{ brand.content_pillars | join(", ") or "—" }}
- Tone of voice: {{ brand.tone_of_voice or "—" }}
- Audience: {{ brand.audience_summary or "—" }}
- Banned terms (never use): {{ brand.banned_terms | join(", ") or "—" }}

Formats
{% for f in formats %}- {{ f.value }}: {{ f.guide }}
{% endfor %}
{% if plan %}Weekly plan ({{ plan.week_start }} to {{ plan.week_end }})
- Objective: {{ plan.objective or "—" }}
- Audience: {{ plan.audience_summary or "—" }}
{% for s in plan.audience_segments %}- Segment {{ s.name }}: {{ s.description }}
{% endfor %}- Success metrics: {{ plan.success_metrics | join(", ") }}
{% else %}No weekly plan is linked to this research.
{% endif %}
Topics that already exist (do not repeat):
{% for t in existing_topics %}- {{ t.title }}{% if t.keywords %} ({{ t.keywords | join(", ") }}){% endif %}
{% else %}- none
{% endfor %}
Dismissed topics (never propose again):
{% for title in dismissed_topics %}- {{ title }}
{% else %}- none
{% endfor %}
Signals:
{% for s in signals %}[{{ s.id }}] {{ s.kind }} · {{ s.author or "unknown" }} · {{ s.published_at or "no date" }}{% if s.metrics %} · {{ s.metrics | tojson }}{% endif %}
{{ s.title }}
{{ s.excerpt }}

{% endfor %}
