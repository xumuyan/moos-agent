// Classify a navigation/window-open target for the MuMa workspace window.
// Chat links (including local dev servers like http://127.0.0.1:5173/) must
// open in the system browser, never navigate the app window itself.

/**
 * @param {string} target raw URL from setWindowOpenHandler / will-navigate
 * @param {string} appOrigin origin of the local DSH workspace server
 * @returns {{ type: 'allow' | 'open-external' | 'deny', href: string }}
 */
export function classifyNavigation(target, appOrigin) {
  let url;
  try {
    url = new URL(target);
  } catch {
    return { type: 'deny', href: String(target ?? '') };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    // file:, javascript:, about:, data:, custom schemes — never navigate, never open
    return { type: 'deny', href: url.href };
  }
  if (appOrigin && url.origin === appOrigin) {
    // same-origin in-window navigation (workspace SPA routing)
    return { type: 'allow', href: url.href };
  }
  // any other http/https host (example.com, localhost, 127.0.0.1, LAN IP)
  return { type: 'open-external', href: url.href };
}
