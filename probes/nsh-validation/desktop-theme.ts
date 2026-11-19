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
  composerBase: '#0d193bb8', composerInk: '#e7ecf7', caret: '#bcd2ff', placeholder: '#b6c2e0',
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
    composerHeight: 158, composerPaddingX: 32, composerPaddingBottom: 28 };
}
export const sidebarCorners = [
  { name: 'top-left', top: 1, left: 1, scaleX: -1, scaleY: 1 },
  { name: 'top-right', top: 1, right: 1, scaleX: 1, scaleY: 1 },
  { name: 'bottom-right', bottom: 1, right: 1, scaleX: 1, scaleY: -1 },
  { name: 'bottom-left', bottom: 1, left: 1, scaleX: -1, scaleY: -1 },
] as const;

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
