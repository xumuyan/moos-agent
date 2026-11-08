const colors = {
  surface: '--dsw-alias-bg-overlay',
  field: '--dsw-alias-button-elevated-fill',
  text: '--dsw-alias-label-primary',
  muted: '--dsw-alias-label-secondary',
  border: '--dsw-alias-border-l2',
  accent: '--dsw-alias-state-business-primary',
};

function sampleTheme(colors) {
  const probe = document.createElement('span');
  probe.style.cssText = 'position:fixed;visibility:hidden;pointer-events:none';
  document.body.append(probe);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return null;
    function sample(color) {
      probe.style.color = color;
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = getComputedStyle(probe).color;
      context.fillRect(0, 0, 1, 1);
      return context.getImageData(0, 0, 1, 1).data;
    }
    const theme = { scheme: sample('CanvasText')[0] > 127 ? 'dark' : 'light' };
    for (const [name, token] of Object.entries(colors)) {
      const rgba = sample(`var(${token}, transparent)`);
      if (rgba[3]) theme[name] = '#' + Array.from(rgba, n => n.toString(16).padStart(2, '0')).join('');
    }
    return theme;
  } finally { probe.remove(); }
}

export const readWorkbenchTheme = `(${sampleTheme})(${JSON.stringify(colors)})`;

export function modelSettingsThemeCss(theme) {
  // The workbench hosts plugins. Accept only fixed color names and hex values.
  const declarations = [];
  if (theme?.scheme === 'light' || theme?.scheme === 'dark') declarations.push(`color-scheme:${theme.scheme}`);
  for (const name of Object.keys(colors)) {
    const color = theme?.[name];
    if (typeof color === 'string' && color.length === 9 && /^#[a-f\d]{8}$/i.test(color)) {
      declarations.push(`--model-${name}:${color}`);
    }
  }
  return `html:root{${declarations.join(';')}}`;
}
