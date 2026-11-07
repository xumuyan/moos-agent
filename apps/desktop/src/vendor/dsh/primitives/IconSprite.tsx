/** DSH icon-sprite.ts default-artwork installation, MIT Copyright (c) 2026 DeepSeek.
 * Moos adaptation removes the Cordis lifecycle/theme-icon subscription: only
 * audited bundled artwork is accepted. A skin does not gain SVG execution. */
import { useEffect } from 'react';
import { ICON_SYMBOLS } from './icons/artwork';
const SVG_NS = 'http://www.w3.org/2000/svg';
const DROPPED_ATTRIBUTES = new Set(['width', 'height', 'xmlns', 'class', 'aria-hidden']);
export default function IconSprite() {
  useEffect(() => {
    const sprite = document.createElementNS(SVG_NS, 'svg');
    sprite.setAttribute('aria-hidden','true'); sprite.setAttribute('data-dsh-icon-sprite','');
    sprite.style.cssText='position:absolute;width:0;height:0;overflow:hidden';
    for (const [id, markup] of Object.entries(ICON_SYMBOLS)) {
      const root = new DOMParser().parseFromString(markup,'image/svg+xml').documentElement;
      const symbol = document.createElementNS(SVG_NS,'symbol');
      for (const {name,value} of root.attributes) if (!DROPPED_ATTRIBUTES.has(name)) symbol.setAttribute(name,value);
      symbol.id=id; symbol.append(...[...root.childNodes].map(node=>document.importNode(node,true))); sprite.append(symbol);
    }
    document.body.prepend(sprite);
    return () => sprite.remove();
  },[]);
  return null;
}
