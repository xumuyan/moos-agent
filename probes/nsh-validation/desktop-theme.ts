// N01-D3: maid-atelier 0.3.2 source facts, not the old Tauri/E139 palette.
// Sources: skin-source.json / SKIN-SOURCE.md. Art remains local and excluded from Git.
export const desktopTheme = {
  canvas: '#dce6f5', sidebar: '#0a173b', glass: '#f8faffad', paper: '#f8fafff0',
  ink: '#172347', muted: '#2d3a55', line: '#c5a4686b', selected: '#c5a4683d',
  accent: '#536eae', gold: '#c5a468', goldSoft: '#e2cfaa', brand: '#f3e3c0',
  sidebarInk: '#f8f3e8', sidebarMuted: '#d7def0', danger: '#ab3248',
  font: 14, lineHeight: 22,
  // Translate the web stack to Mac system families; no bundled or downloaded fonts.
  fontFamily: 'system-ui, "PingFang SC", "Hiragino Sans GB", sans-serif',
  ornamentFont: 'Georgia, "Times New Roman", "Songti SC", serif',
  monoFont: 'Menlo, "PingFang SC", monospace',
  sidebarWidth: 280, headerHeight: 75, rightWidth: 260,
  sidebarGradient: 'radial-gradient(circle at 50% 14%, #5b77bc3b, #0000 31%), linear-gradient(#102456f7, #050e2bf5), repeating-linear-gradient(135deg, #ffffff07 0 1px, #0000 1px 7px)',
  sidebarShadow: '8px 0 34px #08113038, inset -1px 0 #fff5d7d1, inset -3px 0 #e2cfa6b8',
  composerGradient: 'linear-gradient(#1b2c54f0, #0a173ae6)',
  composerBase: '#0d193bb8', composerInk: '#eef3fc', caret: '#bcd2ff', placeholder: '#b6c2e0',
  darkComposerGradient: 'linear-gradient(#192a53eb, #0c193ce6)',
  sendGradient: 'linear-gradient(145deg, #6680bd, #304a91)',
  composerShadow: '0 18px 52px #1d305e2e, inset 0 1px #ffffff14',
  assistantShadow: '0 4px 14px #13265714', userShadow: '0 6px 20px #1326571a',
  scrim: 'linear-gradient(rgba(248,250,255,.12) 0%, rgba(235,240,250,.18) 55%, rgba(220,230,245,.25) 100%)',
  darkScrim: 'linear-gradient(rgba(9,19,51,.15) 0%, rgba(16,32,77,.25) 60%, rgba(8,15,39,.35) 100%)',
  dark: { canvas: '#080f27', ink: '#e5eaf6', glass: '#0d193bbd', assistant: '#121f43f0', user: '#1e2f5af7', details: '#0b1737e6' },
} as const;
export const clamp = (min: number, value: number, max: number) => Math.min(max, Math.max(min, value));
export function desktopLayout(width: number, requestedRight: boolean) {
  // Narrow mode is a deliberate navigation adaptation; it is not a claimed DSH geometry.
  return { compact: width < 760, sidebar: width < 760 ? 184 : desktopTheme.sidebarWidth,
    right: requestedRight && width >= 1100, inset: width >= 1200 && !(requestedRight && width >= 1100) ? 120 : 20 };
}
export function characterLayout(width: number, height: number, sidebar: number, active: boolean, details: boolean) {
  const leftH = active ? (width <= 700 ? clamp(300, height * .46, 410) : clamp(420, height * .64, 760)) : clamp(560, height * .96, 1180);
  const rightH = details && active ? clamp(360, height * .56, 680) : active ? (width <= 700 ? clamp(300, height * .44, 390) : clamp(420, height * .62, 730)) : clamp(540, height * .92, 1120);
  return { left: sidebar + ((!active && width <= 1080) || (active && width <= 700) ? 0 : clamp(8, width * .013, 24)), leftH,
    leftW: leftH * 1122 / 2019, rightH, rightW: rightH * 1394 / 2649,
    bottomLeft: active ? clamp(-24, -height * .015, -8) : clamp(-34, -height * .024, -12),
    bottomRight: active ? clamp(-24, -height * .015, -8) : clamp(-26, -height * .018, -8),
    right: details ? -clamp(-460, -width * .24, -320) : ((!active && width <= 1080) || (active && width <= 700) ? 0 : -clamp(-8, -width * (active ? .005 : .002), 0)),
    opacity: active ? .9 : width <= 1080 ? .74 : 1, rightVisible: !(details && width <= 700),
  };
}

// CSS border-image proportionally reduces opposing edges in a tiny box.
export function sliceAxis(length: number, first: number, last: number) {
  const size = Math.max(0, length);
  const scale = first + last > size ? size / (first + last) : 1;
  return [0, first * scale, size - last * scale, size];
}

// Native content safe areas, NOT extra Web titlebar offsets or source CSS tokens.
// The original artwork stays at the source dimensions; layout reserves its envelope.
export function styleLayout(active: boolean, artwork: boolean, titleBarHeight = 0) {
  const trim = artwork ? (active ? 76 : 48) : 0;
  return { trim, headerTop: Math.max(trim, titleBarHeight) + (artwork || titleBarHeight > 0 ? 8 : 0), headerBody: 64,
    composerTop: 24, composerBottom: 24, frameTop: 20, frameBottom: 18,
    previewHeight: 36, bottom: artwork && !active ? 60 : 8,
    composerHeight: artwork ? (active ? 170 : 188) : (active ? 108 : 124),
    composerPaddingX: artwork ? 44 : 16, composerPaddingTop: artwork ? 56 : 14,
    composerPaddingBottom: artwork ? 34 : 16, composerActionHeight: active ? 38 : 44 };
}
// Keep the bow at the same scale on both axes. Only the lace/ribbon on
// either side stretches; do not crop or double-paint the original bow.
export function frameTopSegments(from: number, to: number, left: number, right: number, scale: number, centerSource: number) {
  const sourceMid = (from + to) / 2, destMid = (left + right) / 2;
  const s = centerSource / 2;
  const d = Math.min((right - left) / 2, s * scale);
  const source = [from, sourceMid - s, sourceMid + s, to];
  const dest = [left, destMid - d, destMid + d, right];
  return Array.from({ length: 3 }, (_, i) => [source[i], source[i + 1], dest[i], dest[i + 1]] as const);
}
export const sidebarCorners = [
  { name: 'top-left', top: 1, left: 1, scaleX: -1, scaleY: 1 },
  { name: 'top-right', top: 1, right: 1, scaleX: 1, scaleY: 1 },
  { name: 'bottom-right', bottom: 1, right: 1, scaleX: 1, scaleY: -1 },
  { name: 'bottom-left', bottom: 1, left: 1, scaleX: -1, scaleY: -1 },
] as const;

// Presentation of the controller's public tool projection. Only exact tool rows
// are recognized; lookalike text in a user/assistant message stays Markdown.
const toolLabels = { read: '读取', write: '写入', edit: '编辑', bash: '命令', grep: '搜索', find: '查找', ls: '列出目录', other: '其他工具' } as const;
const toolPattern = /^(?:(tool_start)|(tool_end)) · (read|write|edit|bash|grep|find|ls|other)( · 错误)?$/u;
export function toolCard(role: string, body: string, dark: boolean) {
  const event = role === '工具' ? toolPattern.exec(body) : null;
  if (!event || event[0] !== body || (event[1] && event[4])) return null;
  const phase = event[1] ? 'start' : event[4] ? 'error' : 'end';
  const name = event[3] as keyof typeof toolLabels;
  const status = phase === 'start' ? '开始' : phase === 'error' ? '失败' : '完成';
  return { phase, name, label: `${toolLabels[name]} · ${status}`,
    color: dark ? { start: '#d3ddf2', end: '#b7ddca', error: '#ffc1cb' }[phase] : { start: '#2d3a55', end: '#215440', error: '#862a3d' }[phase],
    // Source disclosure gradient; a uniform floor preserves legibility over art.
    // No per-row backdrop sampling or motion in virtualized chat history.
    gradient: dark ? 'linear-gradient(90deg, #0a143094, #0d193b66 72%, #0d193b29)' : 'linear-gradient(90deg, #f8faff52, #f8faff33 72%, #f8faff14)',
    surface: dark ? '#0a1430d4' : '#edf2faf0',
    edge: phase === 'error' ? (dark ? '#f1a5b56e' : '#a6334959') : (dark ? '#97a9d82e' : '#c5a46856'),
  };
}

// Stable immutable presentation snapshots. The controller may mutate its streaming
// row in place; status-only polling must not discard native height measurements.
export function createMessageRows() {
  type Row = { role: string; body: string };
  let scope = '', cached: Row[] = [];
  return (nextScope: string, rows: readonly Row[]): Row[] => {
    if (scope !== nextScope) { scope = nextScope; cached = []; }
    if (rows.length !== cached.length || rows.some((r, i) => r.role !== cached[i]?.role || r.body !== cached[i]?.body))
      cached = rows.map((r, i) => r.role === cached[i]?.role && r.body === cached[i]?.body ? cached[i] : { ...r });
    return cached;
  };
}
