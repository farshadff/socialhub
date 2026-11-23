"""E04-S01 test notes: format sizes and limits are read from the registry, never hard-coded."""

import re
from pathlib import Path

from django.test import SimpleTestCase

APPS = Path(__file__).resolve().parents[2]
SCANNED = ("production", "quality", "publishing", "analytics")
LITERAL = re.compile(r'(?<![\w.])(1350|1920|2200)(?![\w.])|["\'](9x16|4x5)["\']')


class NoFormatLiteralsTests(SimpleTestCase):
    def test_no_size_or_limit_literals_outside_the_registry(self):
        offenders = []
        for app in SCANNED:
            for path in (APPS / app).rglob("*.py"):
                if "tests" in path.parts or "migrations" in path.parts:
                    continue
                for n, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
                    code = line.split("#", 1)[0]
                    if LITERAL.search(code):
                        offenders.append(f"{path.relative_to(APPS)}:{n}")
        self.assertEqual(offenders, [], "Use apps.content.formats instead of literals")
