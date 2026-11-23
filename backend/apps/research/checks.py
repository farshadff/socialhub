from django.conf import settings
from django.core.checks import Error, register

from .services.evidence import COMPONENTS


@register()
def evidence_weights_check(app_configs, **kwargs):
    weights = getattr(settings, "SOCIALHUB_RESEARCH_EVIDENCE_WEIGHTS", None)
    if weights is None:
        return []
    if set(weights) != set(COMPONENTS):
        return [Error("SOCIALHUB_RESEARCH_EVIDENCE_WEIGHTS must have exactly the keys "
                      f"{', '.join(COMPONENTS)}.", id="research.E001")]
    if abs(sum(weights.values()) - 1) > 1e-6:
        return [Error("SOCIALHUB_RESEARCH_EVIDENCE_WEIGHTS must sum to 1.", id="research.E002")]
    return []
