# DSH 原版前端全面对齐 Implementation Plan

> **For agentic workers:** Execute inline in the existing codex/dsh-ui-plugin-design worktree. User has approved the written design; do not ask for the same scope again. Use the repository delivery order and preserve independent commit checkpoints.

**Goal:** Replace the accumulated mixed presentation with one coherent DSH frontend connected to actual Moos capabilities.

**Architecture:** Fixed upstream fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159 presentation and geometry adapt to existing Moos commands/view models. No DSH runtime/backend or new server. Keep branded icons, plugin sandbox, task control and data contracts.

**Tech Stack:** Tauri 2, React, TypeScript, CSS, existing Ant Design controls and PI SDK; CSS/markup adaptation with retained MIT provenance.

## File responsibilities

- `apps/desktop/src/layout/` owns visible shell, sidebar and right-panel state/geometry; `App.tsx` wires existing commands and current project/conversation.
- `apps/desktop/src/theme/dsh/` owns the sole new reference tokens and visual layer; remove deprecated visual imports as their replacements land, not additive overrides forever.
- `apps/desktop/src/conversation/` retains factual timeline/history and receives reference presentation.
- `apps/desktop/src/settings/` owns settings layout; `themes/` maps skin values without resetting saved selection.
- `docs/third-party/deepseek-harness.md` and `THIRD_PARTY_NOTICES.md` track actual copied/adapted source and license.

## Task P03.1: reference theme and provenance

- [ ] Record upstream CSS/TS paths and adopted constants before code transfer. Preserve MIT copyright and map source naming to Moos.
- [ ] Add tests asserting theme selection/fallback remains stable and new shell can use explicit presentation tokens without touching credentials.
- [ ] Introduce `apps/desktop/src/theme/dsh/tokens.css` with default neutral page/sidebar/border/text/control values, mapping skin inputs through existing --moos-* variables. Remove default declarations in old workbench CSS when that import is retired.
- [ ] Run `npm --prefix apps/desktop test -- src/themes/loader.test.ts src/settings/ThemeSection.test.tsx --maxWorkers=1`, then all repository tests and build. Expected: skin contracts pass; no runtime capability change.
- [ ] Log actual baseline/replacement screenshots, tests and limitations; commit `feat(P03.1): establish DSH presentation foundations` and push/verify remote.

## Task P03.2: shell and navigation

- [ ] Write component tests for collapse/open, right panel initially absent, explicit button toggles, project change does not cancel tasks, resize constraints and keyboard controls.
- [ ] Replace AppShell layout and project/sidebar navigation as a single reference sidebar, keep existing project ownership/rename commands. Native control wiring remains `onSelect={setProjectId}` and `onRename={(id,title)=>mutateCommand(uiCommands.renameConversation(projectId,id,title))}`.
- [ ] Mount right panel only on explicit open state and retain `SlotHost slot="rightPanel.tab"`; close only hides the panel. Existing terminal stays mounted once through composer.leading. Pass confirmed file events/current task state to right panel, not invented editor/Git data.
- [ ] Use upstream geometry constants SIDEBAR_DEFAULT=280, SIDEBAR_MIN=264, SIDEBAR_MAX=420, SIDEBAR_COLLAPSED=56, CENTER_MIN=400, RIGHTBAR_MIN=300 with responsive width solving; pointer-capture resize, keyboard reset and close.
- [ ] Run layout/App component tests and complete checks. GUI verify 1280×820, narrow window, sidebar collapse/restore, right panel open/close, project/chat switching. Commit and push `feat(P03.2): port DSH shell and on-demand right panel`.

## Task P03.3: transcript and composer

- [ ] Extend tests for user/assistant spacing, compact tool summaries, explicit tool expansion, saved final replies, real file summaries, errors and history boundaries. Existing tests in ConversationScroll, TurnTimeline, TaskTrajectory and App remain mandatory.
- [ ] Replace former Codex card appearance with upstream chat/user-text/trajectory appearance, retain actual content from `transcript(messages,tasks)` and bounded `taskTimeline`. No raw hidden reasoning, commands or model output invented.
- [ ] Replace input layout with reference editor/toolbar presentation using existing Sender and submit/cancel commands, real provider selection, PermissionMenu and ComposerStatus. Keep Enter/Shift+Enter and disabled/pending state.
- [ ] Remove obsolete codex-cards/workbench visual imports after their responsibilities are implemented; maintain markdown and scrollbar/accessibility rules.
- [ ] GUI verify empty/configured/running/completed/failed/cancelled, scrolling older pages and return latest, tools expand/collapse, files summary. Run full tests/build; commit and push `feat(P03.3): port DSH conversation and composer`.

## Task P03.4: settings and extensions

- [ ] Extend SettingsCenter/ExtensionsSection/Settings/Usage tests to keep all nine sections reachable, dialogs dismissible, local credential entry unmodified, usage real, plugin API unchanged.
- [ ] Port reference settings framing, left navigation, section title/form rows, control sizing and hover/selected styles. Use existing Settings model form and Usage data; do not expose DSH-only provider accounts or billing.
- [ ] Verify local UI slots/notifications and theme preview/apply/fallback, keep rightPanel.tab contribution only while panel is visible; no new privileges.
- [ ] GUI inspect nine sections, error/empty/long list and light/saved skin. Run full tests/build, commit and push `feat(P03.4): align DSH settings and plugin surfaces`.

## Task P03.5: comparative acceptance and installed delivery

- [ ] Capture upstream/reference and installed Moos screenshots with the same viewport for sidebar, empty chat, running tools, final result, menus, right panel and all settings. Store privately; check spacing/colors/geometry and list deliberate backend differences.
- [ ] Run `npm test`, `npm --prefix apps/desktop test -- --maxWorkers=1 --testTimeout=60000`, stable offline `npm run test:desktop-product`, `npm run test:docs`, `npm run build:desktop`, Tauri app build and `git diff --check`. Record failures honestly.
- [ ] Sign and verify, backup installed App, confirm no active tasks/PTY, normal quit, install with ditto, verify all regular file hashes and start path, icon and one hidden Node host. Measure full app and runtime size.
- [ ] Only mark applicable P03 items complete with test and real GUI evidence. Preserve P02 unfinished capability work. Commit evidence/log/plan and push with remote HEAD equality.

## Self-review

All design surfaces map to P03.1—P03.5. Right panel serves existing facts and slots, not undeveloped editor/Git. Task data, credentials, SDK host and terminal remain owned by current adapters. Each implementation task must be refined against the exact source files before editing, use a failing regression for behavior changes, and remain a runnable rollback checkpoint.
