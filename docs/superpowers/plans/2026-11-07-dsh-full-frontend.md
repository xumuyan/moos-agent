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

- [x] Record upstream CSS/TS paths and adopted constants before code transfer. Preserve MIT copyright and map source naming to Moos.
- [x] Add tests asserting theme selection/fallback remains stable and new shell can use explicit presentation tokens without touching credentials.
- [x] Introduce `apps/desktop/src/theme/dsh/tokens.css` with default neutral page/sidebar/border/text/control values, mapping skin inputs through existing --moos-* variables. Remove default declarations in old workbench CSS when that import is retired.
- [x] Run `npm --prefix apps/desktop test -- src/themes/loader.test.ts src/settings/ThemeSection.test.tsx --maxWorkers=1`, then all repository tests and build. Expected: skin contracts pass; no runtime capability change.
- [x] Log actual baseline/replacement screenshots, tests and limitations; include in the integrated `feat(P03): port DSH frontend presentation to Moos` checkpoint and push/verify remote.

## Task P03.2: shell and navigation

- [x] Write component tests for collapse/open, right panel initially absent, explicit button toggles, project change does not cancel tasks, resize constraints and keyboard controls.
- [x] Replace AppShell layout and project/sidebar navigation as a single reference sidebar, keep existing project ownership/rename commands. Native control wiring remains `onSelect={setProjectId}` and `onRename={(id,title)=>mutateCommand(uiCommands.renameConversation(projectId,id,title))}`.
- [x] Mount right panel only on explicit open state and retain `SlotHost slot="rightPanel.tab"`; close only hides the panel. Existing terminal stays mounted once through composer.leading. Pass confirmed file events/current task state to right panel, not invented editor/Git data.
- [x] Use upstream geometry constants SIDEBAR_DEFAULT=280, SIDEBAR_MIN=264, SIDEBAR_MAX=420, SIDEBAR_COLLAPSED=56, CENTER_MIN=400, RIGHTBAR_MIN=300 with responsive width solving; pointer-capture resize, keyboard reset and close.
- [x] Run layout/App component tests and complete checks. GUI verify 1280×820, narrow window, sidebar collapse/restore, right panel open/close, project/chat switching. Include in the integrated P03 checkpoint and push/verify remote.

## Task P03.3: transcript and composer

- [x] Extend tests for user/assistant spacing, compact tool summaries, explicit tool expansion, saved final replies, real file summaries, errors and history boundaries. Existing tests in ConversationScroll, TurnTimeline, TaskTrajectory and App remain mandatory.
- [x] Replace former Codex card appearance with upstream chat/user-text/trajectory appearance, retain actual content from `transcript(messages,tasks)` and bounded `taskTimeline`. No raw hidden reasoning, commands or model output invented.
- [x] Replace input layout with reference editor/toolbar presentation using existing Sender and submit/cancel commands, real provider selection, PermissionMenu and ComposerStatus. Keep Enter/Shift+Enter and disabled/pending state.
- [x] Remove obsolete codex-cards/workbench visual imports after their responsibilities are implemented; maintain markdown and scrollbar/accessibility rules.
- [x] GUI verify empty/configured/running/completed/failed/cancelled, scrolling older pages and return latest, tools expand/collapse, files summary. Run full tests/build; include in the integrated P03 checkpoint and push/verify remote.

## Task P03.4: settings and extensions

- [x] Extend SettingsCenter/ExtensionsSection/Settings/Usage tests to keep all nine sections reachable, dialogs dismissible, local credential entry unmodified, usage real, plugin API unchanged.
- [x] Port reference settings framing, left navigation, section title/form rows, control sizing and hover/selected styles. Use existing Settings model form and Usage data; do not expose DSH-only provider accounts or billing.
- [x] Verify local UI slots/notifications and theme preview/apply/fallback, keep rightPanel.tab contribution only while panel is visible; no new privileges.
- [x] GUI inspect nine sections, error/empty/long list and light/saved skin. Run full tests/build, include in the integrated P03 checkpoint and push/verify remote.

## Task P03.5: comparative acceptance and installed delivery

- [x] Capture upstream/reference and installed Moos screenshots with the same viewport for sidebar, empty chat, running tools, final result, menus, right panel and all settings. Store privately; check spacing/colors/geometry and list deliberate backend differences.
- [x] Run `npm test`, `npm --prefix apps/desktop test -- --maxWorkers=1 --testTimeout=60000`, stable offline `npm run test:desktop-product`, `npm run test:docs`, `npm run build:desktop`, Tauri app build and `git diff --check`. Record failures honestly.
- [x] Sign and verify, backup installed App, confirm no active tasks/PTY, normal quit, install with ditto, verify all regular file hashes and start path, icon and one hidden Node host. Measure full app and runtime size.
- [x] Only mark applicable P03 items complete with test and real GUI evidence. Preserve P02 unfinished capability work. Commit evidence/log/plan and push with remote HEAD equality.

## Self-review

All design surfaces map to P03.1—P03.5. Right panel serves existing facts and slots, not undeveloped editor/Git. Task data, credentials, SDK host and terminal remain owned by current adapters. Each implementation task must be refined against the exact source files before editing, use a failing regression for behavior changes, and remain a runnable rollback checkpoint.

## 执行结果与证据边界

2026-11-07实施及本机子集验收完成，证据为PLAN E30。以上五任务在一个整套展示层集成提交中交付，实际提交说明`feat(P03): port DSH frontend presentation to Moos`，设计基线已独立提交8212032。实现、规格审查、质量审查分别完成，发现的窄屏右栏隐藏、皮肤宽度/圆角、设置旧margin/max-height、折叠列表滚动、右栏键盘问题均已修正并回归。

原版截图基准仅空态与设置框架；其余状态通过固定原版源码的结构/样式与Moos实际运行核对，并保存Moos九设置及状态截图。未完成全原版状态的逐像素自动diff或原生vibrancy精确复现。手机、Windows、原版完整后端、Git编辑和P02.9非本轮完成项。
