import { useEffect, useId, useRef, useState, useSyncExternalStore, type ChangeEvent } from 'react';
import {
  clearWallpaper, DEFAULT_WALLPAPER_OPTIONS, getWallpaper, getWallpaperLoadError,
  getWallpaperLoading, getWallpaperPreview, saveWallpaper, subscribeWallpaper, updateWallpaperOptions, validateWallpaper, WALLPAPER_LIMITS,
  type WallpaperOptions,
} from '../themes/wallpaper';
import fields from '../vendor/dsh/settings/fields.module.css';
import form from '../vendor/dsh/settings/SettingsForm.module.css';
import css from './WallpaperSection.module.css';

function readPreview(file: File, mime: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Image preview unavailable'));
    reader.onerror = reader.onabort = () => reject(new Error('Image preview unavailable'));
    reader.readAsDataURL(file.slice(0, file.size, mime));
  });
}

export default function WallpaperSection() {
  const current = useSyncExternalStore(subscribeWallpaper, getWallpaper);
  const currentPreview = useSyncExternalStore(subscribeWallpaper, getWallpaperPreview);
  const loading = useSyncExternalStore(subscribeWallpaper, getWallpaperLoading);
  const loadError = useSyncExternalStore(subscribeWallpaper, getWallpaperLoadError);
  const [selected, setSelected] = useState<{ file: File; preview: string } | null>(null);
  const [options, setOptions] = useState(current?.options ?? DEFAULT_WALLPAPER_OPTIONS);
  const [pending, setPending] = useState<'choose' | 'apply' | 'remove' | null>(null);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const id = useId();
  const preview = selected?.preview ?? currentPreview;
  const persisted = current?.options;
  const changed = !!persisted && (persisted.maskOpacity !== options.maskOpacity
    || persisted.surfaceOpacity !== options.surfaceOpacity || persisted.blur !== options.blur);
  useEffect(() => { setOptions(current?.options ?? DEFAULT_WALLPAPER_OPTIONS); }, [current]);

  const choose = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file || pending || loading) return;
    setError('');
    setStatus('');
    setPending('choose');
    try {
      const image = await validateWallpaper(file);
      setSelected({ file, preview: await readPreview(file, image.mime) });
    } catch {
      setError('无法预览此图片。请选择符合大小和尺寸要求的 PNG、JPEG 或 WebP 文件。');
    } finally {
      setPending(null);
    }
  };

  const apply = async () => {
    if (pending || loading || (!selected && !changed)) return;
    setPending('apply');
    setError('');
    setStatus('');
    try {
      if (selected) await saveWallpaper(selected.file, options);
      else await updateWallpaperOptions(options);
      setSelected(null);
      setStatus('背景已保存并应用。');
    } catch {
      setError('未能保存背景，可以重试。之前应用的设置已保留。');
    } finally {
      setPending(null);
    }
  };

  const remove = async () => {
    if (pending || loading || !current) return;
    setPending('remove');
    setError('');
    setStatus('');
    try {
      await clearWallpaper();
      setSelected(null);
      setStatus('已移除背景。需要时可以重新选择原图。');
    } catch {
      setError('未能移除背景，请重试。');
    } finally {
      setPending(null);
    }
  };

  const busy = !!pending || loading;
  const editingDisabled = busy || (!current && !selected);
  const transparencyPercent = Math.round((1 - options.surfaceOpacity) * 100);
  const maskPercent = Math.round(options.maskOpacity * 100);
  const changeOption = (name: keyof WallpaperOptions, value: number) => {
    setOptions(previous => ({ ...previous, [name]: value }));
    setStatus('');
  };
  return <section className={css.section} aria-labelledby={`${id}-wallpaper`}>
    <h4 id={`${id}-wallpaper`}>背景图片</h4>
    <p>支持 PNG、JPEG 和 WebP。图片与效果参数仅保存在本机。选图和调整效果会先显示预览，点击应用或保存后生效。</p>
    <input ref={fileInput} type="file" hidden aria-label="选择本地背景图片" accept="image/png,image/jpeg,image/webp" onChange={choose} />
    <button type="button" className={css.secondary} disabled={busy} onClick={() => fileInput.current?.click()}>选择本地图片</button>
    {preview && <figure className={css.preview}>
      <div className={css.thumbnail}>
        <img src={preview} alt={selected ? '待应用背景图' : '当前背景图'} />
        <div className={css.mask} style={{ opacity: options.maskOpacity }} />
        <div className={css.sample} aria-hidden="true" style={{ background: `rgb(246 248 252 / ${options.surfaceOpacity})`, backdropFilter: `blur(${options.blur}px)` }}>Moos</div>
      </div>
      <figcaption>{selected || changed ? '待保存预览' : '当前应用'}</figcaption>
    </figure>}
    <div className={fields.field}>
      <div className={fields.head}><label className={fields.label} htmlFor={`${id}-surface`}>面板透明度</label><output htmlFor={`${id}-surface`}>{transparencyPercent}%</output></div>
      <input className={css.range} id={`${id}-surface`} type="range" min={Math.round((1 - WALLPAPER_LIMITS.surfaceOpacity.max) * 100)} max={Math.round((1 - WALLPAPER_LIMITS.surfaceOpacity.min) * 100)} step={1} value={transparencyPercent} aria-valuetext={`${transparencyPercent}%`} disabled={editingDisabled}
        onChange={event => changeOption('surfaceOpacity', (100 - Number(event.currentTarget.value)) / 100)} />
    </div>
    <div className={fields.field}>
      <div className={fields.head}><label className={fields.label} htmlFor={`${id}-mask`}>图片遮罩</label><output htmlFor={`${id}-mask`}>{maskPercent}%</output></div>
      <input className={css.range} id={`${id}-mask`} type="range" min={Math.round(WALLPAPER_LIMITS.maskOpacity.min * 100)} max={Math.round(WALLPAPER_LIMITS.maskOpacity.max * 100)} step={1} value={maskPercent} aria-valuetext={`${maskPercent}%`} disabled={editingDisabled}
        onChange={event => changeOption('maskOpacity', Number(event.currentTarget.value) / 100)} />
    </div>
    <div className={fields.field}>
      <div className={fields.head}><label className={fields.label} htmlFor={`${id}-blur`}>图片模糊</label><output htmlFor={`${id}-blur`}>{options.blur} px</output></div>
      <input className={css.range} id={`${id}-blur`} type="range" min={WALLPAPER_LIMITS.blur.min} max={WALLPAPER_LIMITS.blur.max} step={1} value={options.blur} aria-valuetext={`${options.blur} 像素`} disabled={editingDisabled}
        onChange={event => changeOption('blur', Number(event.currentTarget.value))} />
    </div>
    <div className={`${form.footer} ${css.actions}`}>
      <button type="button" className={form.save} disabled={busy || (!selected && !changed)} onClick={apply}>{selected ? '应用背景图' : '保存背景效果'}</button>
      <button type="button" className={css.secondary} disabled={busy || !current} onClick={remove}>移除背景图</button>
    </div>
    <p className={css.note}>移除仅清理 Moos 保存的背景副本，原图仍在原处。</p>
    {(loading || pending || status) && <p role="status">{loading ? '正在读取已保存的背景…' : pending === 'choose' ? '正在读取图片…' : pending === 'apply' ? '正在保存背景…' : pending === 'remove' ? '正在移除背景…' : status}</p>}
    {(error || loadError) && <p className={css.error} role="alert">{error || '读取已保存的背景失败。可以重新选择本地图片。'}</p>}
  </section>;
}
