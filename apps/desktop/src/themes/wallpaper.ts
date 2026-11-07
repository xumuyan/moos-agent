export interface WallpaperOptions {
  maskOpacity: number;
  surfaceOpacity: number;
  blur: number;
}

type WallpaperMime = 'image/png' | 'image/jpeg' | 'image/webp';
interface WallpaperImage {
  mime: WallpaperMime;
  width: number;
  height: number;
}
export interface WallpaperConfig extends WallpaperImage {
  options: WallpaperOptions;
}

export const WALLPAPER_LIMITS = {
  maskOpacity: { min: 0, max: 0.75 },
  surfaceOpacity: { min: 0.35, max: 1 },
  blur: { min: 0, max: 24 },
} as const;
export const DEFAULT_WALLPAPER_OPTIONS: Readonly<WallpaperOptions> = Object.freeze({
  maskOpacity: 0.22, surfaceOpacity: 0.82, blur: 8,
});
export const MAX_WALLPAPER_BYTES = 8 * 1024 * 1024;
const MAX_PIXELS = 20_000_000;
const FORMAT_ERROR = '请选择有效的 PNG、JPEG 或 WebP 图片';

function checkDimensions(width: number, height: number) {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) {
    throw new Error(FORMAT_ERROR);
  }
  if (width * height > MAX_PIXELS) throw new Error('背景图片不得超过 2000 万像素');
}

function inspectImage(buffer: ArrayBuffer): WallpaperImage {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  const at = (offset: number, tag: string) => [...tag].every((char, index) => bytes[offset + index] === char.charCodeAt(0));
  if (bytes.length >= 33 && [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value)
      && view.getUint32(8) === 13 && at(12, 'IHDR')) {
    return { mime: 'image/png', width: view.getUint32(16), height: view.getUint32(20) };
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    const frameMarkers = [0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf];
    let offset = 2;
    while (offset < bytes.length && bytes[offset] === 0xff) {
      while (bytes[offset] === 0xff) offset++;
      const marker = bytes[offset++];
      if (marker === 0xda || marker === 0xd9 || offset + 2 > bytes.length) break;
      const size = view.getUint16(offset);
      if (size < 2 || offset + size > bytes.length) break;
      if (frameMarkers.includes(marker) && size >= 8) {
        return { mime: 'image/jpeg', width: view.getUint16(offset + 5), height: view.getUint16(offset + 3) };
      }
      offset += size;
    }
  }
  if (bytes.length >= 25 && at(0, 'RIFF') && at(8, 'WEBP') && view.getUint32(4, true) + 8 === bytes.length) {
    const chunkSize = view.getUint32(16, true);
    if (20 + chunkSize <= bytes.length) {
      if (at(12, 'VP8X') && chunkSize >= 10) {
        const uint24 = (offset: number) => bytes[offset] + bytes[offset + 1] * 256 + bytes[offset + 2] * 65536;
        return { mime: 'image/webp', width: uint24(24) + 1, height: uint24(27) + 1 };
      }
      if (at(12, 'VP8L') && chunkSize >= 5 && bytes[20] === 0x2f) {
        const bits = view.getUint32(21, true);
        return { mime: 'image/webp', width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
      }
      if (at(12, 'VP8 ') && chunkSize >= 10 && bytes[23] === 0x9d && bytes[24] === 1 && bytes[25] === 0x2a) {
        return { mime: 'image/webp', width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff };
      }
    }
  }
  throw new Error(FORMAT_ERROR);
}

function readBlob(blob: Blob, as: 'buffer'): Promise<ArrayBuffer>;
function readBlob(blob: Blob, as: 'url'): Promise<string>;
function readBlob(blob: Blob, as: 'buffer' | 'url'): Promise<ArrayBuffer | string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (reader.result === null) reject(new Error('无法读取背景图片'));
      else resolve(reader.result);
    };
    reader.onerror = reader.onabort = () => reject(new Error('无法读取背景图片'));
    if (as === 'buffer') reader.readAsArrayBuffer(blob);
    else reader.readAsDataURL(blob);
  });
}

export type WallpaperDecoder = (url: string) => Promise<{ width: number; height: number }>;
const decodeWallpaper: WallpaperDecoder = url => new Promise((resolve, reject) => {
  const image = new Image();
  image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
  image.onerror = () => reject(new Error('背景图片已损坏或无法解码'));
  image.src = url;
});

async function readWallpaper(file: Blob, decode: WallpaperDecoder) {
  if (!(file instanceof Blob) || !file.size) throw new Error(FORMAT_ERROR);
  if (file.size > MAX_WALLPAPER_BYTES) throw new Error('背景图片不得超过 8 MB');
  const metadata = inspectImage(await readBlob(file, 'buffer'));
  checkDimensions(metadata.width, metadata.height);
  if (file.type && file.type !== metadata.mime) throw new Error('图片内容与文件类型不一致');
  const image = file.slice(0, file.size, metadata.mime);
  const url = await readBlob(image, 'url');
  const { width, height } = await decode(url);
  checkDimensions(width, height);
  const matchesHeader = width === metadata.width && height === metadata.height;
  // Browsers may apply the embedded EXIF orientation to JPEG photos.
  const orientedJpeg = metadata.mime === 'image/jpeg' && width === metadata.height && height === metadata.width;
  if (!matchesHeader && !orientedJpeg) throw new Error('图片尺寸与文件头不一致');
  return { image, url, metadata: { mime: metadata.mime, width, height } };
}

export async function validateWallpaper(file: File): Promise<WallpaperImage> {
  return (await readWallpaper(file, decodeWallpaper)).metadata;
}

function checkedOptions(input: Partial<WallpaperOptions>, base: Readonly<WallpaperOptions>): WallpaperOptions {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('背景参数无效');
  const options = { ...base };
  for (const key of ['maskOpacity', 'surfaceOpacity', 'blur'] as const) {
    const value = input[key] === undefined ? base[key] : input[key];
    const { min, max } = WALLPAPER_LIMITS[key];
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
      throw new Error('背景参数超出允许范围');
    }
    options[key] = value;
  }
  return options;
}

interface StoredWallpaper { image: Blob; options: WallpaperOptions }
export interface WallpaperStorage {
  read: () => Promise<StoredWallpaper | null>;
  write: (value: StoredWallpaper | null) => Promise<void>;
}

const DB_NAME = 'moos-wallpaper';
const STORE_NAME = 'wallpaper';
function openWallpaperDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('本机图片存储不可用')); return; }
    let request: IDBOpenDBRequest;
    try { request = indexedDB.open(DB_NAME, 1); }
    catch { reject(new Error('本机图片存储不可用')); return; }
    let blocked = false;
    request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME);
    request.onsuccess = () => {
      if (blocked) request.result.close();
      else resolve(request.result);
    };
    request.onerror = () => reject(new Error('本机图片存储不可用'));
    request.onblocked = () => { blocked = true; reject(new Error('本机图片存储被占用，请关闭其他 Moos 窗口后重试')); };
  });
}

async function transact<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openWallpaperDatabase();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, mode);
      const request = action(transaction.objectStore(STORE_NAME));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onabort = transaction.onerror = () => reject(new Error('无法读写本机背景图片'));
    });
  } finally { db.close(); }
}

const indexedWallpaper: WallpaperStorage = {
  async read() {
    if (typeof indexedDB === 'undefined') return null;
    return (await transact('readonly', store => store.get('active'))) ?? null;
  },
  async write(value) {
    if (value) await transact('readwrite', store => store.put(value, 'active'));
    else await transact('readwrite', store => store.delete('active'));
  },
};

export function createWallpaperManager(storage: WallpaperStorage, decode = decodeWallpaper, root = () => document.documentElement) {
  let current: { config: WallpaperConfig; image: Blob; url: string } | null = null;
  let loadError: string | null = null;
  let loading = false;
  let pendingLoad: Promise<WallpaperConfig | null> | null = null;
  let queue: Promise<void> = Promise.resolve();
  const events = new EventTarget();
  const notify = () => events.dispatchEvent(new Event('change'));
  const properties = [
    '--moos-wallpaper-image', '--moos-wallpaper-mask-opacity', '--moos-wallpaper-surface-opacity', '--moos-wallpaper-blur',
  ];
  function ordered<T>(operation: () => Promise<T>): Promise<T> {
    const result = queue.then(operation);
    queue = result.then(() => undefined, () => undefined);
    return result;
  }
  function apply(value: typeof current) {
    const element = root();
    if (value) {
      Object.freeze(value.config.options);
      Object.freeze(value.config);
      const { maskOpacity, surfaceOpacity, blur } = value.config.options;
      // URL is generated from a decoded Blob with an allowlisted MIME. Base64 cannot escape the CSS string.
      element.style.setProperty(properties[0], `url("${value.url}")`);
      element.style.setProperty(properties[1], String(maskOpacity));
      element.style.setProperty(properties[2], String(surfaceOpacity));
      element.style.setProperty(properties[3], `${blur}px`);
      element.dataset.moosWallpaper = 'true';
    } else {
      for (const property of properties) element.style.removeProperty(property);
      delete element.dataset.moosWallpaper;
    }
    current = value;
    loadError = null;
    notify();
  }
  function loadWallpaper() {
    if (pendingLoad) return pendingLoad;
    loading = true;
    pendingLoad = ordered(async () => {
      try {
        const stored = await storage.read();
        if (!stored) { apply(null); return null; }
        const options = checkedOptions(stored.options, DEFAULT_WALLPAPER_OPTIONS);
        const { image, url, metadata } = await readWallpaper(stored.image, decode);
        const config = { ...metadata, options };
        apply({ config, image, url });
        return config;
      } catch {
        loadError = '无法读取已保存的背景图片';
        throw new Error(loadError);
      } finally {
        loading = false;
        pendingLoad = null;
        notify();
      }
    });
    notify();
    return pendingLoad;
  }
  return {
    loadWallpaper,
    saveWallpaper: (file: File, patch: Partial<WallpaperOptions> = {}) => ordered(async () => {
      const options = checkedOptions(patch, current?.config.options ?? DEFAULT_WALLPAPER_OPTIONS);
      const { image, url, metadata } = await readWallpaper(file, decode);
      const config = { ...metadata, options };
      await storage.write({ image, options });
      apply({ config, image, url });
      return config;
    }),
    updateWallpaperOptions: (patch: Partial<WallpaperOptions>) => ordered(async () => {
      const previous = current;
      if (!previous) return null;
      const options = checkedOptions(patch, previous.config.options);
      const config = { ...previous.config, options };
      await storage.write({ image: previous.image, options });
      apply({ ...previous, config });
      return config;
    }),
    clearWallpaper: () => ordered(async () => {
      await storage.write(null);
      apply(null);
    }),
    getWallpaper: () => current?.config ?? null,
    getWallpaperPreview: () => current?.url ?? null,
    getWallpaperLoadError: () => loadError,
    getWallpaperLoading: () => loading,
    subscribeWallpaper: (listener: () => void) => {
      events.addEventListener('change', listener);
      return () => events.removeEventListener('change', listener);
    },
  };
}

export const {
  loadWallpaper, saveWallpaper, updateWallpaperOptions, clearWallpaper, getWallpaper,
  getWallpaperPreview, getWallpaperLoadError, getWallpaperLoading, subscribeWallpaper,
} = createWallpaperManager(indexedWallpaper);
