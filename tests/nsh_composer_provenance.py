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


def idle_host_evidence():
    return json.loads((PROBE / 'desktop-appkit-idle-host-evidence.json').read_text())


def desktop_team_goal_evidence():
    return json.loads((PROBE / 'desktop-team-goal-evidence.json').read_text())


def desktop_management_evidence():
    return json.loads((PROBE / 'desktop-management-evidence.json').read_text())


def desktop_archive_evidence():
    return json.loads((PROBE / 'desktop-archive-evidence.json').read_text())


def desktop_import_evidence():
    return json.loads((PROBE / 'desktop-import-evidence.json').read_text())


def desktop_workspace_layout_evidence():
    return json.loads((PROBE / 'desktop-workspace-layout-evidence.json').read_text())


def desktop_workspace_migration_evidence():
    return json.loads((PROBE / 'desktop-workspace-migration-evidence.json').read_text())


def desktop_turn_layout_evidence():
    return json.loads((PROBE / 'desktop-turn-layout-evidence.json').read_text())


def desktop_first_draft_evidence():
    return json.loads((PROBE / 'desktop-first-draft-evidence.json').read_text())


def desktop_session_switch_evidence():
    return json.loads((PROBE / 'desktop-session-switch-evidence.json').read_text())


def desktop_startup_splash_evidence():
    return json.loads((PROBE / "desktop-startup-splash-evidence.json").read_text())


def desktop_command_preview_evidence():
    return json.loads((PROBE / 'desktop-command-preview-evidence.json').read_text())


def desktop_analysis_caption_evidence():
    return json.loads((PROBE / 'desktop-analysis-caption-evidence.json').read_text())


def desktop_session_completion_evidence():
    return json.loads((PROBE / 'desktop-session-completion-evidence.json').read_text())


def desktop_composer_layout_evidence():
    return json.loads((PROBE / 'desktop-composer-layout-evidence.json').read_text())


def desktop_composer_font_evidence():
    return json.loads((PROBE / 'desktop-composer-font-evidence.json').read_text())


def desktop_image_preview_evidence():
    return json.loads((PROBE / 'desktop-image-preview-evidence.json').read_text())


def current_composer_input(test, path, previous, *, after=None):
    evidence_chain = (controls_evidence, picker_evidence, hover_evidence, session_preview_evidence,
                      turn_queue_evidence, statistics_evidence, statistics_split_evidence, sidebar_jewel_evidence,
                      settings_evidence, wenkai_evidence, live_models_evidence, desktop_profile_evidence,
                      desktop_persistent_evidence, desktop_package_evidence, idle_host_evidence,
                      desktop_team_goal_evidence, desktop_management_evidence, desktop_archive_evidence, desktop_import_evidence,
                      desktop_workspace_layout_evidence, desktop_workspace_migration_evidence, desktop_turn_layout_evidence, desktop_first_draft_evidence,
                      desktop_session_switch_evidence, desktop_startup_splash_evidence, desktop_command_preview_evidence,
                      desktop_analysis_caption_evidence, desktop_session_completion_evidence, desktop_composer_layout_evidence, desktop_composer_font_evidence, desktop_image_preview_evidence)
    start = evidence_chain.index(after) + 1 if after is not None else 0
    for evidence in evidence_chain[start:]:
        previous = successor_input(test, evidence(), path, previous)
    return previous
