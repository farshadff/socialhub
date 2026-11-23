Today: {{ today }}
Content language: {{ content_language }}
Return at most {{ max_topics }} topics.

Brand:
{{ brand | tojson }}

Week plan:
{{ plan | tojson }}

Formats:
{{ formats | tojson }}

Topics that already exist (do not repeat):
{{ existing_topics | tojson }}

Dismissed topics (do not propose again):
{{ dismissed_topics | tojson }}

Signals:
{{ signals | tojson }}
