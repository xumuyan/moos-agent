import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { expect, test } from 'vitest';
import lock from './upstream-source-lock.json';

test('keeps original upstream sheets and primitives byte-identical with a pinned source and license',()=>{
 expect(lock.commit).toBe('fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159');
 expect(lock.license).toBe('MIT');
 const originals=lock.files.filter(file=>file.mode==='verbatim');
 expect(originals.length).toBeGreaterThan(20);
 for(const file of originals){
   expect(file.upstream).toMatch(/^packages\/client\//);
   const bytes=readFileSync(file.local.replace(/^apps\/desktop\//,''));
   expect(createHash('sha256').update(bytes).digest('hex'),file.local).toBe(file.sha256);
 }
 const app=readFileSync('src/App.tsx','utf8');
 expect(app).toContain("'./vendor/dsh/theme/index.css'");
 expect(app).not.toMatch(/import ['"]\.\/(?:style\.css|theme\/(?:shell\.css|dsh\/))/);
 expect(app).not.toMatch(/<Sender\b/);
 expect(readFileSync('src/conversation/ConversationTranscript.tsx','utf8')).not.toContain('<Bubble');
});
