import { Image, View, colorScheme, signal, windowSize, type Bounds, type ImageStyle, type ViewStyle } from 'nsh';
import { art, artAvailable } from './desktop-theme-art';
import { characterLayout, frameTopSegments, sliceAxis, sidebarCorners, desktopTheme as t } from './desktop-theme';
const absolute: ViewStyle = { position: 'absolute', pointerEvents: 'none' };
export function Art(props: { name: string; style?: ImageStyle; testID?: string }) {
  return art[props.name] ? <Image testID={props.testID} src={art[props.name]} fadeDuration={0} style={{ ...props.style, ...absolute }} /> : null;
}
// CSS border-image translated to nine clipped native Images, not a stretched
// whole-frame bitmap. Source and destination cuts follow patches.css:1634.
export function NineSlice(props: { name: string; source: [number, number]; cuts: [number, number, number, number]; edges: [number, number, number, number]; style?: ViewStyle; testID?: string; fill?: boolean; topCenter?: number; onLayout?: (e: { bounds: Bounds }) => void; onCenterLayout?: (e: { bounds: Bounds }) => void }) {
  const size = signal({ width: 0, height: 0 });
  const sourceX = sliceAxis(props.source[0], props.cuts[3], props.cuts[1]);
  const sourceY = sliceAxis(props.source[1], props.cuts[0], props.cuts[2]);
  const destX = () => sliceAxis(size().width, props.edges[3], props.edges[1]);
  const destY = () => sliceAxis(size().height, props.edges[0], props.edges[2]);
  const top = () => frameTopSegments(sourceX[1], sourceX[2], destX()[1], destX()[2], destY()[1] / sourceY[1], props.topCenter!);
  return <View testID={props.testID} onLayout={e => { size.set(e.bounds.size); props.onLayout?.(e); }} style={{ ...props.style, ...absolute }}>
    {Array.from({ length: 9 }, (_, i) => {
      if (i === 1 && props.topCenter) return [0, 1, 2].map(j => {
        const segment = () => top()[j];
        const sx = () => (segment()[3] - segment()[2]) / (segment()[1] - segment()[0]);
        const sy = () => destY()[1] / sourceY[1];
        return <View testID={j === 1 ? 'composer-bow' : undefined} onLayout={j === 1 ? props.onCenterLayout : undefined}
          style={{ ...absolute, overflow: 'hidden', left: segment()[2], top: 0, width: segment()[3] - segment()[2], height: destY()[1] }}>
          <Art name={props.name} style={{ left: -segment()[0] * sx(), top: 0, width: props.source[0] * sx(), height: props.source[1] * sy(), objectFit: 'fill' }} />
        </View>;
      });
      const x = i % 3, y = Math.floor(i / 3);
      const w = () => Math.max(0, destX()[x + 1] - destX()[x]);
      const h = () => Math.max(0, destY()[y + 1] - destY()[y]);
      return (i !== 4 || props.fill) && sourceX[x + 1] > sourceX[x] && sourceY[y + 1] > sourceY[y] && <View style={{ ...absolute, overflow: 'hidden', left: destX()[x], top: destY()[y], width: w(), height: h() }}>
        <Art name={props.name} style={{ left: -sourceX[x] * w() / (sourceX[x + 1] - sourceX[x]), top: -sourceY[y] * h() / (sourceY[y + 1] - sourceY[y]), width: props.source[0] * w() / (sourceX[x + 1] - sourceX[x]), height: props.source[1] * h() / (sourceY[y + 1] - sourceY[y]), objectFit: 'fill' }} />
      </View>;
    })}
  </View>;
}
export function Wallpaper(props: { sidebar: number; active: boolean; details: boolean; characters: boolean }) {
  const dark = () => colorScheme() === 'dark';
  const filter = () => dark() ? 'brightness(.84) saturate(.92) drop-shadow(0 22px 28px #0000004d)' : 'drop-shadow(0 20px 24px #1b2c5b24)';
  const w = () => windowSize().width, h = () => windowSize().height;
  const chars = () => characterLayout(w(), h(), props.sidebar, props.active, props.details);
  return <View testID="skin-layers" style={{ ...absolute, top: 0, left: 0, right: 0, bottom: 0, overflow: 'hidden' }}>
    <Art testID="palace-background" name={dark() ? 'palace-night' : 'palace-day'} style={{ top: 0, left: 0, right: 0, bottom: 0, width: '100%', height: '100%', objectFit: 'cover', objectPosition: '50% 50%' }} />
    <View testID="wallpaper-scrim" style={{ ...absolute, top: 0, left: 0, right: 0, bottom: 0, backgroundImage: dark() ? t.darkScrim : t.scrim }} />
    {props.characters && <Art testID="character-left" name="maid-left" style={{ left: chars().left, bottom: chars().bottomLeft, width: chars().leftW, height: chars().leftH, opacity: chars().opacity, objectFit: 'contain', objectPosition: 'center bottom', filter: filter() }} />}
    {props.characters && chars().rightVisible && <Art testID="character-right" name="maid-right" style={{ right: chars().right, bottom: chars().bottomRight, width: chars().rightW, height: chars().rightH, opacity: props.details && props.active ? .86 : chars().opacity, objectFit: 'contain', objectPosition: 'center bottom', filter: filter() }} />}
  </View>;
}
// Artwork starts at the content origin, even when the content extends into the
// hidden macOS titlebar. Interactive content reserves the reported native inset.
export function TopTrim(props: { active: boolean }) {
  const tileHeight = () => props.active ? 149 : 51;
  const tileWidth = () => 386 * tileHeight() / 321;
  return <View testID="top-trim" style={{ ...absolute, left: 0, right: 0, top: 0, height: props.active ? 76 : 48, overflow: 'hidden', zIndex: 1 }}>
    {Array.from({ length: Math.ceil(windowSize().width / tileWidth()) }, (_, i) => <Art name="top-trim" style={{ left: i * tileWidth(), top: props.active ? -4 : -2, width: tileWidth(), height: tileHeight(), objectFit: 'fill' }} />)}
    {!props.active && <Art name="bow" style={{ left: '50%', transform: 'translateX(-50%)', top: -1, width: 80, height: 42, objectFit: 'contain' }} />}
  </View>;
}
export function BottomTrim(props: { width: number; onLayout?: (e: { bounds: Bounds }) => void }) {
  return <View testID="bottom-trim" onLayout={props.onLayout} style={{ ...absolute, bottom: 0, left: 0, right: 0, height: 60, overflow: 'hidden' }}>
    {Array.from({ length: Math.ceil(props.width / 386) }, (_, i) => <Art name="bottom-trim" style={{ left: i * 386, bottom: 0, width: 386, height: 30 }} />)}
    <Art testID="bottom-crest" name="bottom-crest" style={{ width: 94, height: 54, bottom: 0, left: '50%', transform: 'translateX(-50%)', objectFit: 'contain', filter: 'drop-shadow(0 3px 6px #040b2357)' }} />
  </View>;
}
// patches.css:411–451: crop the TOP RIGHT 62px of a 130px image, then mirror
// the clipped container about its centre. Scaling the full image to 62 is wrong.
export function SidebarCorners() {
  if (!artAvailable) return null;
  const line = 'linear-gradient(90deg, #eed299f0, #be914bf5, #eed299f0)';
  return <View testID="sidebar-corners" style={{ ...absolute, top: 0, left: 0, right: 0, bottom: 0, zIndex: 4 }}>
    <View style={{ ...absolute, left: 62, right: 62, top: 8.875, height: 1.25, backgroundImage: line }} />
    <View style={{ ...absolute, left: 62, right: 62, bottom: 8.875, height: 1.25, backgroundImage: line }} />
    <View style={{ ...absolute, top: 62, bottom: 62, left: 8.05, width: 1.35, backgroundImage: line.replace('90deg', '180deg') }} />
    <View style={{ ...absolute, top: 62, bottom: 62, right: 8.05, width: 1.35, backgroundImage: line.replace('90deg', '180deg') }} />
    {sidebarCorners.map(c => <View testID={`corner-${c.name}`} style={{ ...absolute, top: 'top' in c ? c.top : undefined, left: 'left' in c ? c.left : undefined, right: 'right' in c ? c.right : undefined, bottom: 'bottom' in c ? c.bottom : undefined, width: 62, height: 62, overflow: 'hidden', transform: [{ scaleX: c.scaleX }, { scaleY: c.scaleY }] }}>
      <Art name="sidebar-corner" style={{ top: 0, right: 0, width: 130, height: 130, objectFit: 'fill', filter: 'drop-shadow(0 1px 1px #0207186b)' }} />
    </View>)}
  </View>;
}
export { artAvailable };
