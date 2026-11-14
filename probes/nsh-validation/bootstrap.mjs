/** Sensitive bootstrap serialization, local caller only; never a URL or HTTP response. */
import { X509Certificate, createHash } from 'node:crypto';
const hex = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
export function encodeBootstrap(invitation, caDER) {
  const expected = ['version', 'endpoint', 'caSHA256', 'leafSHA256', 'invitationId', 'secret', 'validForMs'];
  if (!invitation || Object.keys(invitation).sort().join(',') !== expected.sort().join(',')) throw new Error('Invalid bootstrap material');
  const { version, endpoint, caSHA256, leafSHA256, invitationId, secret, validForMs } = invitation;
  const address = typeof endpoint === 'string' ? /^https:\/\/(localhost|127\.0\.0\.1):([1-9][0-9]{0,4})$/.exec(endpoint) : null;
  if (version !== 1 || !address || Number(address[2]) > 65535 || Number(address[2]) === 443
    || ![caSHA256, leafSHA256, invitationId, secret].every(hex)
    || !Number.isSafeInteger(validForMs) || validForMs < 1 || validForMs > 120000
    || !Buffer.isBuffer(caDER) || caDER.length > 4096) throw new Error('Invalid bootstrap material');
  let ca;
  try { ca = new X509Certificate(caDER); } catch { throw new Error('Invalid bootstrap certificate'); }
  if (!ca.ca || !ca.raw.equals(caDER) || createHash('sha256').update(caDER).digest('hex') !== caSHA256) throw new Error('Invalid bootstrap certificate');
  // Fixed ASCII fields prohibit duplicate/unknown keys, escaped delimiters and URL credentials.
  const bytes = Buffer.from(['N01BOOT1', endpoint, caDER.toString('base64'), caSHA256,
    leafSHA256, invitationId, secret, String(validForMs)].join('\n'), 'ascii');
  if (bytes.length > 8192) throw new Error('Invalid bootstrap material');
  return bytes;
}
