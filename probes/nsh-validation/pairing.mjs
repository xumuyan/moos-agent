/** Disposable N01 pairing authority. No persistence, LAN listener or UI confirmation. */
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { performance } from 'node:perf_hooks';
const hex = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const random = () => randomBytes(32).toString('hex');
const hash = value => createHash('sha256').update(value).digest('hex');
const same = (a, b) => hex(a) && hex(b) && timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
export class PairingError extends Error {
  constructor(status = 403) { super('Pairing request rejected'); this.status = status; }
}
function reject(status) { throw new PairingError(status); }
export function exact(input, keys) {
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || Object.keys(input).sort().join(',') !== [...keys].sort().join(',')) reject(400);
}

export function createPairingAuthority({ endpoint, caSHA256, leafSHA256, projects,
  now = () => performance.now(), invitationMs = 120000, credentialMs = 3600000 } = {}) {
  // Test authority only accepts a loopback TLS origin; this is not a LAN-enabling option.
  const url = new URL(endpoint);
  if (url.protocol !== 'https:' || !['127.0.0.1', 'localhost'].includes(url.hostname)
    || url.origin !== endpoint || !hex(caSHA256) || !hex(leafSHA256)
    || !Array.isArray(projects) || projects.length < 1 || projects.length > 8
    || projects.some(p => typeof p !== 'string' || !/^[a-z0-9_-]{1,64}$/.test(p))
    || new Set(projects).size !== projects.length
    || !Number.isSafeInteger(invitationMs) || invitationMs < 1 || invitationMs > 120000
    || !Number.isSafeInteger(credentialMs) || credentialMs < 1 || credentialMs > 3600000) throw new Error('Invalid pairing configuration');
  const allowedProjects = [...projects]; // Caller cannot mutate the authority's allowlist after creation.
  const invitations = new Map(), claims = new Map(), devices = new Map();
  let closed = false, previous = -Infinity;
  function clock() {
    const value = now();
    // A regressing/inoperable clock invalidates the whole disposable authority.
    if (!Number.isFinite(value) || value < previous) { closed = true; reject(503); }
    previous = value;
    if (closed) reject(503);
    for (const [id, item] of invitations) if (value >= item.deadline) invitations.delete(id);
    for (const [id, item] of claims) if (value >= item.deadline) claims.delete(id);
    for (const [id, item] of devices) if (value >= item.deadline) devices.delete(id);
    return value;
  }
  function claimFor(input) {
    exact(input, ['claimId', 'receipt']);
    if (!hex(input.claimId) || !hex(input.receipt)) reject(403);
    const claim = claims.get(input.claimId);
    if (!claim || !same(claim.receiptHash, hash(input.receipt))) reject(403);
    return claim;
  }
  return Object.freeze({
    invite() {
      const time = clock();
      if (invitations.size + claims.size >= 8 || devices.size >= 8) reject(429);
      const invitationId = random(), secret = random();
      invitations.set(invitationId, { secretHash: hash(secret), deadline: time + invitationMs });
      // Sensitive bootstrap material: caller must not put it in URLs, logs or telemetry.
      return { version: 1, endpoint, caSHA256, leafSHA256, invitationId, secret, validForMs: invitationMs };
    },
    claim(input) {
      const time = clock(); exact(input, ['invitationId', 'secret', 'clientNonce']);
      if (!hex(input.invitationId) || !hex(input.secret) || !hex(input.clientNonce)) reject(403);
      const invitation = invitations.get(input.invitationId);
      if (!invitation || !same(invitation.secretHash, hash(input.secret))) reject(403);
      invitations.delete(input.invitationId); // One claim consumes the invitation, including races.
      const claimId = random(), receipt = random();
      const transcript = hash(JSON.stringify([1, endpoint, caSHA256, leafSHA256,
        input.invitationId, claimId, input.clientNonce]));
      claims.set(claimId, { receiptHash: hash(receipt), transcript,
        deadline: Math.min(invitation.deadline, time + invitationMs), status: 'pending' });
      return { version: 1, claimId, receipt, transcript, status: 'pending' };
    },
    pending() {
      clock();
      return [...claims].filter(([, c]) => c.status === 'pending')
        .map(([claimId, c]) => ({ claimId, transcript: c.transcript }));
    },
    confirm({ claimId, transcript, allowProjects } = {}) {
      clock(); const claim = claims.get(claimId);
      if (!claim || claim.status !== 'pending' || !same(claim.transcript, transcript)) reject(403);
      if (!Array.isArray(allowProjects) || !allowProjects.length || new Set(allowProjects).size !== allowProjects.length
        || allowProjects.some(p => !allowedProjects.includes(p))) reject(400);
      claim.projects = [...allowProjects]; claim.status = 'approved';
    },
    deny(claimId) { clock(); claims.delete(claimId); },
    redeem(input) {
      const time = clock(); const claim = claimFor(input);
      if (claim.status !== 'approved') reject(409);
      if (devices.size >= 8) reject(429);
      const deviceId = random(), token = random();
      devices.set(deviceId, { tokenHash: hash(token), projects: claim.projects, deadline: time + credentialMs });
      claims.delete(input.claimId); // No re-delivery: lost response requires new pairing, not blind replay.
      return { version: 1, deviceId, token, expiresInMs: credentialMs, projects: [...claim.projects] };
    },
    authenticate(token, project) {
      clock(); if (!hex(token)) reject(401);
      const digest = hash(token);
      const entry = [...devices].find(([, d]) => same(d.tokenHash, digest));
      if (!entry) reject(401);
      if (!entry[1].projects.includes(project)) reject(404);
      return { deviceId: entry[0], project };
    },
    revoke(deviceId) { clock(); return devices.delete(deviceId); },
    close() { closed = true; invitations.clear(); claims.clear(); devices.clear(); }
  });
}
