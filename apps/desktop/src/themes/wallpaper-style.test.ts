import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
test('local image skin retains readable content and usage seats without changing the default upstream theme',()=>{
 const css=readFileSync('src/themes/wallpaper.css','utf8');
 expect(css).toContain("[data-moos-skin-wallpaper='true']");
 expect(css).toContain("& .dsh-response, & .dsh-turn-work");
 expect(css).toContain("& .composer-context");
 expect(css).toContain(".composer-dock [role='heading']");
 expect(css).toContain('prefers-reduced-transparency: reduce');
 expect(css).not.toMatch(/https?:\/\//);
});

test('separates the adjacent process and reply in every skin', () => {
 const host = readFileSync('src/vendor/dsh/host.css', 'utf8');
 expect(host).toMatch(/\.dsh-turn-work\s*\+\s*\.dsh-response\s*\{\s*margin-block-start:\s*12px/);
});
