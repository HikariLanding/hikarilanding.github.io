/* 全页动效契约验证:headless Chrome 双跑(normal / --force-prefers-reduced-motion)。
   诞生于票⑦,是 ADR 0003 动效系统的行为级执法——单测锁声明,这里锁「真的在动」:
   1) 声明层:自设色元素的颜色类过渡都在 0.2s;光晕家族 0.3s
   2) 行为层:页内翻转主题,rAF 逐帧采样——颜色/光晕渐变确实在插值,不是硬切
   3) RM 层:白名单生效、hero 降级 fade-in、卡片 border/background 槽位同拍
   用法:HIKARI_REPOS_FIXTURE=$PWD/test/fixtures/repos.json npx astro build
        && node scripts/verify-motion.mjs
   踩坑记录(改动前先读):
   - --dump-dom + --virtual-time-budget 下过渡的动画时间线不推进,computed 采样
     恒为起点(且随机),--run-all-compositor-stages-before-draw 也救不了——必须
     真实时钟:本地 http 服务 + Chrome 常驻(remote-debugging-port)+ 探针 POST 回传
   - file:// 下产物的根绝对资源路径(/_astro/…)落空,CSS 整个不加载
   - headless 默认 prefers-color-scheme: dark,翻主题要翻向解析主题的反面 */
import { spawn } from 'node:child_process';
import { cpSync, existsSync, readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { createServer } from 'node:http';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const PROJECT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CHROME_PATHS = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
];
const chrome = CHROME_PATHS.find((p) => existsSync(p));
if (!chrome) throw new Error('no Chrome binary found');

const PROBE = `<script>
addEventListener('load', function () {
  var sel = {
    body: 'body', wordmark: '.wordmark', sub: '.sub', num: '.num',
    principle: '.principle', principleP: '.principle p', heading: '.projects-heading',
    card: '.card', cardName: '.card-name', footer: 'footer', footerA: 'footer a',
    toggle: '.theme-toggle', iconSun: '.icon-sun', h1em: 'h1 em', orb: '.glow-orb'
  };
  function styles() {
    var out = {};
    for (var k in sel) {
      var el = document.querySelector(sel[k]);
      if (!el) { out[k] = null; continue; }
      var cs = getComputedStyle(el);
      out[k] = {
        tp: cs.transitionProperty, td: cs.transitionDuration, ttf: cs.transitionTimingFunction,
        anim: cs.animationName, animDur: cs.animationDuration
      };
    }
    return out;
  }
  function colors() {
    var cs = function (s, prop) { return getComputedStyle(document.querySelector(s))[prop]; };
    return {
      sub: cs('.sub', 'color'),
      cardBg: cs('.card', 'backgroundColor'),
      toggleBorder: cs('.theme-toggle', 'borderTopColor'),
      orbBg: cs('.glow-orb', 'backgroundImage')
    };
  }
  var result = {
    declared: styles(), start: colors(), samples: [],
    prefersDark: matchMedia('(prefers-color-scheme: dark)').matches
  };
  // 等两帧让入场动画/首帧落定,再翻主题、逐帧采样
  requestAnimationFrame(function () { requestAnimationFrame(function () {
    document.documentElement.setAttribute('data-theme', result.prefersDark ? 'light' : 'dark');
    var t0 = performance.now();
    function tick() {
      var t = performance.now() - t0;
      result.samples.push({ t: Math.round(t), c: colors() });
      if (t < 450) { requestAnimationFrame(tick); return; }
      fetch('/report', { method: 'POST', body: JSON.stringify(result) });
    }
    requestAnimationFrame(tick);
  }); });
});
</script>`;

// 复制 dist、注入探针
const stage = mkdtempSync(join(tmpdir(), 'hikari-verify-'));
cpSync(join(PROJECT, 'dist'), stage, { recursive: true });
const html = readFileSync(join(stage, 'index.html'), 'utf8');
writeFileSync(join(stage, 'index.html'), html.replace('</body>', PROBE + '</body>'));

const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml' };
let pendingReport = null; // {resolve}
const server = createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/report') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      res.end('ok');
      pendingReport?.resolve(JSON.parse(body));
    });
    return;
  }
  const path = join(stage, req.url === '/' ? 'index.html' : req.url.split('?')[0]);
  try {
    const data = readFileSync(path);
    res.writeHead(200, { 'content-type': MIME[extname(path)] ?? 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const PORT = server.address().port;

async function run(rmFlag) {
  const report = new Promise((resolve, reject) => {
    pendingReport = { resolve };
    setTimeout(() => reject(new Error('report timeout' + (rmFlag ? ' (RM run)' : ''))), 20_000);
  });
  const child = spawn(chrome, [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    `--user-data-dir=${mkdtempSync(join(tmpdir(), 'hikari-chrome-'))}`,
    '--remote-debugging-port=0', // 常驻,等探针回传后由我们杀掉
    ...(rmFlag ? ['--force-prefers-reduced-motion'] : []),
    `http://127.0.0.1:${PORT}/index.html`,
  ], { stdio: 'ignore' });
  try {
    return await report;
  } finally {
    child.kill('SIGKILL');
  }
}

const ALLOWLIST = ['color', 'background-color', 'border-color', 'opacity', '--glow'];
const failures = [];
const ok = (cond, msg) => { if (!cond) failures.push(msg); };
const list = (s) => s.split(',').map((x) => x.trim());
// 声明的 (tp, td) 配对;td 短于 tp 时按 CSS 规则循环
const durOf = (d, prop) => {
  const tp = list(d.tp), td = list(d.td);
  const i = tp.indexOf(prop);
  return i === -1 ? null : td[i % td.length];
};
const COLOR_PROPS = ['color', 'background-color', 'border-color'];
const series = (run, k) =>
  run.samples.filter((_, i) => i % 4 === 0 || i === run.samples.length - 1)
    .map((s) => `${s.t}ms ${s.c[k]}`).join(' | ');
const interpolates = (run, k) => {
  const end = run.samples[run.samples.length - 1].c[k];
  return run.samples.some((s) => s.c[k] !== run.start[k] && s.c[k] !== end);
};

/* ---- normal run ---- */
const n = await run(false);
for (const [name, d] of Object.entries(n.declared)) {
  if (!d) { failures.push(`normal: ${name} not found`); continue; }
  for (const p of COLOR_PROPS) {
    const dur = durOf(d, p);
    if (dur !== null) ok(dur === '0.2s', `normal: ${name} ${p} = ${dur}, want 0.2s`);
  }
}
ok(durOf(n.declared.orb, 'opacity') === '0.3s', `normal: orb opacity = ${durOf(n.declared.orb, 'opacity')}, want 0.3s`);
ok(durOf(n.declared.h1em, 'text-shadow') === '0.3s', `normal: h1em text-shadow = ${durOf(n.declared.h1em, 'text-shadow')}, want 0.3s`);
ok(durOf(n.declared.h1em, 'color') === '0.2s', `normal: h1em color = ${durOf(n.declared.h1em, 'color')}, want 0.2s`);
ok(durOf(n.declared.card, 'transform') === '0.15s', `normal: card transform = ${durOf(n.declared.card, 'transform')}, want 0.15s`);
ok(n.declared.sub.anim.includes('fade-up') && n.declared.sub.animDur === '0.6s',
  `normal: hero entry = ${n.declared.sub.anim} ${n.declared.sub.animDur}, want fade-up 0.6s`);
for (const k of ['sub', 'cardBg', 'toggleBorder', 'orbBg']) {
  const end = n.samples[n.samples.length - 1].c[k];
  ok(n.start[k] !== end, `normal: ${k} theme flip changed nothing (${n.start[k]}); prefersDark=${n.prefersDark}`);
  ok(interpolates(n, k), `normal: ${k} not interpolating — start ${n.start[k]} / ${series(n, k)}`);
}

/* ---- reduced-motion run ---- */
const r = await run(true);
for (const [name, d] of Object.entries(r.declared)) {
  if (!d) { failures.push(`rm: ${name} not found`); continue; }
  ok(d.tp === ALLOWLIST.join(', '), `rm: ${name} transition-property = "${d.tp}", allowlist not enforced`);
  if (!['sub', 'wordmark'].includes(name)) {
    ok(d.anim === 'none', `rm: ${name} animation = ${d.anim}, want none`);
  }
}
ok(r.declared.sub.anim.includes('fade-in') && r.declared.sub.animDur === '0.3s',
  `rm: hero entry = ${r.declared.sub.anim} ${r.declared.sub.animDur}, want fade-in 0.3s`);
// 槽位映射:RM 下同框 border/background 同拍(卡片曾是 0.15/0.2 撕裂高危)
for (const name of ['card', 'toggle']) {
  const td = list(r.declared[name].td);
  const slot = (p) => td[ALLOWLIST.indexOf(p) % td.length];
  ok(slot('background-color') === slot('border-color'),
    `rm: ${name} slot tear — background ${slot('background-color')} vs border ${slot('border-color')}`);
}
// RM 行为层:颜色过渡保留——切主题仍是插值,不是硬切
for (const k of ['sub', 'cardBg', 'toggleBorder', 'orbBg']) {
  ok(interpolates(r, k), `rm: ${k} not interpolating under RM — start ${r.start[k]} / ${series(r, k)}`);
}

server.close();
if (failures.length) {
  console.error(`FAIL (${failures.length})`);
  for (const f of failures) console.error('  ✗ ' + f);
  process.exit(1);
}
console.log('PASS: normal + reduced-motion double-run');
console.log(`  normal .sub color: ${n.start.sub} → ${series(n, 'sub')}`);
console.log(`  rm     .sub color: ${r.start.sub} → ${series(r, 'sub')}`);
console.log(`  rm card td cycle: [${r.declared.card.td}] → bg/border same slot ✓`);
process.exit(0);
