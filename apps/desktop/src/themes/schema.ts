import { isMoosCompatible } from '../plugins/manifest';
import { normalizeWallpaperOptions, type WallpaperOptions } from './wallpaper';

export const THEME_TOKENS = ['accent', 'accentSoft', 'border', 'panel', 'sidebar', 'muted', 'radius', 'rightPanelWidth'] as const;
export type ThemeToken = typeof THEME_TOKENS[number];
export const THEME_REGIONS = ['sidebar', 'conversation', 'composer', 'rightPanel'] as const;
export type ThemeRegion = typeof THEME_REGIONS[number];
export interface ThemeStyle { backgroundColor?: string; color?: string; borderColor?: string; backgroundAsset?: string }
export interface ThemeBackground extends WallpaperOptions { type: 'image'; src: string }
export interface ThemeDefinition { id: string; name: string; version: string; moosVersion: string; tokens: Partial<Record<ThemeToken, string>>; styles: Partial<Record<ThemeRegion, ThemeStyle>>; assets: Record<string, string>; backgroundMedia?: ThemeBackground }
const color = (value: string) => /^(#[0-9a-fA-F]{3,8}|rgba?\([\d\s.,%]+\))$/.test(value);
const dimension = (value: string) => /^(?:[0-9]|[1-9][0-9]|1[0-9]{2}|2[0-9]{2})px$/.test(value);
const asset = (value: string) => (/^\/assets\/themes\/[a-zA-Z0-9/_-]+\.(png|jpe?g|webp)$/.test(value) || /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(value)) && value.length <= 131072;
export function validateTheme(input: unknown): ThemeDefinition {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid theme');
  const value = input as Record<string, unknown>;
  if (typeof value.id !== 'string' || !/^[a-z][a-z0-9.-]{0,127}$/.test(value.id) || typeof value.name !== 'string' || !value.name.trim()) throw new Error('Invalid theme identity');
  if (typeof value.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(value.version)) throw new Error('Invalid theme version');
  if (typeof value.moosVersion !== 'string' || !isMoosCompatible(value.moosVersion)) throw new Error('Theme is not compatible with this Moos version');
  if (!value.tokens || typeof value.tokens !== 'object' || Array.isArray(value.tokens)) throw new Error('Invalid theme token map');
  const tokens = value.tokens as Record<string, unknown>;
  for (const [key, raw] of Object.entries(tokens)) {
    if (!THEME_TOKENS.includes(key as ThemeToken)) throw new Error('Unknown theme token');
    if (typeof raw !== 'string' || (['radius', 'rightPanelWidth'].includes(key) ? !dimension(raw) : !color(raw))) throw new Error('Invalid theme token value');
  }
  const assets = (value.assets ?? {}) as Record<string, unknown>;
  if (!assets || typeof assets !== 'object' || Array.isArray(assets)) throw new Error('Invalid theme asset map');
  for (const [key, raw] of Object.entries(assets)) if (!/^[a-z][a-z0-9-]{0,40}$/.test(key) || typeof raw !== 'string' || !asset(raw)) throw new Error('Invalid theme asset');
  const styles = (value.styles ?? {}) as Record<string, unknown>;
  if (!styles || typeof styles !== 'object' || Array.isArray(styles)) throw new Error('Invalid theme region styles');
  for (const [region, raw] of Object.entries(styles)) {
    if (!THEME_REGIONS.includes(region as ThemeRegion)) throw new Error('Unknown theme region');
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid theme style');
    for (const [property, styleValue] of Object.entries(raw as Record<string, unknown>)) {
      if (!['backgroundColor', 'color', 'borderColor', 'backgroundAsset'].includes(property) || typeof styleValue !== 'string') throw new Error('Invalid theme style');
      if (property === 'backgroundAsset' ? !Object.hasOwn(assets, styleValue) : !color(styleValue)) throw new Error('Invalid theme style value');
    }
  }
  const theme: ThemeDefinition = { id: value.id, name: value.name.trim(), version: value.version, moosVersion: value.moosVersion,
    tokens: { ...tokens } as ThemeDefinition['tokens'], styles: structuredClone(styles) as ThemeDefinition['styles'], assets: { ...assets } as Record<string, string> };
  if (value.backgroundMedia !== undefined) {
    const media = value.backgroundMedia as Partial<ThemeBackground> | null;
    if (!media || media.type !== 'image' || typeof media.src !== 'string' || media.src.length > 1_400_000
      || !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(media.src)
      || Object.keys(media).some(key => !['type', 'src', 'maskOpacity', 'surfaceOpacity', 'blur'].includes(key))) {
      throw new Error('Invalid theme background');
    }
    theme.backgroundMedia = { type: 'image', src: media.src, ...normalizeWallpaperOptions(media) };
  }
  return theme;
}
