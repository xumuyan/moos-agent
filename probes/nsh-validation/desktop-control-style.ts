// The shared navy surface for controls on the sidebar and the composer.
// Use paint-only state changes so hover never moves the control or its hit area.
export const controlSurface = { borderRadius: 10, backgroundColor: '#688bd012' } as const;
export const controlHover = { backgroundColor: '#688bd02e' } as const;
export const controlPressed = { backgroundColor: '#688bd043' } as const;
export const controlFocus = { ...controlHover, boxShadow: 'inset 0 0 0 1px #d9c08c' } as const;
