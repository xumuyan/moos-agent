const maxImageBytes = 5 * 1024 * 1024;
const maxImages = 8;
const mimeTypes = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function matchesImage(mime, bytes) {
  if (mime === 'image/png') return bytes.subarray(0, 8).equals(png);
  if (mime === 'image/jpeg') return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (mime === 'image/gif') return ['GIF87a', 'GIF89a'].includes(bytes.toString('ascii', 0, 6));
  return bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
}

export function desktopImages(reject) {
  const staging = new Map();
  function prune() {
    for (const [key, batch] of staging) if (Date.now() - batch.time > 120000) staging.delete(key);
  }
  return {
    stage({ sessionId, batchId, index, offset, data, mime }) {
      prune();
      if (!Number.isSafeInteger(index) || index < 0 || index >= maxImages ||
          !Number.isSafeInteger(offset) || offset < 0 || !mimeTypes.includes(mime) ||
          typeof data !== 'string' || data.length > 12288 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data)) reject('invalid_request');
      const key = sessionId + ':' + batchId;
      if (!data) { staging.delete(key); return {}; }
      let batch = staging.get(key);
      if (!batch) {
        if (index !== 0 || offset !== 0) reject('invalid_request');
        if (staging.size >= 2) reject('limit');
        batch = { time: Date.now(), images: [] };
        staging.set(key, batch);
      }
      const chunk = Buffer.from(data, 'base64');
      let image = batch.images[index];
      if (!image) {
        if (index !== batch.images.length || offset !== 0 || !matchesImage(mime, chunk)) reject('invalid_request');
        image = { mime, bytes: 0, chunks: [] };
        batch.images.push(image);
      }
      if (image.mime !== mime || image.bytes !== offset || index !== batch.images.length - 1) reject('invalid_request');
      if (image.bytes + chunk.length > maxImageBytes || image.chunks.length >= 600) reject('limit');
      image.chunks.push(chunk); image.bytes += chunk.length;
      batch.time = Date.now();
      return {};
    },
    peek(sessionId, batchId) {
      prune();
      const batch = staging.get(sessionId + ':' + batchId);
      if (!batch?.images.length) reject('not_found');
      return batch.images.map(i => ({ type: 'image', mimeType: i.mime, data: Buffer.concat(i.chunks, i.bytes).toString('base64') }));
    },
    consume(sessionId, batchId) { staging.delete(sessionId + ':' + batchId); },
    clear() { staging.clear(); },
  };
}
