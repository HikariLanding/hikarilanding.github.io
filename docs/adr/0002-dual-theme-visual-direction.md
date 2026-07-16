# 0002 — 双主题视觉方向：Lantern

## 状态

已接受（2026-07-16，经 /prototype 视觉验证，三变体对比后选定）

## 背景

需要验证「暖白基准、暗色带光感」的双主题方向在真实屏幕上是否成立。原型做了三个变体（A Ember 基准 / B Lantern 上限 / C Ash 无光晕对照），Hero + 三原则两段，亮暗各一套，共享同一组语义 token。原型代码在抛弃分支 `prototype/theme-check`（primary source，勿合入 main）。

## 决定

采用变体 **B — Lantern**：衬线大标题、左对齐 Hero、大数字行式三原则、暗色光晕用独立模糊元素实现。

### 色板（语义 token 终值）

| Token | Light | Dark |
|---|---|---|
| `--bg` | `#FAF4E9` | `#1A1510` |
| `--surface` | `#F3EAD8` | `#241D15` |
| `--text` | `#251F15` | `#F0E8D8` |
| `--text-secondary` | `#5E5544` | `#B0A489` |
| `--text-muted` | `#92876F` | `#7C7159` |
| `--border` | `#E7DCC2` | `#332A1E` |
| `--accent` | `#A16207` | `#F5B84C` |
| `--glow` | `transparent` | `rgba(245, 184, 76, 0.16)` |
| `--glow-strength` | `0` | `1` |

### 关键手法（验证得出的判断）

1. **强调色不复用同一色值**：暗色下换更亮更饱和的值（`#A16207` → `#F5B84C`），这是"光在夜里更像光"成立的核心；暗色底是深暖灰（`#1A1510`），不是亮色的简单反转。
2. **光晕是 token，不是组件分叉**：光晕实现为独立定位元素（radial-gradient + `filter: blur(64px)`），颜色吃 `--glow`、透明度吃 `--glow-strength`；强调词微光用 `text-shadow` 同样绑定 `--glow`。亮色主题下 `--glow: transparent` + 强度 0，光晕自然消失，无需任何主题条件分支。
3. **噪的边界**：模糊元素 alpha 0.16 + 微光 text-shadow 是上限观感，尚未滑向"噪"，但不宜再加强；光晕元素是静态的（不动效）。（票 #5 澄清：「静态」指稳态下不做任何动画；主题切换瞬间对 opacity 做 300ms 插值属状态迁移，不违反本条。）
4. **字体方向**：衬线大标题（Georgia / Iowan Old Style 栈验证通过）+ 系统无衬线正文。✅ web font 取舍已定（票 #3，2026-07-16）：**不引入**——系统衬线栈已达观感要求，web font 即使自托管也增加首屏载荷，与「Light, not noise」及零外部请求的红线相悖。衬线栈以 `--font-serif` token 形式落地。

### Token 结构结论

8 个语义 token + `--glow-strength` 覆盖了全部主题×区块组合，双主题共享一套 token 名**够用**。✅ 原标注的空档（`--surface` 无消费者、暗色层次未验证）已在项目卡片实现时（票 #4，2026-07-16）查验：暗色 surface/bg 对比 1.089（与 GitHub dark 卡片层次 1.094 相当），border/surface 1.182 承担轮廓；亮色对应 1.092 / 1.140。层次足够，token 值不变。

## 备选方案

- **A — Ember**：居中 Hero + 三栏原则，光晕直接用 radial-gradient 烘进 hero 背景（更省：无额外 DOM、无 blur 开销）。成立但整体气质弱于 B。
- **C — Ash**：完全无光晕，暗色只靠强调色提亮。证明了页面没有光晕依然成立，但 "Hikari"（光）的隐喻明显变弱——这也反证了光晕值得花这个成本。

## 后果

- `/to-spec` 可直接引用上表色值与光晕做法收敛规格。
- 光晕的 blur 是静态单元素，性能可接受；若实现阶段发现低端设备有问题，可降级为 A 的 radial-gradient 方案（视觉损失可控，token 结构不变）。
- ✅ 遗留项已定稿（票 #5，2026-07-16）：开关为右上角固定圆钮，日/月图标可见性与旋转吃 `--glow-strength`（与光晕同一 token 手法，零主题条件分支）；切换过渡 200ms ease（body/图标）+ 300ms ease（光晕 opacity），`prefers-reduced-motion` 下全站禁用过渡与动画。已知语义超载：`--glow-strength` 兼任「当前是暗色」信号——若未来光晕强度需要 0/1 之外的值，须引入独立的 `--theme-dark` token 再解耦。
