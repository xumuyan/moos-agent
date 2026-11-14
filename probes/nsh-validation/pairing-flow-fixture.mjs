/** Test-only ephemeral EC TLS identity. No installed CA, production data or credentials. */
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';
export async function pairingFlowFixture() {
  const base = resolve('artifacts/nsh-validation/pairing-flow'); await mkdir(base, { recursive: true });
  const dir = await mkdtemp(join(base, 'run-'));
  // This directory holds disposable private keys; don't depend on caller umask.
  const { chmod } = await import('node:fs/promises'); await chmod(dir, 0o700);
  let operation = 0;
  const run = (...args) => { operation++; return execFileSync('/usr/bin/openssl', args, { cwd: dir, timeout: 15000, stdio: 'pipe' }); };
  const close = () => rm(dir, { recursive: true, force: true });
  try {
    await writeFile(join(dir, 'ca.cnf'), '[req]\ndistinguished_name=dn\nx509_extensions=ca\n[dn]\n[ca]\nbasicConstraints=critical,CA:TRUE\nkeyUsage=critical,keyCertSign,cRLSign\n', { mode: 0o600 });
    run('ecparam', '-name', 'prime256v1', '-genkey', '-noout', '-out', 'ca.key');
    run('req', '-x509', '-sha256', '-new', '-key', 'ca.key', '-config', 'ca.cnf', '-out', 'ca.pem', '-days', '2', '-subj', '/CN=N01-flow-test');
    run('ecparam', '-name', 'prime256v1', '-genkey', '-noout', '-out', 'server.key');
    run('req', '-sha256', '-new', '-key', 'server.key', '-out', 'server.csr', '-subj', '/CN=localhost');
    await writeFile(join(dir, 'ext.cnf'), 'basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature\nextendedKeyUsage=serverAuth\nsubjectAltName=DNS:localhost,IP:127.0.0.1\n', { mode: 0o600 });
    run('x509', '-sha256', '-req', '-in', 'server.csr', '-CA', 'ca.pem', '-CAkey', 'ca.key', '-CAcreateserial', '-out', 'server.pem', '-days', '1', '-extfile', 'ext.cnf');
    for (const name of ['ca.key', 'server.key']) await chmod(join(dir, name), 0o600);
    const tls = { key: await readFile(join(dir, 'server.key')), cert: await readFile(join(dir, 'server.pem')), ca: await readFile(join(dir, 'ca.pem')) };
    return { dir, tls, close };
  } catch (error) {
    await close();
    throw new Error(`Disposable pairing flow identity failed (operation ${operation}, ${error.code === 'ETIMEDOUT' ? 'timeout' : 'rejected'})`);
  }
}
