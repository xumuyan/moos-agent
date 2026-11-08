import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, lstat, rename, readFile, writeFile, symlink, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const text = await readFile('/Applications/.moos-update-0.1.33/update.mjs','utf8');
const source = text.slice(text.indexOf('async function prepareMoveDestination('),text.indexOf('async function verifyReadableProfile('));
async function exists(p) {try {await lstat(p); return true;}catch(e){if(e.code!=='ENOENT')throw e;return false;}}
const prepare = new Function('join','mkdir','lstat','exists',source+'; return prepareMoveDestination;')(join,mkdir,lstat,exists);
for (const scenario of ['missing parent','existing old package','symlink parent']) test(scenario,async t=>{
 const root=await mkdtemp(join(tmpdir(),'moos-update-move-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const installed=join(root,'Moos.app'),staged=join(root,'staged.app'),old=join(root,'previous/Moos.app');
 await mkdir(installed);await mkdir(staged);await writeFile(join(installed,'identity'),'old');await writeFile(join(staged,'identity'),'new');
 if(scenario==='existing old package') {await mkdir(old,{recursive:true});await assert.rejects(prepare(installed,staged,old));}
 else if(scenario==='symlink parent') {await mkdir(join(root,'other'));await symlink(join(root,'other'),join(root,'previous'));await assert.rejects(prepare(installed,staged,old));}
 else {await prepare(installed,staged,old);await rename(installed,old);await rename(staged,installed);assert.equal(await readFile(join(installed,'identity'),'utf8'),'new');assert.equal(await readFile(join(old,'identity'),'utf8'),'old');}
});

test('candidate paths point to the accepted packaged files, including the packaged PI diagnostics', async () => {
  assert.ok(text.includes("targetShell: '0.1.33'"));
  assert.ok(text.includes("'pi-runtime/services/agent/provider-diagnostics.mjs'"));
  const paths = ['app/pi-models.js', 'profile-template/profiles/web/node_modules/moos-electron-shell/client.js',
    'host-runtime/dsh/node_modules/@deepseek-ai/dsh-client-ui-settings-models/lib/client.js',
    'pi-runtime/services/agent/provider-diagnostics.mjs'];
  for (const relative of paths) {
    assert.ok(text.includes("'"+relative+"'"));
    const staged = await readFile(join('/Applications/.moos-update-0.1.33/Moos.app/Contents/Resources', relative));
    const accepted = await readFile(join(process.cwd(), '.generated/moos-electron/build-uy2KoB/Moos.app/Contents/Resources', relative));
    assert.deepEqual(staged, accepted);
  }
});

test('candidate carries the GLM probe fix, the smaller hint styles, and a zero validation gate', async () => {
  const client = (await readFile(join('/Applications/.moos-update-0.1.33/Moos.app/Contents/Resources/profile-template/profiles/web/node_modules/moos-electron-shell/client.js'),'utf8'));
  assert.ok((client.match(/noteStyle/g)||[]).length >= 3);
  const diagnostics = (await readFile(join('/Applications/.moos-update-0.1.33/Moos.app/Contents/Resources/pi-runtime/services/agent/provider-diagnostics.mjs'),'utf8'));
  assert.ok(diagnostics.includes("effort: 'minimal'"));
  assert.ok(diagnostics.includes('max_output_tokens: glmReasoning ? 256 : 16'));
  const gate = JSON.parse(await readFile(join(process.cwd(),'artifacts/installed-update-0.1.33/validation-final/validation.json'),'utf8'));
  assert.deepEqual(gate, {core:0,electron:0,native:0,bridge:0,skin:0,docs:0});
  const runtime = JSON.parse(await readFile(join('/Applications/.moos-update-0.1.33/Moos.app/Contents/Resources/moos-runtime.json'),'utf8'));
  assert.equal(runtime.includesPiFixture, false);
});
