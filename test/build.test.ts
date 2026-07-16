import { execSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

const ROOT = new URL('..', import.meta.url).pathname;
const DIST = join(ROOT, 'dist');

/** dist 下全部文本产物（html + css）拼成一份,断言不关心 Astro 把样式内联还是外链 */
function builtText(): string {
  const chunks: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.(html|css)$/.test(name)) chunks.push(readFileSync(path, 'utf8'));
    }
  };
  walk(DIST);
  return chunks.join('\n');
}

const TOKENS = [
  '--bg',
  '--surface',
  '--text',
  '--text-secondary',
  '--text-muted',
  '--border',
  '--accent',
  '--glow',
  '--glow-strength',
];

beforeAll(() => {
  execSync('npx astro build', { cwd: ROOT, stdio: 'pipe', timeout: 180_000 });
}, 200_000);

describe('built site', () => {
  it('produces an index page', () => {
    const html = readFileSync(join(DIST, 'index.html'), 'utf8');
    expect(html).toContain('HikariLanding');
  });

  it('defines every Lantern semantic token', () => {
    const text = builtText();
    for (const token of TOKENS) {
      expect(text, `missing token ${token}`).toContain(`${token}:`);
    }
  });

  it('carries both theme palettes, switched by prefers-color-scheme', () => {
    const text = builtText();
    expect(text).toMatch(/prefers-color-scheme:\s*dark/);
    expect(text.toUpperCase()).toContain('#FAF4E9'); // light --bg
    expect(text.toUpperCase()).toContain('#1A1510'); // dark --bg
  });

  it('makes no external requests and ships no tracking', () => {
    const text = builtText();
    const urls = [
      ...[...text.matchAll(/(?:src|href)=["'](https?:\/\/[^"']+)["']/g)].map((m) => m[1]!),
      ...[...text.matchAll(/url\(\s*["']?(https?:\/\/[^"')]+)/g)].map((m) => m[1]!),
    ];
    const external = urls.filter((url) => !url.startsWith('https://hikarilanding.github.io'));
    expect(external).toEqual([]);
  });
});
