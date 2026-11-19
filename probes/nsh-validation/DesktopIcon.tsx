import { Canvas, Path2D, type Bounds } from 'nsh';
import { desktopIcons } from './desktop-icon-paths';

export type DesktopIconName = keyof typeof desktopIcons;
const paths = new Map<string, Path2D>();
function glyphPath(data: string) {
  let path = paths.get(data);
  if (!path) { path = new Path2D(data); paths.set(data, path); }
  return path;
}

// Fixed local geometry only. No font substitutions, SVG loader, or event data.
// The parent control owns the accessible label and the hit target.
export function DesktopIcon(props: { name: DesktopIconName; color: string; size?: number; mirror?: boolean;
  testID?: string; onLayout?: (event: { bounds: Bounds }) => void }) {
  const size = () => props.size ?? 16;
  return <Canvas testID={props.testID} onLayout={props.onLayout}
    style={{ width: size(), height: size(), flexShrink: 0, pointerEvents: 'none' }}
    draw={(ctx, bounds) => {
      const icon = desktopIcons[props.name];
      ctx.scale(bounds.width / icon.viewBox, bounds.height / icon.viewBox);
      if (props.mirror) { ctx.translate(icon.viewBox, 0); ctx.scale(-1, 1); }
      ctx.fillStyle = ctx.strokeStyle = props.color;
      ctx.lineWidth = 'stroke' in icon ? icon.stroke : 1;
      ctx.lineCap = 'cap' in icon ? icon.cap : 'butt';
      for (const shape of icon.shapes) {
        const filled = !('stroke' in icon) || ('fill' in shape && shape.fill);
        if ('path' in shape) {
          const path = glyphPath(shape.path);
          if (filled) ctx.fill(path); else ctx.stroke(path);
        } else {
          ctx.beginPath();
          if ('circle' in shape) {
            const [x, y, r] = shape.circle;
            ctx.arc(x, y, r, 0, 2 * Math.PI);
          } else {
            const [x, y, w, h, r] = shape.rect;
            ctx.moveTo(x + r, y);
            ctx.arcTo(x + w, y, x + w, y + h, r);
            ctx.arcTo(x + w, y + h, x, y + h, r);
            ctx.arcTo(x, y + h, x, y, r);
            ctx.arcTo(x, y, x + w, y, r);
            ctx.closePath();
          }
          if (filled) ctx.fill(); else ctx.stroke();
        }
      }
    }} />;
}
