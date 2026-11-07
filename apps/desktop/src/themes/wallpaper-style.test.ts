import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
test('local image skin retains readable content and usage seats without changing the default upstream theme',()=>{
 const css=readFileSync('src/themes/wallpaper.css','utf8');
 expect(css).toContain(":root[data-moos-wallpaper='true'] .dsh-response");
 expect(css).toContain(":root[data-moos-wallpaper='true'] .composer-context");
 expect(css).toContain(".composer-dock [role='heading']");
 expect(css).toContain('prefers-reduced-transparency:reduce');
 expect(css).not.toMatch(/https?:\/\//);
});
