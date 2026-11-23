Query: {{ query }}
Date window: {{ window_start }} to {{ window_end }}
{% if audience_summary %}Audience: {{ audience_summary }}
{% endif %}{% if content_pillars %}Content pillars: {{ content_pillars | join(", ") }}
{% endif %}{% if objective %}This week's objective: {{ objective }}
{% endif %}
List the findings, one per paragraph, each with URL, publisher, date and gist.
