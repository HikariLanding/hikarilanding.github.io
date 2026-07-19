/* 全页动效契约验证:headless Chrome 双跑(normal / --force-prefers-reduced-motion)。
   诞生于票⑦,是 ADR 0003 动效系统的行为级执法——单测锁声明,这里锁「真的在动」:
   1) 声明层:自设色元素的颜色类过渡都在 0.2s;光晕家族 0.3s
   2) 行为层:页内翻转主题,rAF 逐帧采样——颜色/光晕渐变确实在插值,不是硬切
   3) RM 层:白名单生效、hero 降级 fade-in、卡片 border/background 槽位同拍
   4) 按压层(票⑧):CDP 真实鼠标驱动 hover→press→release,逐帧采 transform——
      按下快于回弹、抬升全程锁定(无坠落/跳变)、昼影亮色浮现暗色为 none;
      RM 下卡片交互 transform 整体不作用(置 none),阴影浮现(opacity 白名单内)保留
   用法:HIKARI_REPOS_FIXTURE=$PWD/test/fixtures/repos.json npx astro build
        && node scripts/verify-motion.mjs
   踩坑记录(改动前先读):
   - --dump-dom + --virtual-time-budget 下过渡的动画时间线不推进,computed 采样
     恒为起点(且随机),--run-all-compositor-stages-before-draw 也救不了——必须
     真实时钟:本地 http 服务 + Chrome 常驻 + 探针 POST 回传
   - file:// 下产物的根绝对资源路径(/_astro/…)落空,CSS 整个不加载
   - headless 默认 prefers-color-scheme: dark,翻主题要翻向解析主题的反面
   - :hover/:active 不吃 dispatchEvent 合成事件,必须 CDP Input 真输入管线;
     Node 20 无内建 WebSocket,故 CDP 走 --remote-debugging-pipe(fd3/4,零依赖),
     顺带兼任常驻保活(取代原 --remote-debugging-port=0)
   - 卡片是 <a>,mouseReleased 会触发导航打断采样——探针里 click preventDefault
   - Input.dispatchMouseEvent 从下发到样式生效有不可控延迟(mousePressed 实测
     ~180ms,draggable=false 依旧,非拖拽消歧)——按压相位一律从采样轨迹推,
     T 表只管调度,不充当断言 0 点 */
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

/* 按压时间轴(探针时钟,/press-start 应答为 0 点;只管调度,不充当断言 0 点) */
const T = { move: 50, press: 450, release: 850, end: 1400 };

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
  var card = document.querySelector('.card');
  if (!card) {
    // 空态 fixture 的产物没有卡片(vitest 收尾恰好留下这种 dist)——显式报错,别静默超时
    fetch('/report', { method: 'POST', body: JSON.stringify({
      error: 'no .card in dist — rebuild with HIKARI_REPOS_FIXTURE=test/fixtures/repos.json'
    }) });
    return;
  }
  var result = {
    declared: styles(), start: colors(), samples: [], press: [],
    prefersDark: matchMedia('(prefers-color-scheme: dark)').matches,
    hoverCapable: matchMedia('(hover: hover) and (pointer: fine)').matches,
    shadowAtLoad: getComputedStyle(card, '::after').boxShadow
  };
  function pressPhase() {
    card.addEventListener('click', function (e) { e.preventDefault(); });
    card.scrollIntoView({ block: 'center' });
    requestAnimationFrame(function () { requestAnimationFrame(function () {
      var rect = card.getBoundingClientRect();
      result.shadowAfterFlip = getComputedStyle(card, '::after').boxShadow;
      fetch('/press-start', {
        method: 'POST',
        body: JSON.stringify({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 })
      }).then(function () {
        var t0 = performance.now();
        function tick() {
          var t = performance.now() - t0;
          result.press.push({
            t: Math.round(t),
            tf: getComputedStyle(card).transform,
            o: getComputedStyle(card, '::after').opacity
          });
          if (t < ${T.end}) { requestAnimationFrame(tick); return; }
          fetch('/report', { method: 'POST', body: JSON.stringify(result) });
        }
        requestAnimationFrame(tick);
      });
    }); });
  }
  // 等两帧让入场动画/首帧落定,再翻主题、逐帧采样;采完接按压阶段
  requestAnimationFrame(function () { requestAnimationFrame(function () {
    document.documentElement.setAttribute('data-theme', result.prefersDark ? 'light' : 'dark');
    var t0 = performance.now();
    function tick() {
      var t = performance.now() - t0;
      result.samples.push({ t: Math.round(t), c: colors() });
      if (t < 450) { requestAnimationFrame(tick); return; }
      pressPhase();
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
const pending = new Map(); // url → resolve
const server = createServer((req, res) => {
  if (req.method === 'POST') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      res.end('ok');
      pending.get(req.url)?.(JSON.parse(body));
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

/* CDP over --remote-debugging-pipe:请求走 fd3、应答走 fd4,\0 分帧 */
function makeCdp(child) {
  const [, , , toChrome, fromChrome] = child.stdio;
  const waiting = new Map();
  let id = 0;
  let buf = '';
  fromChrome.on('data', (chunk) => {
    buf += chunk.toString();
    for (let i; (i = buf.indexOf('\0')) !== -1; buf = buf.slice(i + 1)) {
      const msg = JSON.parse(buf.slice(0, i));
      if (!waiting.has(msg.id)) continue;
      const { resolve, reject } = waiting.get(msg.id);
      waiting.delete(msg.id);
      msg.error ? reject(new Error(`${msg.error.message} (CDP)`)) : resolve(msg.result);
    }
  });
  return (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      waiting.set(++id, { resolve, reject });
      toChrome.write(JSON.stringify({ id, method, params, sessionId }) + '\0');
    });
}

async function attachToPage(cdp) {
  for (let tries = 0; tries < 400; tries++) {
    const { targetInfos } = await cdp('Target.getTargets');
    const page = (targetInfos ?? []).find((t) => t.type === 'page' && t.url.includes('127.0.0.1'));
    if (page) {
      const { sessionId } = await cdp('Target.attachToTarget', { targetId: page.targetId, flatten: true });
      return sessionId;
    }
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error('page target never appeared over CDP pipe');
}

async function run(rmFlag) {
  const tag = rmFlag ? 'rm' : 'normal';
  const awaitPost = (url, ms) =>
    new Promise((resolve, reject) => {
      pending.set(url, resolve);
      setTimeout(() => reject(new Error(`${url} timeout (${tag} run)`)), ms);
    });
  const reportP = awaitPost('/report', 25_000);
  const pressP = awaitPost('/press-start', 15_000);
  const child = spawn(chrome, [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    `--user-data-dir=${mkdtempSync(join(tmpdir(), 'hikari-chrome-'))}`,
    '--remote-debugging-pipe',
    ...(rmFlag ? ['--force-prefers-reduced-motion'] : []),
    `http://127.0.0.1:${PORT}/index.html`,
  ], { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] });
  const cdp = makeCdp(child);
  try {
    const session = await attachToPage(cdp);
    // 探针报错(如空态 dist)时 /report 先到:别再等 /press-start,直接抛
    const failFast = reportP.then((rep) => {
      throw new Error(rep.error ?? 'probe reported before press-start');
    });
    failFast.catch(() => {}); // 好路径下 race 输家照样 reject,接住免得 unhandled
    const { x, y } = await Promise.race([pressP, failFast]);
    // 输入时刻以 /press-start 应答为 0 点,与探针采样时钟对表(局域回环偏差 ≪ 一帧)
    const mouse = (type, buttons, at) =>
      setTimeout(
        () =>
          cdp('Input.dispatchMouseEvent', {
            type, x, y,
            button: type === 'mouseMoved' ? 'none' : 'left',
            buttons,
            clickCount: type === 'mouseMoved' ? 0 : 1,
          }, session).catch((e) => failures.push(`${tag}: ${type} dispatch failed — ${e.message}`)),
        at,
      );
    mouse('mouseMoved', 0, T.move);
    mouse('mousePressed', 1, T.press);
    mouse('mouseReleased', 0, T.release);
    return await reportP;
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
// transform 矩阵里只关心两个通道:a=scaleX(按压),f=translateY(抬升)
const parseTf = (s) => {
  const m = /matrix\(([^)]+)\)/.exec(s);
  if (!m) return { a: 1, f: 0 }; // 'none'
  const v = m[1].split(',').map(Number);
  return { a: v[0], f: v[5] };
};

/* 按压层断言(票⑧)。normal:hover 抬升→按下→松开全程 f 锁 -2(不坠不跳)、
   scale 双向都在插值、按下 settle 明显快于回弹;RM:transform 只许离散生效 */
function pressChecks(d, tag, rm) {
  ok(d.hoverCapable, `${tag}: environment reports no hover/fine pointer — press physics unverifiable`);
  const P = (d.press ?? []).map((s) => ({ t: s.t, o: parseFloat(s.o), ...parseTf(s.tf) }));
  ok(P.length > 40, `${tag}: too few press samples (${P.length})`);
  if (P.length === 0) return {};
  if (process.env.HIKARI_DEBUG)
    console.log(`[${tag} press]`, P.map((s) => `${s.t}:${s.a.toFixed(4)}/${s.f.toFixed(1)}/${s.o}`).join(' '));
  if (rm) {
    // 验收「RM 下无位移/抬升」:hover/press 全程 transform 恒 identity——
    // 不只是不动画,而是整体不作用(index.astro 的 RM 置 none 条款)
    ok(P.every((s) => Math.abs(s.a - 1) < 0.003 && Math.abs(s.f) < 0.1),
      `${tag}: card transform moved under reduced motion (a ${Math.min(...P.map((s) => s.a))}..${Math.max(...P.map((s) => s.a))}, f ${Math.min(...P.map((s) => s.f))}..${Math.max(...P.map((s) => s.f))})`);
    // 阴影浮现走 opacity(白名单内),RM 下保留是预期行为
    ok(P.some((s) => s.o > 0.05 && s.o < 0.95), `${tag}: shadow reveal lost under reduced motion`);
    return {};
  }
  /* 相位边界从轨迹推,不拿输入调度时刻当 0 点:mousePressed 从下发到 :active
     生效实测迟 ~180ms(draggable=false 依旧,非拖拽消歧;mouseMoved ~40ms、
     mouseReleased ~5ms)。按压/回弹同尺量到 98% 阈值再比:100ms 曲线 ~58ms、
     200ms 曲线 ~116ms,±一帧粒度,90/95 的界线两边都留了裕量 */
  const findFrom = (from, pred) => {
    for (let i = Math.max(from, 0); i < P.length; i++) if (pred(P[i])) return i;
    return -1;
  };
  // scale 相位阈值:离站宽(DEPART)、到站严(SETTLE,≈98% 行程)——按压/回弹同尺才可比
  const REST = 1, PRESSED = 0.99, DEPART = 0.0005, SETTLE = 0.0002;
  const iPress = findFrom(0, (s) => s.a < REST - DEPART);
  const iPressSettle = iPress === -1 ? -1 : findFrom(iPress, (s) => s.a <= PRESSED + SETTLE);
  const iRelease = iPressSettle === -1 ? -1 : findFrom(iPressSettle, (s) => s.a > PRESSED + DEPART);
  const iReleaseSettle = iRelease === -1 ? -1 : findFrom(iRelease, (s) => s.a >= REST - SETTLE);
  ok(iPressSettle !== -1, `${tag}: press never reaches scale(0.99)`);
  ok(iReleaseSettle !== -1, `${tag}: release never settles back to scale(1)`);
  // hover 抬升在插值,且抬升锁定后直到结束 f 恒 -2:按下不坠、松开不跳——
  // 「先坠 2px 再收缩」通道相撞的行为级否证
  ok(P.slice(0, iPress === -1 ? P.length : iPress).some((s) => s.f < -0.2 && s.f > -1.8),
    `${tag}: hover lift not interpolating`);
  const iLift = findFrom(0, (s) => s.f <= -1.98);
  const locked = iLift === -1 ? [] : P.slice(iLift);
  ok(locked.length > 0 && locked.every((s) => Math.abs(s.f + 2) < 0.05),
    `${tag}: translateY not held at -2px through press+release (f range ${Math.min(...locked.map((s) => s.f))}..${Math.max(...locked.map((s) => s.f))})`);
  // 双向 scale 都在插值,不是硬切
  const between = (s) => s.a > PRESSED + DEPART && s.a < REST - DEPART;
  ok(P.some(between), `${tag}: press scale not interpolating`);
  ok(iPressSettle !== -1 && findFrom(iPressSettle, between) !== -1,
    `${tag}: release scale not interpolating`);
  const tp = iPressSettle === -1 ? null : P[iPressSettle].t - P[iPress].t;
  const tr = iReleaseSettle === -1 ? null : P[iReleaseSettle].t - P[iRelease].t;
  ok(tp !== null && tp <= 90, `${tag}: press ${tp}ms to 98% settle, want ≈58ms of a 100ms curve`);
  ok(tr !== null && tr >= 95 && tr <= 300, `${tag}: release ${tr}ms to 98% settle, want ≈116ms of a 200ms curve`);
  // 昼影浮现:hover 后 ::after opacity 0→1,且在插值
  ok(P.some((s) => s.o > 0.05 && s.o < 0.95), `${tag}: shadow reveal not interpolating`);
  ok(P[P.length - 1].o > 0.99, `${tag}: shadow not fully revealed at end (opacity ${P[P.length - 1].o})`);
  return { tp, tr };
}

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
// 票⑧起 transform 槽位归按压回弹拍 --dur-ui(hover 抬升随基态并入)
ok(durOf(n.declared.card, 'transform') === '0.2s', `normal: card transform = ${durOf(n.declared.card, 'transform')}, want 0.2s`);
ok(n.declared.sub.anim.includes('fade-up') && n.declared.sub.animDur === '0.6s',
  `normal: hero entry = ${n.declared.sub.anim} ${n.declared.sub.animDur}, want fade-up 0.6s`);
for (const k of ['sub', 'cardBg', 'toggleBorder', 'orbBg']) {
  const end = n.samples[n.samples.length - 1].c[k];
  ok(n.start[k] !== end, `normal: ${k} theme flip changed nothing (${n.start[k]}); prefersDark=${n.prefersDark}`);
  ok(interpolates(n, k), `normal: ${k} not interpolating — start ${n.start[k]} / ${series(n, k)}`);
}
const nPress = pressChecks(n, 'normal', false);

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
pressChecks(r, 'rm', true);

/* ---- 昼影主题面(两跑共验):亮色实影、暗色 IACVT 回落 none ---- */
for (const [tag, d] of [['normal', n], ['rm', r]]) {
  const s = d.prefersDark
    ? { dark: d.shadowAtLoad, light: d.shadowAfterFlip }
    : { dark: d.shadowAfterFlip, light: d.shadowAtLoad };
  ok(/8px 24px/.test(s.light ?? ''), `${tag}: light ::after box-shadow "${s.light}" missing the day shadow`);
  ok(s.dark === 'none', `${tag}: dark ::after box-shadow "${s.dark}", want none`);
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
console.log(`  press settle ${nPress.tp}ms → release settle ${nPress.tr}ms (快下慢回 ✓)`);
process.exit(0);
