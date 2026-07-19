# 0003 — 动效系统：token 化、分级 reduced-motion 与主题同拍

## 状态

已接受（2026-07-18，经 apple-design × emil-design-eng 双哲学对辩三轮收敛：立场书 → 互驳 → 裁决）

## 背景

以「UI/UX/动效为第一优先级」推进设计时，两派对辩**独立**确认了三处真伤：

1. reduced-motion 一刀切（`* { none !important }`）连颜色过渡都杀，明暗切换对前庭敏感用户退化成整页硬切——体贴被实现成惩罚；
2. 主题切换只有 body（200ms）与光晕（300ms）两条时间线，其余元素（副标题、原则区大数字、wordmark、卡片底色、分隔 border、开关自身 border/background 撕裂）全部硬切；
3. 卡片按压 `:active` 的 `scale(0.99)` 整体覆写 hover 的 `translateY(-2px)`——按下瞬间先坠再缩，transform 通道相撞。

分歧点（切换机制、圆形扩散、阴影、材质化、回弹节拍）经互驳收敛，裁决如下。两派唯一的总纲共识也一并入档：**本页不缺动效，缺的是把已有三场动效做到帧级诚实——第一优先级的第一步不是加，是对。**

## 决定

### Motion token（收编三文件全部魔法数）

| Token | 值 | 用途 |
|---|---|---|
| `--ease-out` | `cubic-bezier(0.22, 1, 0.36, 1)` | 全站唯一位移/回弹曲线 |
| `--dur-press` | `100ms` | 按下反馈 |
| `--dur-fast` | `150ms` | hover 类即时反馈、阴影浮现 |
| `--dur-ui` | `200ms` | 主题切换同拍、按压回弹 |
| `--dur-glow` | `300ms` | 光晕（唯一例外拍） |

入场 fade-up（600ms，reduced-motion 降级 300ms）为一次性 keyframes 值，不入 token。新动效禁止引入表外魔法数。

➡️ 修订（2026-07-19，票⑧）：卡片 hover 抬升自「按压节拍」落地起并入 `--dur-ui`——CSS 过渡取目标态声明，回弹（`--dur-ui`）与抬升共用基态 transform 槽位，抬升必然随之；150/200 之差不可辨，撕裂可辨。`--dur-fast` 的「hover 类即时反馈」自此指颜色/阴影浮现类，不含卡片位移。

### 分级 reduced-motion（修订 0002 票 #5「全站禁用」条款）

`prefers-reduced-motion: reduce` 下：位移/形变类（transform 过渡、含位移的 keyframes）全禁；**color / background-color / border-color / opacity 及注册色 token `--glow` 的过渡保留**——颜色渐变帮助理解状态迁移，禁掉反而制造硬切。入场 fade-up 降级为纯 opacity 300ms。实现细节定稿：保留以全局 `transition-property` 白名单实现，白名单按序循环取各元素自身 duration 列表——**transition 简写内属性顺序决定 RM 槽位**，颜色类属性须排在 transform 之前，同框 border/background 才不会在 RM 下落进不同槽位撕裂。

### 主题切换同拍（修订票 #5 只写 body 的做法）

凡随主题变化的 color / background-color / border-color，统一 `--dur-ui` ease 同拍；**光晕家族**共用 `--dur-glow` 唯一例外拍（光比纸慢半拍，Lantern 仅有的诗意）——家族成员（票⑩改判后）：光晕本体的 opacity（渐变色为常量，不参与插值），及强调词微光的 text-shadow（`--glow` 注册为 `@property <color>`，供 RM 下微光颜色插值）。例外的单位是「拍」，不是单个消费者。**同一元素框上不得存在两个不同 duration 的颜色类过渡**（如开关 border 150 / background 200 的撕裂）；属性兼任交互反馈与主题过渡时统一取一值——150/200 之差不可辨，撕裂可辨。机制维持 CSS transition（天然可中断、retarget 不归零），延续票 #5「短、柔、可中断」。

➡️ 修订（2026-07-20，票⑩）：**光晕本体退出颜色插值**——orb 渐变色改常量（= 暗色 `--glow` 终值 `rgba(245 184 76 / 0.16)`），transition 仅 opacity 单通道：静态模糊层缓存为合成器纹理，主题切换零逐帧 paint；「暗→亮一帧消失」因颜色不再翻转而构造性根除，orb 不再依赖 `@property` 注册救硬切。`@property --glow` 注册**保留**，唯一消费者为强调词微光：text-shadow 半径改常量 24px，可见性全交 `--glow` alpha（`--glow-strength` 该处消费删除，0002 语义超载减一）；RM 下微光渐隐走 `--glow` 白名单槽（0.2s）≠ 家族 0.3s 拍——已判不可辨，豁免。光晕家族自此成员：orb 的 opacity、强调词微光的 text-shadow。

**升级条件**：若「新元素漏加主题过渡」类缺陷累计再发两次，机制升级为 View Transition 250ms crossfade（一条代码路径快照整页、观感不变——Apple 派的结构批评在此留档）；届时须复验连点 skip-to-end 的可接受度并修订本条。

### 深度对称：昼有影，夜有光

新增 `--shadow`，与 `--glow` 同款零分支手法、互为镜像：亮色实值 `0 8px 24px rgb(37 31 21 / 0.08)`，暗色 `transparent`（`#1A1510` 深底上影不可见；暗色抬升层次已由 border/surface 对比承担，见 0002 实测比值）。实现用伪元素预画阴影 + opacity `--dur-fast` 过渡，不直接过渡 box-shadow（每帧重绘）。

### 按压节拍

`:active` 必须写**完整 transform 合成**（如 `translateY(-2px) scale(0.99)`），禁止部分覆写；press `--dur-press`、release `--dur-ui`（快下慢回）。hover 专属效果（位移、变色）一律进 `(hover: hover)`——实现统一写作 `(hover: hover) and (pointer: fine)`（加严：电视/主机类「可悬停但粗指针」设备也按触屏对待），触屏不留 sticky 态；此守卫自票⑨起覆盖全站（卡片、主题开关、页脚链接）。补充（2026-07-19，票⑧）：reduced-motion 下交互位移/形变**整体不作用**（`transform: none`，同 hero 入场去位移的先例）——分级 RM 的白名单只禁过渡不禁状态位移，离散跳位对 RM 用户是无收益的闪变；hover 反馈由 border 变色与昼影浮现（皆在白名单内）承担。

➡️ 修订（2026-07-20，票⑩）：本条在开关（ThemeToggle）补作业落地——基态 transform 槽归 `--dur-ui`/`--ease-out`，`:active` 逐槽覆写 duration（照卡片先例），按压深度 `scale(0.96)`（0.95–0.97 区间截图对比定稿；旧值 0.92 在 44px 圆钮上过深，与卡片 0.99 的克制人格失调）；图标旋转曲线一并归 `--ease-out`。票⑧ RM 补充条款的条款面与执法面（单测 + 双跑）同步从卡片扩展到开关与图标（`.theme-toggle:active` 与 `.icon` 均 `transform: none`——可见图标旋转恒 0°，不受影响）。

## 否决清单（裁决定稿，复议唯一入口：/prototype + ADR）

- **主题切换圆形扩散**（View Transition clip-path 自开关涌出，450ms）：隐喻只对一半——亮→暗方向必然读作「灯里涌出黑夜」，视觉隐喻不能只对一半；全屏高对比移动边界会成为全页最大幅运动，对前庭最不友好；快照机制破坏可中断。
- **开关毛玻璃材质化**（backdrop-filter blur）：宽屏下按钮背后只有纯色 `--bg`，blur 无物可糊，纯付合成开销与两条回退分支。
- **scroll-reveal / 视差 / 3D tilt / 磁性按钮**：三屏名片，内容是承诺不是惊喜，回访者不该再等；无手势则不表演物理。
- **motion 库与新 React 岛屿**：本页无可打断手势，spring 无用武之地；0001 的岛屿预留继续封存。

## 备选方案

- **View Transition 全页快照（Apple 派主张）**：结构性消灭「手工枚举漏加过渡」——每个新元素 opt-in 的记忆负担是真实成本。但快照不可 retarget，连点即硬切重放，恰砸在用户最爱把玩的控件上；且本页定位是不再长大的名片（CONTEXT.md），枚举负担有界。降为升级路径（见同拍节），不即时采用。
- **维持 reduced-motion 一刀切**：实现最简，但对它要保护的人群造成整页硬切，两派一致否决。

## 后果

- 落地切四票：⑥ Motion 基建（token + 分级 RM）→ 阻塞 ⑦ 主题同拍、⑧ 卡片诚实化；⑨ 排版静细节无阻塞。
- 0002 中「切换过渡 200/300ms + reduced-motion 全站禁用」定稿条款由本 ADR 修订，0002 已加指针。
- 验收手法定稿：动效类改动以慢放录屏（或 DevTools Animations 面板降速）逐帧查硬切与跳变。
