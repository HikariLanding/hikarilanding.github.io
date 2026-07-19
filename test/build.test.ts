import { execSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

const ROOT = new URL('..', import.meta.url).pathname;
const DIST = join(ROOT, 'dist');

/** dist 下全部文本产物（html + css）拼成一份,断言不关心 Astro 把样式内联还是外链 */
function distText(pattern = /\.(html|css|js)$/): string {
  const chunks: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (pattern.test(name)) chunks.push(readFileSync(path, 'utf8'));
    }
  };
  walk(DIST);
  return chunks.join('\n');
}

/** 仅样式文本:外链 css 文件 + html 内联 <style> 块——动效断言只查样式,不误伤 JS/文案 */
function distCss(): string {
  const styleBlocks = [...distText(/\.html$/).matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(
    (m) => m[1]!,
  );
  return [distText(/\.css$/), ...styleBlocks].join('\n');
}

/** 以指定 fixture 构建一次,返回全部文本产物（dist 会被下次构建覆盖,只留字符串） */
function build(fixture: string): { all: string; css: string } {
  execSync('npx astro build', {
    cwd: ROOT,
    stdio: 'pipe',
    timeout: 180_000,
    env: { ...process.env, HIKARI_REPOS_FIXTURE: join(ROOT, 'test/fixtures', fixture) },
  });
  return { all: distText(), css: distCss() };
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

// docs/adr/0003 定稿的 motion token 表——全站唯一动效值来源
const MOTION_TOKENS = ['--ease-out', '--dur-press', '--dur-fast', '--dur-ui', '--dur-glow'];

let withProjects: string;
let withProjectsCss: string;
let emptyOrg: string;

beforeAll(() => {
  ({ all: withProjects, css: withProjectsCss } = build('repos.json'));
  emptyOrg = build('repos-empty.json').all;
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

});

describe('motion system', () => {
  it('defines every motion token and consumes them instead of literals', () => {
    for (const token of MOTION_TOKENS) {
      expect(withProjectsCss, `missing token ${token}`).toContain(`${token}:`);
    }
    // --dur-press 定稿入表但由票⑧「按压节拍」消费,本票只断言定义
    for (const token of ['--ease-out', '--dur-fast', '--dur-ui', '--dur-glow']) {
      expect(withProjectsCss, `token ${token} never consumed`).toContain(`var(${token})`);
    }
  });

  it('confines duration/easing literals to token definitions and the entry keyframes', () => {
    const outsideTable = withProjectsCss
      .replace(/--(?:dur-[a-z]+|ease-out):[^;}]+/g, '') // token 定义本身
      .replace(/animation:[^;}]*fade-(?:up|in)[^;}]*/g, '') // 入场 600ms / 降级 300ms:一次性 keyframes 值,定稿不入 token
      .replace(/animation-delay:[^;}]+/g, ''); // 入场 stagger,同属例外
    expect(outsideTable).not.toMatch(/cubic-bezier/);
    // 压缩器会把 150ms 写成 .15s,两种形态都不允许残留
    expect(outsideTable.match(/[\s:,(]\.?\d+(?:\.\d+)?m?s\b/g) ?? []).toEqual([]);
  });

  it('runs the hero entry as a one-shot fade-up on the entry-exempt duration', () => {
    expect(withProjectsCss).toMatch(/@keyframes fade-up/);
    expect(withProjectsCss).toMatch(/animation:\s*fade-up\s+(?:600ms|\.6s)\s+var\(--ease-out\)/);
  });

  it('keeps color transitions under reduced motion so theme switching stays a soft fade', () => {
    // 分级降级(ADR 0003,修订 0002 的全站禁用):不再有一刀切 transition:none
    expect(withProjectsCss).not.toMatch(/transition:\s*none/);
    const guardStart = withProjectsCss.search(/prefers-reduced-motion:\s*reduce/);
    expect(guardStart).toBeGreaterThan(-1);
    const guard = withProjectsCss.slice(guardStart, guardStart + 400);
    expect(guard).toMatch(
      /transition-property:\s*color\s*,\s*background-color\s*,\s*border-color\s*,\s*opacity\s*,\s*--glow\s*!important/,
    );
    expect(guard).toMatch(/animation:\s*none\s*!important/);
  });

  it('degrades the hero entry to a pure opacity fade under reduced motion', () => {
    const keyframes = withProjectsCss.match(/@keyframes fade-in\s*\{[\s\S]*?\}\s*\}/)?.[0];
    expect(keyframes, 'missing fade-in keyframes').toBeTruthy();
    expect(keyframes).toContain('opacity');
    expect(keyframes).not.toMatch(/transform|translate/);
    // 降级动画必须以 !important 压过全局灭杀,否则 RM 下 hero 变硬现
    expect(withProjectsCss).toMatch(/animation:\s*fade-in\s[^;}]*!important/);
  });
});

describe('theme unison', () => {
  // 票⑦/ADR 0003:随主题变化的颜色类属性统一 --dur-ui 一拍,光晕家族 --dur-glow 唯一例外
  it('groups every self-coloured element into the unison transition rule', () => {
    const unison = withProjectsCss.match(
      /([^{}]+)\{[^{}]*transition:\s*color var\(--dur-ui\) ease,\s*background-color var\(--dur-ui\) ease,\s*border-color var\(--dur-ui\) ease[^{}]*\}/,
    );
    expect(unison, 'missing grouped unison rule').toBeTruthy();
    // Astro 会在选择器里插入 [data-astro-cid-*] 作用域属性,剥掉后按逗号精确比对——
    // 子串包含有盲区('.principle p' 包含 '.principle',删掉后者测试照样绿)
    const selectors = unison![1]!
      .replace(/\[data-astro-cid-[^\]]*\]/g, '')
      .split(',')
      .map((s) => s.trim().replace(/\s+/g, ' '));
    // 自设颜色/背景/边框的元素必须入列;继承色元素随 body 过渡自然同拍,不必入列
    for (const sel of [
      '.wordmark',
      '.sub',
      '.num',
      '.principle',
      '.principle p',
      '.projects-heading',
      '.empty',
      '.card-name',
      '.card-desc',
      '.card-lang',
      'footer',
    ]) {
      expect(selectors, `${sel} missing from unison list`).toContain(sel);
    }
  });

  it('never puts a colour-class property off the ui beat (anti-tearing invariant)', () => {
    // 同一元素框上不得有两个不同 duration 的颜色类过渡——颜色类一律 var(--dur-ui)
    for (const decl of withProjectsCss.matchAll(/transition:([^;}]+)/g)) {
      for (const part of decl[1]!.split(',')) {
        const m = part.trim().match(/^(background-color|border-color|color)\s+(\S+)/);
        if (m) expect(m[2], `${m[1]} off the ui beat in "${decl[1]}"`).toBe('var(--dur-ui)');
      }
    }
  });

  it('keeps the glow family as the only slow beat: orb opacity+colour and em text-shadow', () => {
    // --glow 注册为 <color> 使渐变色可插值——否则暗→亮方向光晕在淡出走完前一帧消失
    expect(withProjectsCss).toMatch(/@property --glow\s*\{[^}]*syntax:\s*["']<color>["']/);
    expect(withProjectsCss).toMatch(
      /transition:\s*opacity var\(--dur-glow\) ease,\s*--glow var\(--dur-glow\) ease/,
    );
    expect(withProjectsCss).toMatch(/text-shadow var\(--dur-glow\) ease/);
    const glowConsumers = withProjectsCss.match(/[a-z-]+ var\(--dur-glow\)/g) ?? [];
    expect(new Set(glowConsumers)).toEqual(
      new Set(['opacity var(--dur-glow)', 'text-shadow var(--dur-glow)', '--glow var(--dur-glow)']),
    );
  });

  it('keeps border and background on the same beat under the reduced-motion allowlist', () => {
    // RM 白名单(全局 transition-property 覆写)按序循环取元素自身的 duration 列表——
    // 同框可见的两块颜色面(border + background)在 RM 槽位映射后也必须同拍
    const ALLOWLIST = ['color', 'background-color', 'border-color', 'opacity', '--glow'];
    for (const decl of withProjectsCss.matchAll(/transition:([^;}]+)/g)) {
      const parts = decl[1]!.split(',').map((p) => p.trim().split(/\s+/));
      const props = parts.map((p) => p[0]!);
      if (!props.includes('border-color') || !props.includes('background-color')) continue;
      const durs = parts.map((p) => p[1]!);
      const slot = (prop: string) => durs[ALLOWLIST.indexOf(prop) % durs.length];
      expect(slot('background-color'), `RM slot tear in "${decl[1]}"`).toBe(slot('border-color'));
    }
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

  it('crossfades the page colors on the ui beat when the theme flips', () => {
    expect(withProjectsCss).toMatch(
      /body\s*\{[^}]*transition:\s*background-color var\(--dur-ui\) ease,\s*color var\(--dur-ui\) ease/,
    );
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
