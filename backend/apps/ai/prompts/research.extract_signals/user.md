Window starts: {{ window_start }}
Maximum signals: {{ max_signals }}

Results (the only URLs you may use):
{% for r in results %}- {{ r.url }}{% if r.title %} — {{ r.title }}{% endif %}
{% endfor %}
Research summary:
{{ search_text }}
