## Script rules for this format
{{ rules | tojson }}

## Frame templates and their limits
{{ templates | tojson }}

## Item
{{ item | tojson }}

## Approved brief
{{ brief | tojson }}
{% if feedback %}

## Feedback to apply
{{ feedback }}
{% endif %}
{% if previous_package %}

## Previous package
{{ previous_package | tojson }}
{% endif %}
{% if frame_indexes %}

## Frames that may change
{{ frame_indexes | tojson }}
{% endif %}
{% if violations %}

## Rule violations to fix
{{ violations | tojson }}
{% endif %}

Write the complete script package.
