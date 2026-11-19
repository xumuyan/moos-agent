"""Link frozen receipts to the inputs that superseded them."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PROBE = ROOT / 'probes/nsh-validation'


def controls_evidence():
    return json.loads((PROBE / 'desktop-composer-controls-verification.json').read_text())


def current_composer_input(test, path, previous):
    evidence = controls_evidence()
    if path not in evidence['previousInputs']:
        return previous
    digest = previous if isinstance(previous, str) else previous['sha256']
    test.assertEqual(evidence['previousInputs'][path], digest, path)
    current = evidence['inputs'][path]
    return current['sha256'] if isinstance(previous, str) else current
