"""Link frozen receipts to the inputs that superseded them."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PROBE = ROOT / 'probes/nsh-validation'


def controls_evidence():
    return json.loads((PROBE / 'desktop-composer-controls-verification.json').read_text())


def picker_evidence():
    return json.loads((PROBE / 'desktop-model-picker-verification.json').read_text())


def hover_evidence():
    return json.loads((PROBE / 'desktop-control-hover-verification.json').read_text())


def session_preview_evidence():
    return json.loads((PROBE / 'desktop-session-preview-verification.json').read_text())


def turn_queue_evidence():
    return json.loads((PROBE / 'desktop-turn-queue-verification.json').read_text())


def successor_input(test, evidence, path, previous):
    if path not in evidence['previousInputs']:
        return previous
    digest = previous if isinstance(previous, str) else previous['sha256']
    test.assertEqual(evidence['previousInputs'][path], digest, path)
    current = evidence['inputs'][path]
    return current['sha256'] if isinstance(previous, str) else current


def statistics_evidence():
    return json.loads((PROBE / 'desktop-composer-statistics-verification.json').read_text())


def statistics_split_evidence():
    return json.loads((PROBE / 'desktop-statistics-split-verification.json').read_text())


def sidebar_jewel_evidence():
    return json.loads((PROBE / 'desktop-sidebar-jewel-verification.json').read_text())


def settings_evidence():
    return json.loads((PROBE / 'desktop-settings-verification.json').read_text())


def wenkai_evidence():
    return json.loads((PROBE / 'desktop-wenkai-verification.json').read_text())


def live_models_evidence():
    return json.loads((PROBE / 'desktop-live-models-evidence.json').read_text())


def desktop_profile_evidence():
    return json.loads((PROBE / 'desktop-profile-evidence.json').read_text())


def desktop_persistent_evidence():
    return json.loads((PROBE / 'desktop-persistent-evidence.json').read_text())


def desktop_package_evidence():
    return json.loads((PROBE / 'desktop-package-evidence.json').read_text())


def current_composer_input(test, path, previous, *, after=None):
    evidence_chain = (controls_evidence, picker_evidence, hover_evidence, session_preview_evidence,
                      turn_queue_evidence, statistics_evidence, statistics_split_evidence, sidebar_jewel_evidence,
                      settings_evidence, wenkai_evidence, live_models_evidence, desktop_profile_evidence,
                      desktop_persistent_evidence, desktop_package_evidence)
    start = evidence_chain.index(after) + 1 if after is not None else 0
    for evidence in evidence_chain[start:]:
        previous = successor_input(test, evidence(), path, previous)
    return previous
