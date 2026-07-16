import { execSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

const ROOT = new URL('..', import.meta.url).pathname;
const DIST = join(ROOT, 'dist');

/** dist 下全部文本产物（html + css）拼成一份,断言不关心 Astro 把样式内联还是外链 */
function distText(): string {
  const chunks: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.(html|css|js)$/.test(name)) chunks.push(readFileSync(path, 'utf8'));
    }
  };
  walk(DIST);
  return chunks.join('\n');
}

/** 以指定 fixture 构建一次,返回全部文本产物（dist 会被下次构建覆盖,只留字符串） */
function build(fixture: string): string {
  execSync('npx astro build', {
    cwd: ROOT,
    stdio: 'pipe',
    timeout: 180_000,
    env: { ...process.env, HIKARI_REPOS_FIXTURE: join(ROOT, 'test/fixtures', fixture) },
  });
  return distText();
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

let withProjects: string;
let emptyOrg: string;

beforeAll(() => {
  withProjects = build('repos.json');
  emptyOrg = build('repos-empty.json');
}, 400_000);

describe('built site', () => {
  it('produces an index page', () => {
    expect(withProjects).toContain('HikariLanding');
  });

  it('defines every Lantern semantic token', () => {
    for (const token of TOKENS) {
      expect(withProjects, `missing token ${token}`).toContain(`${token}:`);
    }
  });

  it('carries both theme palettes, switched by prefers-color-scheme', () => {
    expect(withProjects).toMatch(/prefers-color-scheme:\s*dark/);
    expect(withProjects.toUpperCase()).toContain('#FAF4E9'); // light --bg
    expect(withProjects.toUpperCase()).toContain('#1A1510'); // dark --bg
  });

  it('loads no external resources and ships no tracking', () => {
    for (const text of [withProjects, emptyOrg]) {
      const resources = [
        ...[...text.matchAll(/src=["'](https?:\/\/[^"']+)["']/g)].map((m) => m[1]!),
        ...[...text.matchAll(/<link[^>]+href=["'](https?:\/\/[^"']+)["']/g)].map((m) => m[1]!),
        ...[...text.matchAll(/url\(\s*["']?(https?:\/\/[^"')]+)/g)].map((m) => m[1]!),
      ];
      const external = resources.filter(
        (url) => !url.startsWith('https://hikarilanding.github.io'),
      );
      expect(external).toEqual([]);
    }
  });
});

describe('hero and principles', () => {
  it('renders the hero tagline with the emphasized word', () => {
    expect(withProjects).toMatch(/Small ideas <em[^>]*>land<\/em> and become real\./);
    expect(withProjects).toContain(
      'An open-source home for small software — warm, simple, quietly useful.',
    );
  });

  it('renders all three principles with elaborations', () => {
    for (const principle of ['Small tools, done well', 'Simple over clever', 'Light, not noise']) {
      expect(withProjects).toContain(principle);
    }
    for (const elaboration of ['One job each', 'Cleverness ages badly', 'Software that illuminates']) {
      expect(withProjects).toContain(elaboration);
    }
  });

  it('implements the glow as a dedicated blurred element bound to the glow tokens', () => {
    // ADR 0002：光晕是 token 消费者,不是组件分叉——亮色下靠 token 值自然熄灭
    expect(withProjects).toMatch(/<div class="glow-orb"[^>]*aria-hidden="true"/);
    expect(withProjects).toMatch(/filter:\s*blur\(/);
    expect(withProjects).toMatch(/radial-gradient\([^)]*var\(--glow\)/);
    expect(withProjects).toMatch(/opacity:\s*var\(--glow-strength\)/);
  });
});

describe('page completeness', () => {
  it('contains all four sections in order: hero, principles, projects, footer', () => {
    const anchors = ['class="hero"', 'aria-label="Principles"', 'id="projects-heading"', '<footer'];
    const positions = anchors.map((a) => withProjects.indexOf(a));
    for (const [i, pos] of positions.entries()) {
      expect(pos, `missing section anchor ${anchors[i]}`).toBeGreaterThan(-1);
    }
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it('has a footer with the org GitHub link, a copyright, and no personal signature', () => {
    const footer = withProjects.slice(withProjects.indexOf('<footer'));
    expect(footer).toContain('href="https://github.com/HikariLanding"');
    expect(footer).toContain('©');
    // 「品牌名片」约束（CONTEXT.md）:组织人格独立,不出现关联个人账号
    expect(withProjects).not.toContain('realjarvisma');
  });

  it('ships meta description, OG tags, and a favicon', () => {
    const head = withProjects.slice(withProjects.indexOf('<head'), withProjects.indexOf('</head>'));
    expect(head).toContain('name="description"');
    expect(head).toContain('property="og:title"');
    expect(head).toContain('property="og:description"');
    expect(head).toContain('property="og:url"');
    expect(head).toMatch(/<link rel="icon"/);
  });

  it('runs the entry animation under a motion-safe guard only', () => {
    expect(withProjects).toMatch(/@keyframes/);
    // 守卫块本体必须真的灭杀动画,而不只是媒体查询字符串存在
    const guardStart = withProjects.search(/prefers-reduced-motion:\s*reduce/);
    expect(guardStart).toBeGreaterThan(-1);
    expect(withProjects.slice(guardStart, guardStart + 300)).toMatch(/animation:\s*none/);
  });
});

describe('theme switching', () => {
  it('inlines the no-flash script inside <head>', () => {
    const head = withProjects.slice(withProjects.indexOf('<head'), withProjects.indexOf('</head>'));
    expect(head).toMatch(/localStorage\.getItem\(["']theme["']\)/);
    expect(head).toContain('data-theme');
  });

  it('ships manual-override token blocks alongside the system media query', () => {
    expect(withProjects).toMatch(/\[data-theme=["']?dark["']?\]/);
    expect(withProjects).toMatch(/\[data-theme=["']?light["']?\]/);
  });

  it('renders a keyboard-operable toggle with an accessible name', () => {
    expect(withProjects).toMatch(/<button[^>]*aria-label="[^"]+"/);
    expect(withProjects).toContain('theme-toggle');
  });

  it('disables transitions under prefers-reduced-motion', () => {
    expect(withProjects).toMatch(/prefers-reduced-motion:\s*reduce/);
  });

  it('writes no client storage key other than the theme', () => {
    const keys = [...withProjects.matchAll(/setItem\(\s*["']([^"']+)["']/g)].map((m) => m[1]);
    expect(keys.length).toBeGreaterThan(0);
    expect(new Set(keys)).toEqual(new Set(['theme']));
  });
});

describe('project section', () => {
  it('renders each Hikari Project as a card linking to its repo', () => {
    expect(withProjects).toContain('lumen');
    expect(withProjects).toContain('a tiny reading-light for your terminal');
    expect(withProjects).toContain('TypeScript');
    expect(withProjects).toContain('href="https://github.com/HikariLanding/lumen"');
    expect(withProjects).toContain('href="https://github.com/HikariLanding/komorebi"');
  });

  it('omits repos that are not Hikari Projects', () => {
    for (const excluded of ['borrowed-fork', 'retired', '.github']) {
      expect(withProjects).not.toContain(`href="https://github.com/HikariLanding/${excluded}"`);
    }
  });

  it('orders cards by most recent push', () => {
    expect(withProjects.indexOf('lumen')).toBeLessThan(withProjects.indexOf('komorebi'));
  });

  it('shows the empty state when the org has no projects yet', () => {
    expect(emptyOrg).toContain('something new is being built');
    expect(emptyOrg).not.toContain('lumen');
  });
});
