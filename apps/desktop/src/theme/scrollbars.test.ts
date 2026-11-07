import { readFileSync } from 'node:fs';
import { expect,test } from 'vitest';
const original=readFileSync('src/vendor/dsh/theme/scrollbar.css','utf8');
const bridge=readFileSync('src/vendor/dsh/theme/moos-bridge.css','utf8');
test('uses the actual upstream fixed scrollbar geometry and exclusive standard fallback',()=>{
 expect(original).toContain('@supports not selector(::-webkit-scrollbar)');
 expect(original).toContain('width: var(--dsh-scrollbar-width)');
 expect(original).toContain('height: var(--dsh-scrollbar-width)');
 expect(bridge).toContain('scrollbar-color:transparent transparent');
 expect(bridge).toContain('*:hover::-webkit-scrollbar-thumb');
 expect(bridge).toContain('*:focus-within::-webkit-scrollbar-thumb');
});
test('keeps touch/forced-color recovery and never hides scrollbar geometry',()=>{
 expect(bridge).toContain('@media(hover:none)');
 expect(bridge).toContain('@media(forced-colors:active)');
 expect(bridge).toContain('scrollbar-color:auto');
 expect(bridge).toContain('background:GrayText');
 expect(bridge).not.toMatch(/scrollbar-width:\s*none/);
});
