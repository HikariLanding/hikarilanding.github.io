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

/** 剥掉 Astro 作用域属性([data-astro-cid-*]),便于按纯选择器断言 */
const unscope = (css: string) => css.replace(/\[data-astro-cid-[^\]]*\]/g, '');

/** open 处 '{' 的配对 '}' 下标;-1 = 不配平 */
function matchingBrace(css: string, open: number): number {
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}' && --depth === 0) return i;
  }
  return -1;
}

/** 从 startRe 命中处起做花括号配平,返回该块的内文（@media / @keyframes 用） */
function braceBlock(css: string, startRe: RegExp): string {
  const m = startRe.exec(css);
  if (!m) return '';
  const open = css.indexOf('{', m.index);
  const end = matchingBrace(css, open);
  return end === -1 ? '' : css.slice(open + 1, end);
}

/** 所有 startRe 命中块的内文拼接（同名 @media 出现多次时用,如 RM 守卫） */
function blocksOf(css: string, startRe: RegExp): string {
  const out: string[] = [];
  for (let m; (m = startRe.exec(css)); ) {
    const open = css.indexOf('{', m.index);
    const end = matchingBrace(css, open);
    if (end === -1) break;
    out.push(css.slice(open + 1, end));
    css = css.slice(end + 1);
  }
  return out.join('\n');
}

/** 删除所有 startRe 命中的花括号块,留下块外文本 */
function stripBlocks(css: string, startRe: RegExp): string {
  for (let m; (m = startRe.exec(css)); ) {
    const open = css.indexOf('{', m.index);
    const end = matchingBrace(css, open);
    if (end === -1) return css;
    css = css.slice(0, m.index) + css.slice(end + 1);
  }
  return css;
}

/** 第一条匹配 selRe 选择器的规则体（规则体内无嵌套花括号） */
function ruleOf(css: string, selRe: RegExp): string {
  const m = selRe.exec(css);
  if (!m) return '';
  const open = css.indexOf('{', m.index);
  return css.slice(open + 1, css.indexOf('}', open));
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
  '--shadow',
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
    for (const token of MOTION_TOKENS) {
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

describe('card press physics and day shadow', () => {
  // 票⑧/ADR 0003「按压节拍」「深度对称」。选择器断言先 unscope 再匹配;
  // hover 专属效果一律躲进 (hover:hover) 守卫,守卫内外分开断言
  const HOVER_GUARD = /@media\s*\(\s*hover:\s*hover\s*\)/;

  it('defines --shadow as the daylight mirror of --glow: real in light, transparent in dark', () => {
    // 昼有影,夜的层次由 border/surface 承担(ADR 0002 实测)——零主题分支
    expect(withProjectsCss).toMatch(/--shadow:\s*0 8px 24px/);
    expect(withProjectsCss.match(/--shadow:\s*transparent/g) ?? []).toHaveLength(2);
    expect(withProjectsCss.match(/--shadow:/g) ?? []).toHaveLength(3);
  });

  it('pre-paints the hover shadow on a pseudo-element and reveals it via opacity only', () => {
    const after = ruleOf(unscope(withProjectsCss), /\.card::?after\s*\{/); // 压缩器会把 ::after 缩成 :after
    expect(after, 'missing .card::after shadow face').toBeTruthy();
    expect(after).toMatch(/box-shadow:\s*var\(--shadow\)/);
    expect(after).toMatch(/opacity:\s*0[;}]?/);
    expect(after).toMatch(/transition:\s*opacity var\(--dur-fast\) ease/);
    // 阴影浮现不直接过渡 box-shadow(每帧重绘)——ADR 0003
    expect(withProjectsCss).not.toMatch(/transition[^;{}]*box-shadow/);
  });

  it('keeps hover lift, hover colour, and shadow reveal behind the hover guard', () => {
    const guarded = braceBlock(unscope(withProjectsCss), HOVER_GUARD);
    const hover = ruleOf(guarded, /\.card:hover\s*\{/);
    expect(hover).toMatch(/border-color:\s*var\(--accent\)/);
    expect(hover).toMatch(/transform:\s*translateY\(-2px\)/);
    expect(ruleOf(guarded, /\.card:hover::?after\s*\{/)).toMatch(/opacity:\s*1/);
    // 触屏 tap 无残留 sticky 边框:守卫之外不得再有 .card 的 hover 规则
    // (RM 守卫内的 transform:none 取消条款不产生样式,先剥掉再断言)
    const outside = stripBlocks(
      stripBlocks(unscope(withProjectsCss), HOVER_GUARD),
      /@media\s*\(prefers-reduced-motion:\s*reduce\)/,
    );
    expect(outside).not.toMatch(/\.card[^,{]*:hover/);
  });

  it('composes the full transform on desktop press — never drops the hover lift', () => {
    // 部分覆写会让按下瞬间先坠 2px 再收缩(transform 通道相撞)——ADR 0003 背景③
    const guarded = braceBlock(unscope(withProjectsCss), HOVER_GUARD);
    expect(ruleOf(guarded, /\.card:active\s*\{/)).toMatch(
      /transform:\s*translateY\(-2px\)\s+scale\(0?\.99\)/,
    );
  });

  it('keeps the touch press a pure scale with no drop', () => {
    const outside = stripBlocks(unscope(withProjectsCss), HOVER_GUARD);
    const active = ruleOf(outside, /\.card:active\s*\{/);
    expect(active).toMatch(/transform:\s*scale\(0?\.99\)/);
    expect(active).not.toMatch(/translateY/);
  });

  it('presses on --dur-press and releases on --dur-ui without remapping RM colour slots', () => {
    const outside = stripBlocks(unscope(withProjectsCss), HOVER_GUARD);
    const active = ruleOf(outside, /\.card:active\s*\{/);
    // 快下:只覆写 transition-duration 且逐槽对齐基态列表(颜色×3 + transform)。
    // 整表简写会重排 RM 白名单的槽位循环,颜色类被拖离 --dur-ui(票⑧交接注记①)
    expect(active).toMatch(
      /transition-duration:\s*var\(--dur-ui\),\s*var\(--dur-ui\),\s*var\(--dur-ui\),\s*var\(--dur-press\)/,
    );
    expect(active).not.toMatch(/transition[-:](?!duration)/);
    // 慢回:回弹走基态 transform 槽位,归 --dur-ui(ADR 0003 token 表「按压回弹」)
    expect(ruleOf(outside, /\.card\s*\{/)).toMatch(/transform var\(--dur-ui\) var\(--ease-out\)/);
  });

  it('cancels lift and press deformation entirely under reduced motion', () => {
    // 验收「RM 下无位移/抬升」:⑥ 的白名单只禁 transform 过渡,不禁状态位移——
    // 离散跳位是无收益的闪变,RM 内整体置 none;hover 反馈由 border/昼影承担
    const rm = blocksOf(unscope(withProjectsCss), /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
    expect(rm).toMatch(/\.card:hover,\s*\.card:active\s*\{[^{}]*transform:\s*none/);
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
