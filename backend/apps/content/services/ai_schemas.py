"""Load a prompt task's output model from `apps/ai/prompts/<task key>/schema.py`.

Task directories are named after dotted keys, so they cannot be imported as packages; the file
is loaded by path. The AI gateway (E00-S05) may expose its own loader; it is preferred.
"""

from __future__ import annotations

import importlib.util
from functools import lru_cache
from pathlib import Path

PROMPTS_DIR = Path(__file__).resolve().parents[2] / "ai" / "prompts"


@lru_cache(maxsize=None)
def output_schema(task: str):
    try:
        from apps.ai import registry

        for name in ("schema_for", "output_schema", "get_schema"):
            fn = getattr(registry, name, None)
            if callable(fn):
                return fn(task)
    except ImportError:
        pass
    path = PROMPTS_DIR / task / "schema.py"
    spec = importlib.util.spec_from_file_location(f"socialhub_prompt_{task.replace('.', '_')}",
                                                  path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.Output
