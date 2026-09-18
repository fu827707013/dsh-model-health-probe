# UI/交互规格书：dsh-model-health-probe 面板（「模型健康检查」页签）

> 状态：**v1.0.5**（2026-09-18）。作者：ui-designer。**自主设计**，不以 `dsh-concurrency-guard` 的视觉与交互为上限。
> 定位边界：`SPEC.md` 定义**数据、协议、行为、契约、验收**；本文件定义**视觉、布局、组件形态、交互、动效、无障碍**。
> 两者冲突时以 `SPEC.md` 的数据与行为约定为准；本文件只决定「怎么呈现」。
> 唯一硬约束：页签经 `ctx.slots.inject("conversation.view", …)` 注册；深浅主题都必须正确显示。

**变更记录**

| 版本 | 日期 | 变更 | 驱动 | 是否影响功能项 |
| --- | --- | --- | --- | --- |
| v1.0 | 2026-09-17 | 首版 | ui-designer | — |
| v1.0.1 | 2026-09-18 | ① **§1.3 可用高度算术修正**：`800 − 76 − 40 = 684` 漏减 composer 148px → 改为 `viewArea 高度 − 面板 padding`；② 新增 **§1.3.1 小屏降级**（低于阈值允许面板自身滚动，禁止 `overflow-y:hidden`）；③ 定义**支持视口 = 2048×927**（703.2px）与设计目标视口 1280×800（576px）；④ 同步 §0.3 / `V-L2` / `V-L3` / `V-L11` / §7.9 附录 | captain 授权解冻（reviewer F-R-08 ＋ 用户裁定「以我的真实屏幕为准，小屏时允许面板内滚动」） | **否**——不删减任何功能/信息项；仅修正几何基线与登记降级 |
| v1.0.2 | 2026-09-18 | ① **可用高度改为函数**：`slot(VH) = VH − 76 − 148`、内容盒 `= slot − 40`（**替代 v1.0.1 的单一常数视口**，避免用户改变窗口尺寸后结论悄悄失效）；② 新增**保证档位表**：A `VH ≥ 910`（硬约束，长响应最坏余量 **18px**）／B `888 ≤ VH < 910`／C `VH < 888`（降级）；③ 补 **1366×768 → slot 544**（常见笔记本）与 1440×900 → 676 两档实测，并标注 **1440×900 不属保证档**（长响应缺 9.2px）；④ 注明 **「0px 悬崖」组合不可达**（四行+note+长响应+警告行与「row ④ 渲染」互斥）；⑤ `V-L2`/`V-L3` 主判据改 `scrollBody` 不滚动 | captain 更新要求（reviewer 第 2 轮补充 1–4） | **否**——不删减任何功能/信息项；仅把常数改为函数、补档位、修判据形式 |
| v1.0.3 | 2026-09-18 | **判据双轨化（修正 v1.0.2 的单条判据）**：溢出发生在哪一层**取决于 `[data-mh-root]` 的写法**——`height:100%`（t24 前）下 root 被撑高、溢出上浮到 `scrollBody`（**页面级**滚动）；**t24 改用 `flex:1 1 0` 后反转**，root 成为上界、溢出关在**面板内**。故 §1.3 末注改为**双形态对照表**，并规定：**A 档两条都断言**（root 不溢出 **且** `scrollBody` 不滚动）；**B/C 档判别式为「root 溢出 且 `scrollBody` 不滚动」**（= 滚动在面板内而非页面级，符合用户裁定「小屏时允许**面板内**滚动」）。**只写单条判据会随写法变化而成空断言** | reviewer `flex:1 1 0` 发现 ＋ qa-verifier `render-report.md` §7.2 独立复现 | **否**——判据**更严**（A 档由一条变两条），不删减任何功能/信息项 |
| v1.0.4 | 2026-09-18 | 修正 §1.3.1 第 1 条的**残留旧口径**：原文「真实宿主里表现为 `scrollBody` 滚动」与 v1.0.3 的双轨结论矛盾（t28 后溢出在 root，不在 `scrollBody`）→ 改为「**滚动发生在面板内**（`root` 溢出、`scrollBody` 不滚动）」 | 我自查（v1.0.3 双轨化时的遗漏） | **否**——纯口径自洽修正 |
| v1.0.5 | 2026-09-18 | **口径显式化（防重复计入）**：① §1.3 逐项分配表「内容区合计 636」明细改为 `(122+60+100+210+88) + 56(gap) = 580 + 56 = 636`，行标题加注「**本行已含 gap，勿再另加**」，并新增「**⚠️ 口径警告**」段：总占用**只能** `636 + 40 = 676`，**不得**写成 `636 + 56 + 40 = 732`（gap 重复计入），另附逐行求和 `122+14+60+14+100+14+210+14+88+40 = 676` 作独立复核；② **`V-L11` 口径修正**：原文「五个区块高度之和 + 4×14 + 40 ≤ 703.2（**支持视口内容盒**）」——基准表述不明确且「703.2」被误标为内容盒（实为**槽位**上限，内容盒是 663.2）。改为显式写出 `580（不含gap）+ 56 + 40 = 676 ≤ slot(VH)+1`，并注明「本判据以 580 为起点、§1.3 表格的 636 已含 gap，**两者等价但不得混用**」 | captain 批准（本轮已有 **3 人**在同一类「口径/重复计入」上各栽一次：reviewer 127–149、qa-verifier 127.2、dev-client 732；显式标注是唯一防第 4 次的办法） | **否**——纯表述澄清，**未改动任何数值与判据** |

**本文档所有颜色、字号、几何数值均为实测**：token 取值读自本机运行中的 DSH GUI
（`getComputedStyle(document.body)` 的自定义属性枚举，浅色 / `body[data-ds-dark-theme]` 两套），
对比度用 WCAG 2.x 相对亮度公式离线计算（脚本与原始输出见 §7.9）。

---

## 0. 设计立场（先说取舍，再给规格）

### 0.1 这是一个「探针控制台」，不是一个「监控仪表盘」

guard 面板回答的是「**现在**系统处于什么状态」——它是**并行**的信息面板，所以它用卡片矩阵、指标条、表格并列铺开。
本面板回答的是「**我选定的这个目标，打过去到底通不通**」——它是一条**串行因果链**：

```
选目标  →  确认将发出什么  →  发送  →  看三层诊断  →  翻历史
 ①         ②              ③       ④            ⑤
```

因此本面板的**版面顺序 = 用户实际操作顺序**，自上而下读一遍就等于做一遍。
这是本设计与 guard 最根本的分野：**不铺卡片，排因果**。

### 0.2 结果区是主角，上面全是脚手架

一次测试的价值 90% 集中在结果区（状态 / 耗时 / HTTP / token / 三层链 / 响应内容）。
所以：

- **唯一使用 16px 字号的地方**是结果区的四个主数值（耗时、HTTP、total tokens、TTFT）——视觉重量即信息重量；
- **唯一使用抬升阴影的地方**是结果卡片——全屏只有一处 elevation，视线自动落上去；
- 结果区以下（记录条）靠**字号降一档 + 字重降一档**形成「正文 → 脚注」的层级落差。
  **不靠降低对比度**：脚注仍用 `label-secondary`（浅色 5.80:1），不用 `label-tertiary`（浅色 3.71:1，不达标）。

### 0.3 一屏看全是一条硬预算，不是一句口号

AC15 要求**A 档视口内**首屏无滚动看全。**可用高度是视口高度的函数**，不是常数：

```
槽位 slot(VH) = VH − 76（顶部偏移）− 148（composerSeat）     内容盒 = slot − 40（面板 padding）
```

**A 档（`VH ≥ 910`，`slot ≥ 686`）= 保证档**：本面板 border-box 需求 **663.2px**（短响应）～**685.2px**（长响应），
**放得下，最坏余量 18px**（长响应）。用户真实视口 2048×927（`slot` 703.2）**落在 A 档**。
我把这份预算逐项分配完（§1.3），第四行隐藏时再省 32px。

**B / C 档（`VH < 910`）允许面板自身滚动**——这是**已登记的降级行为**（§1.3.1），不是「通过」：
A 档内一屏看全**仍是硬约束**。例：设计目标视口 1280×800（`slot` 576）属 **C 档**，缺 ≥87.2px。
**禁止**用 `overflow-y: hidden` 掩盖缺口（那会裁掉长响应，与「信息密度高、一屏看全」直接冲突）。

> **为什么必须写成函数**：若只声明「2048×927 达标」，用户**换窗口尺寸（分屏 / 笔记本 / 缩放）就会悄悄失效**。
> reviewer 第 2 轮致错的根因正是把**未经复测的常数**当前提。故本规格所有几何结论一律由函数现算，并**记录取证视口**。

这条预算直接否决了几个常见做法：

| 被否决的做法 | 原因 |
|---|---|
| 面板内再分 Tab（「配置 / 结果 / 历史」） | 分页会把因果链切断，用户看不到「我选了什么 → 结果是什么」的同屏对应 |
| 三层诊断链竖排 3 行 | 竖排需 `3 × 58 + 2 × 8 = 190px`，横排只需 `58px`——多占 **132px**，且竖排弱化了「链」的语义 |
| 选择器做成可折叠抽屉 | AC15 明确要求首屏可见四行选择器 |
| 原始响应体默认展开 | 单条可达 8192 字符，一展开必然把一屏顶爆 |
| 三层链与响应区各占一个可折叠面板 | 折叠态下用户看不到诊断结论，而诊断结论正是这个面板存在的理由 |

### 0.4 有意为之的四个设计决定（供评审按此判定，不是缺陷）

1. **选择器是「条」不是「表单」**：四行标签固定 64px 槽宽对齐成一列，芯片自由换行；整条不加外框、不加底色，读起来是一根控制条而不是一张表。
2. **三层诊断链横排**：三层语义上就是一条链（上游失败下游 `skip`），横排既省 132px 又能画出 `›` 连接符表达因果。窄容器（< 720px）自动回退为竖排。
3. **响应区用 3 段分段控件**（模型文本 / 原始响应 / 请求详情）而不是三个折叠块：省约 36px，且三者是「同一个响应的三个视角」，用分段控件表达「互斥视图」比折叠块更准确。
4. **记录条固定 88px**：它是脚注不是数据区；点击某条记录会把该条结果载入结果区（明确标注「历史」并可一键返回），这样「翻历史」不需要另开一屏。

### 0.5 与 `SPEC.md` 的一处契约增量（**需要 captain 裁决，不阻塞实现**）

任务的功能结构把 **Temperature / Max Tokens / Timeout** 列为测试区控件；
但 `SPEC.md` §11.2 冻结的 `POST /test` 请求体只有
`{routeKey, modelId, stream, systemPrompt, userPrompt}`，§6.3 的请求体也不含 `temperature`，
且 `maxOutputTokens` / `hardTimeoutMs` 被定为**插件配置项**（§6.4 / §8.2）。

我不擅自发明端点字段，也不擅自删掉三个控件。**做法是两条路都留好，由宿主能力位决定走哪条**：

- 若 `GET /config` 返回 `capabilities.requestParams === true` → 三个控件**可编辑**，
  请求体带上 `temperature` / `maxOutputTokens` / `timeoutMs`（缺省/清空 = 不发送该字段）；
- 若该能力位缺失或为 `false` → 三个控件渲染为**只读态**：显示宿主生效值，
  `aria-disabled="true"` + `title="由插件配置固定，本机不可在面板修改"`，请求体不含这三个字段。

两种形态的视觉与无障碍规格都在 §3.6 给全，dev-client 两条路都能实现，**不会因此阻塞**。
若 captain 采纳增量，`SPEC.md` 需走变更单补三处：`GET /config` 的 `capabilities` 与 `defaults`、
`POST /test` 的请求体、`TestResult.target` 的回显字段。

---

## 1. 整体布局与视觉层级

### 1.1 结构总览（单列、自上而下的因果流）

```
┌─ [data-mh-root]  role=region  aria-label="模型健康检查"   ──────────────┐
│  内边距 16px 20px 24px；display:flex; flex-direction:column; gap:14px   │
│  overflow-y:auto; min-height:0;  font-variant-numeric: tabular-nums     │
│                                                                        │
│  ╔══ ① 目标选择条 [data-mh-rail] ════════════════════════════════════╗  │
│  ║ 供应商  [xcmapi.com/v1 ·4] [happycodeai.com] [happycodeai.com/v1] ║  │
│  ║ API 类型[openai-completions] [anthropic-messages]                 ║  │
│  ║ 模型    [glm-5.3-flash] [deepseek-v4.1-flash] [gpt-5.6-sol ·2] …  ║  │
│  ║ 路由    [api-tcvps-006 ·] [api-tcvps-008 ·]        ← 条件渲染     ║  │
│  ╚═══════════════════════════════════════════════════════════════════╝  │
│                                                                        │
│  ╔══ ② 将请求 [data-mh-preview]  内凹底 bg-module-platform ══════════╗  │
│  ║ POST  https://www.xcmapi.com/v1/chat/completions          [复制]  ║  │
│  ║ 路由 api-tcvps-006 · 协议 openai-completions · 密钥 API_TCVPS_006_API_KEY ✓已配置 ║
│  ║ ⓘ 本探针只发协议最小头集，不应用路由的 headers / compat / 重试策略 ║  │
│  ╚═══════════════════════════════════════════════════════════════════╝  │
│                                                                        │
│  ╔══ ③ 测试区 [data-mh-test] ════════════════════════════════════════╗  │
│  ║ [测试消息 textarea                                    ] [Ctrl+↵]   ║  │
│  ║ [严格校验 ✓] [流式 ⬤] Temp[  ] Max[ 64] 超时[60000]ms   [发送测试] ║  │
│  ╚═══════════════════════════════════════════════════════════════════╝  │
│                                                                        │
│  ╔══ ④ 结果区 [data-mh-result]  role=region aria-busy  ← 唯一抬升面 ═╗  │
│  ║ ● Healthy   耗时 122ms   HTTP 200   tokens 31→1 = 32   TTFT —     ║  │
│  ║ ┌─ API 请求 ✓──┐ › ┌─ 模型响应 ✓──┐ › ┌─ 严格校验 ✓──┐            ║  │
│  ║ │ 已收到 HTTP… │   │ 提取到模型…   │   │ 响应文本与…   │            ║  │
│  ║ └──────────────┘   └───────────────┘   └──────────────┘            ║  │
│  ║ 响应内容  [模型文本|原始响应|请求详情]              [复制] 2 字符   ║  │
│  ║ ┌─────────────────────────────────────────────────────────────┐   ║  │
│  ║ │ OK                                                          │   ║  │
│  ╚═╧═════════════════════════════════════════════════════════════╧═══╝  │
│                                                                        │
│  ╔══ ⑤ 最近测试记录 [data-mh-records]  固定 88px，内部滚动 ══════════╗  │
│  ║ 最近测试 12 条                              [展开] [清空]          ║  │
│  ║ ● 14:02:11  glm-5.3-flash      api-tcvps-006  122ms  200           ║  │
│  ║ ● 14:01:03  gpt-5.6-sol        api-tcvps-008  18.4s  200  Slow     ║  │
│  ╚═══════════════════════════════════════════════════════════════════╝  │
└────────────────────────────────────────────────────────────────────────┘
```

### 1.2 视觉层级（4 级，用「字号 + 字重 + 颜色 + 表面」四轴同时拉差）

| 级别 | 承载内容 | 字号 | 颜色 | 表面 |
|---|---|---|---|---|
| **L1 焦点** | 状态徽标、四个主数值（耗时 / HTTP / total tokens / TTFT） | 16px / 500 | `label-primary` | 结果卡（唯一 elevation） |
| **L2 结构** | 区块标题（「将请求」「响应内容」）、选中芯片文字、主按钮 | 13px / 500 | `label-primary` | — |
| **L3 正文** | 三层链 detail、响应内容、记录行主字段、输入框文字 | 12–14px / 400 | `label-secondary` | — |
| **L4 脚注** | 单位、行标签、时间戳、字数、表头 | 11px / 400 | `label-secondary`（**不用 `label-tertiary`**，见 §2.4） | — |

关键点：**L4 也必须是 `label-secondary`**。实测 `label-tertiary` 在浅色主题对白底只有 **3.71:1**、
对 `bg-module-platform` 只有 **3.42:1**，11px 属正文不享大字号豁免，用它就是不达标。
L4 靠 11px 的字号差和字重差拉开层级，不靠降低对比度。

### 1.3 一屏预算（**按视口高度求值的函数**，非固定常数）

> **v1.0.1 修正**：本节原写「1280×800 下可用高度 684px（`800 − 76 − 40`）」，**算术错误**——
> 它把 `scrollBody` 高度当成了面板可用高度，**漏减 composer 输入区的 148px**。
> 详见下方「修正前 / 修正后」与 §1.3.1。旧数字 684 是**高估**，本版一律以函数现算为准。
>
> **v1.0.2 修正**：本节原把「支持视口」写成一个常数视口（2048×927）。
> **常数会在用户改变窗口尺寸（分屏 / 笔记本 / 缩放）时悄悄失效**——这正是 reviewer 第 2 轮
> 把「未经复测的常数」当前提而致错的同一类问题。现改为**函数形式 + 明确保证档位**（见下）。

**核心算式（本规格唯一权威口径，任何视口都用它现算）**：

```
槽位（面板 border-box 可用上限）   slot(VH)        = VH − 76 − 148
面板可用内容盒                     contentBox(VH)  = VH − 76 − 148 − 40 = VH − 264
```

| 项 | 值 | 含义 | 证据 |
| --- | --- | --- | --- |
| `VH` | 视口高度 | 浏览器视口高度（`window.innerHeight`） | — |
| **76** | 顶部偏移 | 页签条下沿到视口顶的距离（`.wSkVaW_scrollBody` 的 `top`） | 实测 `scrollBody top = 76.0` |
| **148** | `composerSeat` | 输入区（含 `contenteditable`）的固定高度；`flex:0 0 auto`，是 `viewArea` 的**平铺兄弟**，必然占走 148px | 实测 `composerSeat h = 148.0`，两视口恒等式均成立 |
| **40** | 面板 padding | `padding: 16px 20px 24px` → 16（上）+ 24（下） | §3.1 / `V-L10` |

**边界情形**：`VH ≤ 264` 时 `contentBox ≤ 0`，面板无可用内容区（实际不会出现：DSH 最小窗口高度远大于此）。

```js
// 权威取法：直接量 viewArea 元素（等价于上面的函数，且对宿主微调免疫）
const slot = document.querySelector('.wSkVaW_viewArea').getBoundingClientRect().height;
const contentBox = slot - 40;   // 面板 padding: 16px 20px 24px → 16 + 24 = 40
```

> **函数与实测的亚像素差**：`slot(927) = 703.0` 而实测 `703.2`（`779.2 − 76.0`）；
> `slot(986) = 762.0` 而实测 `762.4`。差来自视口高度的整数化与宿主 sub-pixel 布局，
> **属测量噪声（≤0.4px），不作为判据分歧**（判据带 `+1px` 容差，见 §7.1）。
> **实测值优先于函数值**——函数用于**推算未测视口**。

**修正前 / 修正后对照（1280×800 视口）**：

| | 算式 | 结果 | 判定 |
|---|---|---|---|
| **修正前（错）** | `800 − 76（页签条下沿）− 40（padding）` | 684px | ❌ **漏减 composer 148px**，高估 148px |
| **修正后（对）** | `800 − 76 − 148 − 40` = `slot 576 − 40` | **536px** | ✅ 与实测恒等式吻合 |

**宿主几何恒等式（两个视口交叉验证，实测）**：

| 视口 | `scrollBody` | `composerSeat`（`flex:0 0 auto`，含 `contenteditable`） | `viewArea`（面板真实槽位） | 恒等式 | 内容盒（−40 padding） |
|---|---|---|---|---|---|
| **用户真实视口 2048×927**（**支持视口**） | 851.2 | **148.0** | **703.2** | `703.2 + 148.0 = 851.2` ✓ | **663.2** |
| 设计目标视口 1280×800 | 724.0 | **148.0** | **576.0** | `576.0 + 148.0 = 724.0` ✓ | **536.0** |

> `composerSeat` 是 `viewArea` 的**平铺兄弟**（sibling），不是浮层——所以它**必然**从面板可用高度里扣掉。
> 1280×800 的边界实测：`viewArea` top 76.0 → bottom 652.0（h 576）；`composerSeat` top 652.0 → bottom 800.0（h 148）；**严丝合缝、无重叠无缝隙**。

**保证档位（按视口高度划分，判定基准）**：

需求侧（t24 后实测，border-box）：**短响应 663.2px**、**长响应（156 字符）685.2px**。
故按 `slot(VH) = VH − 224` 反解，得到两档：

| 档位 | 视口高度条件 | 槽位条件 | 保证内容 | 面板滚动 |
| --- | --- | --- | --- | --- |
| **A 保证档（硬约束）** | `VH ≥ 910` | `slot ≥ 686.0` | **任意响应长度（含长响应 685.2）都无滚动**，七元素全可见 | **不允许**（AC15 硬约束） |
| **B 基本档** | `888 ≤ VH < 910` | `664.0 ≤ slot < 686.0` | **短响应无滚动**；长响应可能超出 ≤ 21.2px | 长响应时降级为面板内滚动（响应块内部滚动优先，见 §1.3.1） |
| **C 降级档** | `VH < 888` | `slot < 664.0` | 短响应即可能超出 | **允许面板自身滚动**，须显式声明并记录缺口（§1.3.1） |

> **阈值的由来（可复核）**：`VH ≥ 685.2 + 224 = 909.2` → 取整 **910**（保证档）；
> `VH ≥ 663.2 + 224 = 887.2` → 取整 **888**（基本档）。**取整方向偏保守**（向上取），故档内一定满足。
> ⚠️ **`1440×900` 不属于保证档**：`slot(900) = 676 < 685.2`，长响应缺 **9.2px**。常见误判，特此写明。

**逐档核验表（多视口实测/推算）**：

| 视口 | `slot` | 短响应余量 | 长响应余量 | 档位 | 判定 |
| --- | --- | --- | --- | --- | --- |
| **2048×927（用户真实视口）** | **703.2**（实测） | **+40.0** | **+18.0** | **A** | ✅ **无滚动**（硬约束满足） |
| 1922×986（旁证） | 762.4（实测） | +99.2 | +77.2 | **A** | ✅ 无滚动 |
| 1440×900 | 676.0 | +12.8 | **−9.2** | **B** | ⚠️ 短响应无滚动；长响应降级 |
| 1366×768（常见笔记本） | **544.0** | **−119.2** | **−141.2** | **C** | ⚠️ 降级：面板自身滚动 |
| 1280×800（设计目标视口） | 576.0 | −87.2 | −109.2 | **C** | ⚠️ 降级：面板自身滚动 |

> **⚠️ 一处需特别留意的换算陷阱**：`1366×768` 的**槽位是 544px**（`768 − 224`），
> **不是 504px**——504 是**内容盒**（`544 − 40`）。两者相差 40px，混用会导致档位误判。
> 本规格统一以 **`slot`（border-box 上限）** 作档位判据。

**判定的通用规则（避免再次写成常数）**：

1. **档位一律由 `slot(VH) = VH − 224` 现算**，不得硬编码 684、536 或任何单一视口的结论；
2. **A 档内**：一屏看全是**硬约束**（AC15 / `V-L2` / `V-L3`）；
3. **B / C 档**：降级为「允许面板自身滚动」，须**显式声明**并记录缺口像素（§1.3.1）；
4. 用户改变窗口尺寸时档位随之变化——**验收须记录取证时的视口尺寸**，否则结论不可复现。

**支持视口（2048×927）下的逐项分配**：

| # | 区块 | 高度 | 构成明细 |
|---|---|---|---|
| ① | 目标选择条 | **122** | 4 × 26（行高）+ 3 × 6（行间距） |
| — | gap | 14 | 根容器 `row-gap` |
| ② | 将请求 | **60** | 8（`padding: 4px 10px` 的上下）+ 18（URL 行）+ 18（元信息行）+ 16（偏差声明行） |
| — | gap | 14 | |
| ③ | 测试区 | **100** | 16（`padding: 8px 10px` 的上下）+ 30（输入框）+ 6 + 28（参数行）+ 20（就地错误槽位） |
| — | gap | 14 | |
| ④ | 结果区 | **210** | 12（`padding: 6px` 的上下）+ 40（徽标与指标行）+ 12 + 58（三层链）+ 12 + 76（响应区） |
| — | gap | 14 | |
| ⑤ | 记录条 | **88** | 8（`padding-top`）+ 18（表头）+ 4 + 58（行视口 = 2 × 28 + 2 余量） |
| | **内容区合计**（**本行已含 gap，勿再另加**） | **636** | `(122 + 60 + 100 + 210 + 88) + 56(gap) = 580 + 56 = 636` |
| — | 面板内边距 | 40 | 16 + 24 |
| | **总占用（border-box 预算）** | **676** | `636(已含gap) + 40(padding) = 676`；支持视口可用 border-box = `viewArea` **703.2** → **余量 27.2px** ✓ |
| | 第四行隐藏时 | **644** | 676 − 32（一行 26 + 行间距 6）→ **余量 59.2px** ✓ |

> **⚠️ 口径警告（防重复计入）**：上表「内容区合计 **636**」**已经包含**那 4 条 gap（`4 × 14 = 56`）。
> 计算总占用时**只能** `636 + 40(padding) = 676`；
> **不得**写成 `636 + 56(gap) + 40 = 732` —— 那是**把 gap 重复计入**（本项目已发生过一次同类误算）。
> **独立复核口径（与上表等价，供交叉验证）**：把 `height` 列**逐行**相加，含 4 行 gap 与 1 行 padding：
> `122 + 14 + 60 + 14 + 100 + 14 + 210 + 14 + 88 + 40 = 676` ✓

**预算 vs 实测（两者都对齐到 border-box，勿混用 box 模型）**：

| | border-box 高度 | A 档槽位 703.2 → 余量 | 1280×800（C 档）槽位 576 → 缺口 |
|---|---|---|---|
| **设计预算**（上表） | 676 | **+27.2px** ✓ | −100.0px |
| **实测·短响应**（t24 后） | **663.2** | **+40.0px** ✓ | **−87.2px** |
| **实测·长响应**（156 字符） | **685.2** | **+18.0px** ✓ ← **真实最坏余量** | **−109.2px** |

> 实测值来自真实宿主注入（`122 + 60 + 107.6 + 189.6 + 88 + 56 + 40 = 663.2`）。
> **真实最坏余量 = +18.0px**（长响应 @ 用户真实视口 2048×927），**不是 40px**——
> 档位阈值（§1.3「保证档位」）即以 **685.2px（长响应）** 为需求侧反解得出，故取 18px 这个更严的数。
> 预算 676 与实测 663.2 的差来自各块实际高度与预算的偏差（如测试区实测 107.6 vs 预算 100、
> 结果区实测 189.6 vs 预算 210），**属分块重分配范围，不影响总约束**。

**两个区块的内部拆分**（与 §3.4 / §3.10 / §3.11 逐项对应）：

- ③ 测试区：`16 + 30 + 6 + 28 + 20 = 100`
  （上下内边距 / 输入框 / 行间距 / 参数与按钮行 / 就地错误槽位常驻 20px）
- ④ 结果区：`12 + 40 + 12 + 58 + 12 + 76 = 210`
  —— 三层链 58 = `6 + 16（层头）+ 2 + 28（detail 两行 × 14）+ 6`；
  响应区 76 = `24（标题行）+ 4 + 48（内容块 max-height）`

**公差与硬约束**：上表各区块高度是**设计预算**，实现时允许单块 ±4px 的偏差；
**在 A 档（`VH ≥ 910`）内，面板 border-box 高度 ≤ 槽位 `slot(VH)` 是硬约束**，
由 `V-L2` / `V-L3` 直接断言（它们断言的是聚合值，不是分块值）。若某块超标，优先从 ④ 的响应区与 ⑤ 的行视口（58）里回收。

**★ 一个「0px 悬崖」组合已被证明不可达（不必为它预留空间）**：
reviewer 枚举全部 7 个分组后确认，**「四行选择器 + note 行 + 长响应 + 预览区警告行」**这一组合的余量恰好为 **0px**，
但它**与「第四行 ④ 渲染」互斥**：
- 触发 `ANTHROPIC_BASEURL_HAS_V1` / `OPENAI_BASEURL_MISSING_V1` 警告的分组，其 `groups[].routeCount = 1` → **第四行不渲染**（§7.4）；
- 而渲染第四行的两个分组（`xcmapi` 4 条、`aihub` 3 条）**都不触发任何警告**（它们自带 `/v1` 且是 openai 系，或 api 与 `/v1` 匹配）。

→ 该组合**命中数 = 0（不可达）**，实现**不需要**为它预留空间，**也不得**据此过度压缩其余区块。
本注记的目的是防止后人误以为存在 0px 悬崖而对内容做无谓削减（用户硬要求：功能一个都不能删）。

**溢出策略**：`[data-mh-root]` 设 `overflow-y: auto`；各区块 `flex: none`，
结果区的响应文本块设 `max-height` 并内部滚动。A 档内默认配置与默认选中下不触发面板滚动；
B / C 档下**面板整体滚动是允许的降级行为**（§1.3.1），**不得**改用 `overflow-y: hidden` 掩盖。

> **⚠️ 溢出位置与判据有效性（**依 `[data-mh-root]` 的写法而反转**，见 §7.1 `V-L3`）**：
> 真实宿主中 `viewArea` 是 `flex: 1 0 auto`（**可增长**），故**溢出发生在哪一层取决于 root 自身的写法**：
>
> | root 写法 | root 是否被撑高 | root 自身溢出 | 页面（`scrollBody`）滚动 | 滚动发生在 |
> | --- | --- | --- | --- | --- |
> | 现行 `height: 100%`（**t24 前**） | **是**（被撑到内容高） | **0** | **有**（1280×800 实测 87px） | **页面级**（非面板内） |
> | **`flex: 1 1 0`（t24 后，本规格要求）** | 否（= `slot`） | **有**（1280×800 实测 87px） | **0** | **面板内** ✅ 符合用户裁定 |
>
> ⇒ **两种写法各使一条判据恒真**：`height:100%` 下「root 不溢出」是空断言；`flex:1 1 0` 下「`scrollBody` 不滚动」是空断言。
> ⇒ **故 A 档必须两条都断言**（`root` 不溢出 **且** `scrollBody` 不滚动），**B / C 档断言「面板内滚动」的判据是「root 溢出 **且** `scrollBody` 不滚动」**——
> 后者正是「滚动发生在面板内而非页面」的判别式，也是用户裁定（「小屏时允许**面板内**滚动」）的语义要求。
> **不得**只依赖其中一条（否则换写法即失效，属空断言）。
>
> **t24 前的实测基线**（仅作对照，**t24 落地后失效**）：`root 749/749`（溢出 0）而 `scrollBody 851/897`（溢出 46px）。

#### 1.3.1 小屏降级：B / C 档允许面板自身滚动（已登记）

**用户裁定（2026-09-18）**：「以我的真实屏幕为准，小屏时允许面板内滚动」。
因此本规格采取**不压缩内容、不删功能**的方向——小屏缺口用**面板自身滚动**吸收。
档位定义见 §1.3「保证档位」：**A 档（`VH ≥ 910`）仍是一屏看全的硬约束**，只有 B / C 档降级。

| 视口 | `slot` | 档位 | 面板 border-box 需求 | 判定 |
|---|---|---|---|---|
| **2048×927（用户真实视口）** | 703.2 | **A** | 663.2（短） | ✅ **硬约束满足**：无滚动条、七个必需元素全可见（余量 40px） |
| 2048×927（长响应 156 字符） | 703.2 | **A** | 685.2 | ✅ 余量 **18px**（真实最坏），面板仍不滚 |
| 1922×986（旁证） | 762.4 | **A** | 663.2 | ✅ 满足（余量 99.2px） |
| 1440×900 | 676.0 | **B** | 685.2（长响应） | ⚠️ **已知降级**：缺口 **9.2px**（短响应无滚动） |
| 1366×768（常见笔记本） | 544.0 | **C** | 663.2（短响应） | ⚠️ **已知降级**：缺口 **119.2px** → 面板自身滚动 |
| 1280×800（设计目标视口） | 576.0 | **C** | 663.2（短响应） | ⚠️ **已知降级**：缺口 **87.2px** → 面板自身滚动 |
| 1280×800（长响应） | 576.0 | **C** | 685.2 | ⚠️ **已知降级**：缺口 **109.2px** → 面板自身滚动 |

> 注：`slot` 既是「面板槽位高度」，也是**面板 border-box 的可用上限**（面板填满槽位）。
> 内容盒（`slot − 40`）只用于**解释 padding 去向**，**不作为断言上限**——否则会少算 40px 而假 fail。
> **换算陷阱**：`1366×768` 的 `slot = 544`，**不是 504**（504 是内容盒 `544 − 40`）。

**降级行为的明确定义（三条，缺一不可）**：

1. **允许**面板出现纵向滚动条——即**滚动发生在面板内**（`root` 溢出、`scrollBody` 不滚动，见 §1.3 末注的双形态对照表），用户滚动后可见全部内容；
2. **禁止** `overflow-y: hidden`（或任何等价裁剪）——它会**永久藏掉**长响应与记录条，
   与「功能一个都不能删」「信息密度高、一屏看全」两条硬要求直接冲突；
3. **不得**为迁就小屏而**删除/合并/折叠任何功能或信息项**（用户硬要求）。
   内容需求只能通过**提高信息密度**（如 t24 把响应块 48→36）来回收，不能靠砍功能。

**判据（`V-L2` / `V-L3` 按档位分流，见 §7.1）**：

- **A 档内**：**两条都断言**（缺一即空断言，见 §1.3 末注）——① `root` 不溢出（`root.scrollHeight <= root.clientHeight + 1`）；
  ② **`scrollBody` 不滚动**（`scrollBody.scrollHeight <= scrollBody.clientHeight + 1`，即页面不出现滚动条）；
  **且**七个必需元素全部可见——**硬约束**。
- **B / C 档**：断言「**滚动发生在面板内，而非页面级**」——即 `root.scrollHeight > root.clientHeight`（root 溢出）
  **且** `scrollBody.scrollHeight <= scrollBody.clientHeight + 1`（页面不滚）。
  这同时满足用户裁定（「小屏时允许**面板内**滚动」）——若页面级滚动发生，说明 root 未构成上界（t24 前的失效模式），**判 fail**。
  并**显式记录**该视口下的**档位、`slot`、缺口像素**（如 1280×800 = C 档 / 576 / 缺 87.2）
  ——**不得**把它记为无条件 pass 而不说明降级。
- **通用**：验收须**记录取证时的视口尺寸**；档位由 `slot(VH) = VH − 224` 现算，不得引用常数。

### 1.4 断点（容器宽度，用 `ResizeObserver` 或 CSS 容器查询，以 `[data-mh-root]` 宽度为准）

| 容器宽度 | 变化 |
|---|---|
| ≥ 720px | 三层链横排；指标行 4 项一行 |
| 480–719px | 三层链**竖排**（每层 58px，共 174px + 2 × 8 间距，面板整体滚动）；指标行 2×2 换行；选择条标签槽 64 → 56px |
| < 480px | 参数行换行；主按钮占满整行 |

---

## 2. 视觉规范

### 2.1 主题适配机制（这是本规格的地基）

**先固定事实（已读 DSH checkout 源码 + 本机 GUI 实测双重确认）**：深色主题由
`@deepseek-ai/dsh-client-ui-theme` 在 `document.body` 上 `toggleAttribute('data-ds-dark-theme')`
切换，同时设置 `documentElement.style.colorScheme`。因此**唯一正确的做法是使用语义 token
`var(--dsw-alias-<name>, <主题无关 fallback>)`**，颜色随主题自动翻转。
本插件只用 CSS `var()`，**不调用 theme 服务的 `register()`**
（该 API 对裸字符串 token 覆盖会抛 `TypeError`，必须传 `{light, dark}` 成对值——我们绕开它）。

**三条规则，缺一不可：**

1. **颜色一律走 DSH 语义 token**，写作 `var(--dsw-alias-<name>, <主题无关 fallback>)`。
   绝不出现「浅色主题专用值」或「深色主题专用值」的硬编码分支。
2. **fallback 必须主题无关**：文本色 fallback 用 `currentColor`，底色 fallback 用 `transparent`，
   线条 fallback 用 `rgba(128,128,128,α)`。
   *反例（禁止）*：`var(--dsw-alias-label-primary, #e6e6ee)` —— token 一旦缺失，白底上就是 1.24:1 的隐形文字。
3. **状态色当「文字色」时必须用 `color-mix()` 混向 `label-primary`**；混向固定色会失效。
   这是本规格最关键的一条技术决定：

   ```css
   /* 一个声明，两套主题自动正确 */
   color: color-mix(in srgb, var(--dsw-alias-state-success-primary) 56%, var(--dsw-alias-label-primary));
   ```

   原理：`label-primary` 在浅色主题近乎黑（`#0f1115`）、在深色主题近乎白（`#f9fafb`）。
   同一个 56% 混合，浅色下把绿色压暗到 `#1a763e`（5.68:1），深色下把绿色提亮到 `#81dca3`（9.52:1）。
   **不需要媒体查询，不需要 `[data-ds-dark-theme]` 分支。**

   可行性已核实（本机 GUI 实测）：`CSS.supports('color','color-mix(in srgb, red 50%, blue)') === true`；
   DSH 自身 CSS 也在用 `color-mix`（`_tag_*` 的
   `color-mix(in srgb,var(--dsw-alias-state-success-primary) 10%,transparent)`），平台必然支持。
   兜底路径同样已实测：把 fallback 写进 `color-mix` 的**两个**参数位置即可安全降级——

   ```css
   color: color-mix(in srgb,
     var(--dsw-alias-state-success-primary, currentColor) 56%,
     var(--dsw-alias-label-primary, currentColor));
   ```

   实测：token 存在时正常解析为 `color(srgb …)`；token 全部缺失时退化为近似 `label-primary`
   （浅色 **18.90:1** / 深色 **15.03:1**）——只损失色彩信息，**绝不产生隐形文字**。

> **顺带修正一个平台既有问题**：DSH 自己的 `_tag_` 组件用
> `background: color-mix(state T%, transparent)` + `color: var(--dsw-alias-state-*-primary)`（纯状态色），
> T 分别为 success 10% / warning 12% / danger 10% / info 10%。实测该组合在**浅色主题下四个状态全部不达标**
> （对 `#ffffff`：success **2.09:1**、warn **1.96:1**、error **3.82:1**、business **3.75:1**；
> 对 `#f5f6f7` 更低至 1.94 / 1.82 / 3.54 / 3.48）——这正是 guard 评审记录的 P36 问题。
> 深色主题下大部分可用，但 error 叠 `bg-layer-2` 时仍只有 **4.23:1**、business 叠 `bg-layer-3` 时 **3.90:1**。
> 本规格的徽标沿用「淡底 + 状态色文字」的形态，但**文字色一律走 §2.1 规则 3 的混合值**，
> 实测双主题最低 **4.72:1**（浅 business）/ **5.06:1**（深 error），把平台的坑补上。

#### 2.1.1 状态色的三条使用边界（实测数据决定，不是审美偏好）

| 用途 | 可否直接用 `state-*-primary` 纯色 | 依据（实测对比度） |
|---|---|---|
| **文字色**（11–16px） | ❌ **禁止** | 浅色下 success **2.28:1**、warn **2.15:1**、business **4.23:1** 均 < 4.5:1；error 4.50:1 也只是勉强。**必须走 §2.1 规则 3 的混合值** |
| **非文本色块**（3px 色条 / 状态点 / 图标 / 淡底） | ✅ 可以，但**推荐也用混合值** | 非文本门槛 3:1。浅色下 success 2.28 / warn 2.15 连 3:1 都不到；error 4.50 / business 4.23 达标。深色下四者 4.77–7.31 全部达标 |
| **淡底填充** | ⚠️ 用 `color-mix(state T%, var(--dsw-alias-bg-layer-1))`，**不要用 `state-*-tertiary`** | 见下 |

**关于 `state-*-tertiary` 系列：实测不统一，不可当作通用淡底色。**
`state-success-tertiary`（浅 `#e6faed` / 深 `#233c2c`）、`state-warn-tertiary`（浅 `#fef5e7` / 深 `#27241f`）、
`state-business-tertiary`（浅 `#e4edfd` / 深 `#34415b`）都是不透明色、可用；
但 **`state-error-tertiary` 实测解析为 `rgba(0,0,0,0)`（完全透明）**，
用它做 error 徽标底会得到「无底色」，双主题都不成立。
因此本规格统一用**自己算的 14% 淡底**（§3.8 表），四个状态一致、可预测、不依赖该系列的内部不一致。

> 三种状态色用法在本规格里的分工，一句话记住：
> **当文字 → 必须 `color-mix(state P%, label-primary)`；当色块 → 可用纯色但混合值更稳；当底色 → 自己算 14% 淡底。**

### 2.2 颜色 token 全表（实测值，两套主题都给全）

下表「浅色」与「深色」两列是**同一个 `var(--dsw-alias-*)` 在两套主题下的解析值**——
实现时只写 token 名，不写这两列的字面量。

| 用途 | token 名 | 浅色解析值 | 深色解析值 |
|---|---|---|---|
| 主文本 | `--dsw-alias-label-primary` | `#0f1115` | `#f9fafb` |
| 次文本 | `--dsw-alias-label-secondary` | `#61666b` | `#cfd3d6` |
| 弱文本（**仅非文本字形**） | `--dsw-alias-label-tertiary` | `#81858c` | `#adb2b8` |
| 禁用文本（**禁止用于文本**） | `--dsw-alias-label-caption` | `#adb2b8` | `#81858c` |
| 面板底 | `--dsw-alias-bg-base` | `#ffffff` | `#151517` |
| 卡片底 | `--dsw-alias-bg-layer-1` | `#ffffff` | `#232324` |
| 内凹底（预览区） | `--dsw-alias-bg-module-platform` | `#f5f6f7` | `#353638` |
| 代码 / 原始响应底 | `--dsw-alias-markdown-code-block` | `#f9fafb` | `#1b1b1c` |
| 分区线 | `--dsw-alias-border-l2` | `#0000001a` | `#ffffff1f` |
| 卡片描边 | `--dsw-alias-border-l3` | `#0000001f` | `#ffffff29` |
| 悬浮底 | `--dsw-alias-interactive-bg-hover` | `#2631480f` | `#ffffff14` |
| 按下底 | `--dsw-alias-interactive-bg-active` | `#2631481a` | `#ffffff24` |
| 主按钮底 | `--dsw-alias-button-primary-fill` | `#0f1115` | `#f9fafb` |
| 主按钮字 | `--dsw-alias-label-primary-foreground` | `#ffffff` | `#0f1115` |
| 选中/强调/焦点 | `--dsw-alias-state-business-primary` | `#4176e6` | `#679efe` |
| 成功 | `--dsw-alias-state-success-primary` | `#22c55e` | `#22c55e` |
| 警告 | `--dsw-alias-state-warn-primary` | `#f59e0b` | `#f59e0b` |
| 失败 | `--dsw-alias-state-error-primary` | `#ec1313` | `#f25a5a` |
| 骨架屏 | `--dsw-alias-bg-skeleton` | `#0000000a` | `#ffffff14` |
| 滚动条 | `--dsw-alias-scrollbar-bg-l2` / `--dsw-alias-scrollbar-hover-l2` | `#e5e5e5` / `#d4d4d4` | `#545557` / `#65676b` |
| 浮层阴影 | **`--dsw-elevation-panel`**（**无 `alias-` 前缀**，见下注） | `0 0 0 .5px #00000029, 0 3px 8px 0 #00000008, 0 0 16px 0 #00000005` | `0 0 0 .5px #fff3, …` |
| 等宽字体族 | `--ds-font-family-code` | SF Mono / JetBrains Mono / Consolas / … | 同左 |

**关于 token 家族边界（易错，已实测）**：本机 `document.body` 上共有 **79 个 `--dsw-alias-*`**
自定义属性；但 `--dsw-font-*`、`--dsw-elevation-*`、`--ds-font-family-code`、`--dsh-scrollbar-*`
**都不属于** `alias-` 家族，不能加前缀。实测反例：

| 写法 | 实测结果 |
|---|---|
| `var(--dsw-alias-elevation-panel, FALLBACK)` | 解析为空 → **永远走 fallback**（丢失真实 3 层阴影）❌ |
| `var(--dsw-elevation-panel, FALLBACK)` | 正确解析为 `0 0 0 .5px rgba(0,0,0,.16), 0 3px 8px 0 rgba(0,0,0,.03), 0 0 16px 0 rgba(0,0,0,.02)` ✅ |
| `var(--dsw-alias-bg-overlay)` | `#e9ecf2`（浅）/ `#61666b`（深）✅ 存在 |
| `var(--dsw-alias-scrollbar-bg-l1)` / `-l2` | `#e5e5e5`（浅）/ `#3c3c3d` / `#545557`（深）✅ 存在（scrollbar 系列**确实**在 alias 家族内，4 个：`-bg-l1/-l2`、`-hover-l1/-l2`） |
| `var(--dsw-alias-interactive-bg-hover-danger)` | `#ec13130d`（浅）/ `#f25a5a26`（深）✅ 存在 |

**禁止字面量清单**（源码扫描判据，见 §7.4 `V-T3`）：
`#14141a` `#2a2a33` `#23232b` `#e6e6ee` `#8a8a99` `#ff4f5e` `#eab308`
以及任何形如 `prefers-color-scheme` 或 `[data-ds-dark-theme]` 的主题分支。
另**禁止**出现 `--dsw-alias-elevation` 与 `--dsw-alias-font-` 这类**错前缀**写法
（这两族确实不在 alias 家族内；而 `--dsw-alias-scrollbar-*` **在**家族内，加了前缀是对的）。

#### 2.2.1 可直接粘贴的 token 常量块（建议 dev-client 原样采用）

把所有颜色收敛成**一个对象**，全面板只从这里取色——这样「无硬编码」「无错前缀」两条判据天然成立，
也避免 60 多处 `var()` 里各写各的 fallback：

```js
// lib/client.js —— 颜色常量（唯一取色入口）
// 形式：var(--dsw-<真实token名>, <主题无关 fallback>)
// 注意三处「无 alias 前缀」：elevation / font / ds-font-family-code
const dsw  = (name, fb) => `var(--dsw-alias-${name}, ${fb})`;
const raw  = (name, fb) => `var(--dsw-${name}, ${fb})`;      // 无 alias 前缀的 token

const C = {
  // 文本（fallback 一律 currentColor：天然跟随主题）
  text:        dsw('label-primary', 'currentColor'),
  textSoft:    dsw('label-secondary', 'currentColor'),
  textFaint:   dsw('label-tertiary', 'currentColor'),   // 仅非文本字形，禁止用于文字
  onPrimary:   dsw('label-primary-foreground', 'currentColor'),
  // 表面
  panel:       dsw('bg-base', 'transparent'),
  card:        dsw('bg-layer-1', 'transparent'),
  sunken:      dsw('bg-module-platform', 'transparent'),
  code:        dsw('markdown-code-block', 'transparent'),
  skeleton:    dsw('bg-skeleton', 'transparent'),
  // 线条
  line:        dsw('border-l2', 'rgba(128,128,128,.35)'),
  lineStrong:  dsw('border-l3', 'rgba(128,128,128,.45)'),
  // 交互
  hover:       dsw('interactive-bg-hover', 'rgba(128,128,128,.12)'),
  active:      dsw('interactive-bg-active', 'rgba(128,128,128,.20)'),
  // 主按钮
  btnFill:     dsw('button-primary-fill', 'currentColor'),
  btnHover:    dsw('button-primary-hover', 'currentColor'),
  // 阴影（无 alias 前缀！）
  shadow:      raw('elevation-panel', '0 0 0 .5px rgba(128,128,128,.25)')
};

// 状态色：唯一一套 P 值，两主题通用（§2.3）
const P = { success: 56, warn: 54, error: 78, business: 82 };
/** 状态色当「文字色」——必须混合，否则浅色主题下 success/warn 只有 2.2:1 */
const stateText = (k) =>
  `color-mix(in srgb, ${dsw(`state-${k}-primary`, 'currentColor')} ${P[k]}%, ${dsw('label-primary', 'currentColor')})`;
/** 状态色当「淡底」——把目标底写进第二个参数，两主题自动正确 */
const stateTint = (k, pct = 14) =>
  `color-mix(in srgb, ${dsw(`state-${k}-primary`, 'currentColor')} ${pct}%, ${dsw('bg-layer-1', 'transparent')})`;
/** 状态色当「色块」——纯色可用，但为统一也走混合值更稳 */
const stateBlock = (k) => stateText(k);
// 焦点环 / 选中环是唯一用纯状态色的地方（实测两主题 ≥ 3.91:1，满足非文本 3:1）
const RING = dsw('state-business-primary', 'currentColor');
```

**字体同理**（`--dsw-font-*` 无 alias 前缀；**用子 token 长写属性，不用 `font` 简写**，理由见 §2.4.1）：

```js
// 每个字号档取 3 个子 token 拼成长写属性三元组；fallback 为计算值字面量
const F = {
  metric: ['var(--dsw-font-base-strong-16-font-size,   16px)',
           'var(--dsw-font-base-strong-16-font-weight, 500)',
           'var(--dsw-font-base-strong-16-line-height, 24px)'],   // 主数值
  title:  ['var(--dsw-font-xs-strong-13-font-size,   13px)',
           'var(--dsw-font-xs-strong-13-font-weight, 500)',
           'var(--dsw-font-xs-strong-13-line-height, 20px)'],     // 区块标题 / 徽标
  btn:    ['var(--dsw-font-xxs-strong-12-font-size,   12px)',
           'var(--dsw-font-xxs-strong-12-font-weight, 500)',
           'var(--dsw-font-xxs-strong-12-line-height, 18px)'],   // 按钮 / 层头
  body:   ['var(--dsw-font-s-14-font-size,   14px)',
           'var(--dsw-font-s-14-font-weight, 400)',
           'var(--dsw-font-s-14-line-height, 22px)'],             // 正文 / 输入框
  small:  ['var(--dsw-font-xxs-12-font-size,   12px)',
           'var(--dsw-font-xxs-12-font-weight, 400)',
           'var(--dsw-font-xxs-12-line-height, 18px)'],           // 三层链 detail
  tiny:   ['var(--dsw-font-xxxs-11-font-size,   11px)',
           'var(--dsw-font-xxxs-11-font-weight, 400)',
           'var(--dsw-font-xxxs-11-line-height, 14px)']           // 行标签 / 单位
};

/** 展开成 React 内联样式（长写属性，顺序无关，可安全叠加 tabular-nums） */
const font = (tier) => ({
  fontSize:   F[tier][0],
  fontWeight: F[tier][1],
  lineHeight: F[tier][2]
});

// 等宽：字体族只能作 font-family 值（该 token 不含字号/行高，作 font 简写会被整条丢弃）
const MONO = {
  fontFamily: 'var(--ds-font-family-code, Consolas, "Liberation Mono", Menlo, monospace)',
  fontSize: '11px',
  lineHeight: '19px'
};

/** 用法：{...font('metric'), fontVariantNumeric: 'tabular-nums'} —— 顺序不再敏感 */
```

> **⚠ `--ds-font-family-code` 的用法陷阱（已实测）**：它只提供**字体族**，不含字号/行高/字重。
> 因此 `font: var(--ds-font-family-code, Consolas, monospace)` 是**非法简写、会被整条丢弃**
> （实测字号回落 16px、字体族回落系统默认，等宽失效）。
> 正确写法：`fontFamily: MONO.fontFamily` + 单独指定字号行高（见上 `MONO`）。
> 实测 `font: 11px/19px var(--ds-font-family-code, Consolas, monospace)` 也能解析正确，
> 但本规格统一走长写属性，避免简写的重置副作用。

> **两条使用纪律**（对应 §7.4 的 `V-T6`）：
> ① 子 token **只能**赋给对应的长写属性（`-font-size` → `font-size:`，依此类推）；
> ② 简写 token（`--dsw-font-s-14` 本身）**禁止**出现——喂 `font-size:` 会被丢弃，喂 `font:` 会重置 `font-variant-numeric`。

### 2.3 状态色全表（P 值为**唯一一套**，两主题通用）

> **前置**：状态色的三条使用边界（当文字 / 当色块 / 当底色）见 §2.1.1，其中最重要的一条是
> **状态色当文字色时必须混合**——纯色在浅色主题下最低只有 2.15:1。

状态色的**可读化文本色**由 `color-mix(state P%, label-primary)` 产出，P 值经双主题全域搜索确定：

| 语义 | P | 浅色解析 | 浅色最差对比 | 深色解析 | 深色最差对比 | 用途 |
|---|---|---|---|---|---|---|
| 成功 Healthy | **56%** | `#1a763e` | **5.04:1** | `#81dca3` | **7.33:1** | 徽标文字、3px 色条、状态点、链头字形 |
| 警告 Slow | **54%** | `#8b5d10` | **5.13:1** | `#f7c879` | **7.78:1** | 同上 |
| 失败 Failed | **78%** | `#bb1313` | **5.17:1** | `#f47d7d` | **4.65:1** | 同上 |
| 强调 / 选中 / 焦点 | **82%** | `#3864c0` | **4.72:1** | `#81affd` | **5.45:1** | 同上（但焦点环与选中环用**纯** `state-business-primary`，理由见下表） |
| 中性 未测试 | — | `label-secondary` | 5.80:1 | `label-secondary` | 10.42:1 | 徽标文字、色条 |

「最差对比」= 该颜色落在它可能出现的**全部**表面上取最小值，表面集合 =
`bg-base` / `bg-layer-1` / `bg-layer-2` / `bg-layer-3` / `bg-module-platform` / `markdown-code-block`
/ 自身 14% 淡底叠 `bg-layer-1` / 自身 10% 淡底叠代码底。

**纯状态色（未经混合）的使用边界**——实测数据决定，不是审美偏好：

| 纯色 | 浅色对 `bg-layer-1` | 深色对 `bg-layer-1` | 允许用途 |
|---|---|---|---|
| `success #22c55e` | **2.28:1** ❌ | 6.89:1 ✅ | **仅深色**可作非文本色块；浅色下禁止 |
| `warn #f59e0b` | **2.15:1** ❌ | 7.31:1 ✅ | 同上 |
| `error #ec1313 / #f25a5a` | 4.50:1 ✅ | 4.77:1 ✅ | 两主题可作非文本色块 |
| `business #4176e6 / #679efe` | 4.23:1 ✅ | 5.91:1 ✅ | 两主题可作焦点环、选中环 |

**结论：为了不写主题分支，所有色块（3px 色条、状态点、链头字形）一律用 §2.3 上表的混合值，不用纯色。**
唯一例外是**焦点环与选中环**用纯 `state-business-primary`——因为实测它在两主题对全部表面都 ≥ 3.91:1，
满足非文本 3:1，且「焦点环必须是浏览器/平台可识别的强色」比「统一用混合值」更重要。

### 2.4 字号与字重（7 档，全部走 DSH 子 token 长写属性）

**采用 dev-client 提议的子 token 长写属性写法**（已复核并采纳）。每个 `--dsw-font-*` 简写 token
都配有 5 个可单独使用的**子 token**：`-font-size` / `-font-weight` / `-line-height` / `-font-family` / `-font-style`。

| 用途 | 字号档 | 子 token 前缀 | 计算值 |
|---|---|---|---|
| 主数值（耗时 / HTTP / tokens / TTFT） | `base-strong-16` | `--dsw-font-base-strong-16-*` | 500 16px/24px |
| 区块标题 / 选中芯片 / 记录行主字段 | `xs-strong-13` | `--dsw-font-xs-strong-13-*` | 500 13px/20px |
| 主操作按钮 / 层头标签 | `xxs-strong-12` | `--dsw-font-xxs-strong-12-*` | 500 12px/18px |
| 结果主文本 / 响应内容 / 输入框 | `s-14`（强调处 `s-strong-14`） | `--dsw-font-s-14-*` | 400 / 500 14px/22px |
| 正文 / 三层链 detail / 记录行次字段 | `xxs-12` | `--dsw-font-xxs-12-*` | 400 12px/18px |
| 行标签 / 单位 / 时间戳 / 字数 / 表头 | `xxxs-11` | `--dsw-font-xxxs-11-*` | 400 11px/14px |
| 代码 / URL / 原始响应 | 等宽 11px/19px | 见下（字体族 token 只能作 `font-family` 值） | 等宽 11px/19px |

**标准写法**（三行长写，全部带主题无关 fallback）：

```css
[data-mh-metric-value] {
  font-size:   var(--dsw-font-base-strong-16-font-size,   16px);
  font-weight: var(--dsw-font-base-strong-16-font-weight, 500);
  line-height: var(--dsw-font-base-strong-16-line-height, 24px);
  font-variant-numeric: tabular-nums;
}
```

#### 2.4.1 为什么用长写属性而不是 `font` 简写（四条实测理由）

| # | 理由 | 实测证据 |
|---|---|---|
| 1 | **简写会重置 `font-variant-numeric`**，长写不会 | `font: …; font-variant-numeric: tabular-nums` → `tabular-nums` 生效；`font-variant-numeric: …; font: …` → 被重置为 `normal`。改用长写后**声明顺序不再敏感**：实测 `font-variant-numeric` 写在长写**之前或之后**都保持 `tabular-nums` |
| 2 | **简写会重置其它字体长写属性**（`font-feature-settings` 等），长写不会 | 同上机制（`font` 是重置型简写） |
| 3 | **可只覆盖其中一项**（如只改字重做选中态，不动字号） | 简写必须写全四项，长写可单独覆盖 |
| 4 | **与 DSH 自身 CSS 的写法一致** | 平台 CSS 通篇用 `font-size` / `line-height` 长写，未使用 `var(--dsw-font-*)` 简写喂 `font:` |

> **关于「跟随用户字号缩放」——这条理由不成立，不要写进注释或提交信息**（我实测过）：
> DSH 的 UI 字号设置（12–17px，写入 `--dsh-content-font-size`）**只影响 markdown 内容**，
> 源码注释原文即 `fontSize.description: "仅影响会话内容的字号"`。
> 全库 142 条 `--dsw-font-*` 声明中，仅 **21 条**（全部是 `--dsw-font-markdown-*` 系列）引用 `--dsh-content-font-delta`；
> **本规格用到的 7 个档位全部是固定字面量**（实测把 `--dsh-content-font-size` 改成 `18px` 后，
> `--dsw-font-s-14-font-size` 仍为 `14px` 不变）。
> 所以选长写属性的理由是上面 4 条（正确性与可维护性），**不是**「跟随用户缩放」。
> 若将来平台把缩放推广到全部字号档，长写属性会自动跟随（这正是它的前瞻优势），但**现在不会**。

#### 2.4.2 禁止写法（源码扫描判据见 §7.4 `V-T6`）

| 写法 | 后果 |
|---|---|
| `font-size: var(--dsw-font-s-14, …)` | ❌ 简写喂给 `font-size` 是**非法值，整条声明被丢弃**（实测字号回落继承值） |
| `font: var(--dsw-font-s-14, …)` | ⚠️ 语法合法且能生效，但会重置 `font-variant-numeric`，且无法单独覆盖字重 → 本规格**不采用** |
| `font: var(--ds-font-family-code, Consolas, monospace)` | ❌ 该 token 只含字体族，作简写会被**整条丢弃**（实测字号回落 16px、等宽失效） |
| `font-family: var(--ds-font-family-code, Consolas, monospace)` | ✅ 正确（只设字体族） |
| `font: 11px/19px var(--ds-font-family-code, Consolas, monospace)` | ✅ 正确（自拼完整简写） |

**等宽文本的标准写法**（字体族用长写，字号行高自定）：

```css
[data-mh-code] {
  font-family: var(--ds-font-family-code, Consolas, "Liberation Mono", Menlo, monospace);
  font-size: 11px;
  line-height: 19px;
  font-variant-numeric: tabular-nums;
}
```

### 2.5 对比度全表（实测，供实现者与验证者直接对照）

`11px` 属正文，门槛 **4.5:1**（WCAG 1.4.3 的大字号豁免从 24px / 18.66px 粗体起）。

**（a）文本色 × 表面**

| 颜色 | 浅色 对 base / platform / code | 深色 对 base / layer1 / platform / code |
|---|---|---|
| `label-primary` | 18.90 / 17.46 / 18.08 | 17.45 / 15.03 / 11.57 / 16.47 |
| `label-secondary` | **5.80 / 5.36 / 5.55** | **12.11 / 10.42 / 8.03 / 11.43** |
| `label-tertiary` | 3.71 / **3.42** / 3.55 ❌ | 8.54 / 7.36 / 5.67 / 8.06 |
| `label-caption` | 2.13 / **1.97** / 2.04 ❌ | 4.92 / 4.24 / 3.26 / 4.64 ❌ |

→ **11–12px 文本只允许 `label-primary` 与 `label-secondary`。**

**（b）状态混合色 × 表面（取最差）**

| 状态 | 浅色最差 | 深色最差 |
|---|---|---|
| success P=56 | 5.04（自身 14% 淡底） | 7.33（`bg-layer-3`） |
| warn P=54 | 5.13（自身 14% 淡底） | 7.78（`bg-layer-3`） |
| error P=78 | 5.17（自身 14% 淡底） | 4.65（`bg-layer-3`） |
| business P=82 | 4.72（自身 14% 淡底） | 5.45（`bg-layer-3`） |

**（c）组件级**

| 组合 | 浅色 | 深色 |
|---|---|---|
| 主按钮 `button-primary-fill` + `label-primary-foreground` | **18.90:1** | **18.08:1** |
| 焦点环 `state-business-primary` 对 base / layer1 / platform | 4.23 / 4.23 / 3.91 | 6.86 / 5.91 / 4.55 |
| 选中芯片环（纯 business）对淡底 / 对 layer1 | 3.57 / 4.23 | 4.69 / 5.91 |
| 未选中芯片文字 `label-secondary` 对 layer1 | 5.80 | 10.42 |
| 悬浮底上的 `label-secondary` | 5.22 | 8.23 |
| 禁用文字（`label-secondary` @ 0.45 叠 layer1） | 1.94（豁免，仅需 ≥1.6 可感知） | 3.26 |

**（d）边框不达标，因此不得作为唯一识别手段**

实测全部边框 token 对 `bg-layer-1` 的对比度：浅色 L1 `1.09` / L2 `1.26` / L3 `1.32` / L4 `1.45`；
深色 L1 `1.19` / L2 `1.46` / L3 `1.68` / L4 `1.92`。**没有一个达到非文本 3:1。**
因此：

- 芯片的「未选中 vs 选中」**不得只靠边框颜色差**——选中态必须叠加淡底 + 环 + 文字变色 + 字重变 500（四重冗余，见 §3.1）；
- 输入框、卡片边框只做装饰，其可识别性由**标签文字**与**内凹底色差**承担。

### 2.6 间距 / 圆角 / 阴影 / 描边

**间距（4px 基准）**：`4 · 6 · 8 · 12 · 14 · 16 · 20 · 24`
- 芯片间 6，行间 6，区块间 14（根 `gap`），区块内 8–12，面板内边距 16/20/24。

**圆角（4 档）**：

| 档 | 值 | 用途 |
|---|---|---|
| `xs` | 4px | 行内代码、链头序号徽章 |
| `sm` | 8px | 原始响应块、请求详情块、三层链每层卡片 |
| `md` | 10px | 输入框、结果卡、预览区（与 DSH 的输入框 10px 对齐） |
| `pill` | 999px | 芯片、状态徽标、分段控件、主按钮 |
| `dot` | 50% | 配置状态点（6px）、记录行状态点（6px） |

**阴影（全屏只用一处）**：结果卡片 `box-shadow: var(--dsw-elevation-panel, 0 0 0 .5px rgba(128,128,128,.25))`。
预览区与记录条用**内凹底色**（`bg-module-platform`）而非阴影——同一屏不出现两种「浮起」语言。

> **⚠ 易错点（已实测）**：elevation **不属于** `--dsw-alias-*` 家族。
> `getPropertyValue('--dsw-alias-elevation-panel')` 返回**空字符串**；
> 全部 elevation token 只有 5 个且**都无 alias 前缀**：
> `--dsw-elevation-panel` / `-prominent` / `-soft` / `-stroke` / `-stroke-color`。
> 写成 `var(--dsw-alias-elevation-panel, …)` 会**永远走 fallback**（丢掉真实的 3 层阴影，只剩 1 层描边）。
> 正确解析值：浅色 `0 0 0 .5px #00000029, 0 3px 8px 0 #00000008, 0 0 16px 0 #00000005`；
> 深色 `0 0 0 .5px #fff3, …`（描边层自动翻白）。判据见 §7.4 `V-T2`。

**描边**：卡片 `1px solid var(--dsw-alias-border-l3)`；分区线 `1px solid var(--dsw-alias-border-l2)`；
芯片未选中 `1px solid var(--dsw-alias-border-l2)`；选中芯片 `box-shadow: inset 0 0 0 1.5px var(--dsw-alias-state-business-primary)`
（用 inset 阴影而非 border，避免选中瞬间 1px→1.5px 造成 0.5px 的布局位移）。

---

## 3. 组件设计

### 3.1 选择器芯片 `[data-mh-chip]`（四行共用同一组件）

```
未选中                        悬停                     选中                      聚焦（键盘）
┌──────────────┐        ┌──────────────┐       ╔═══════════════╗        ┌──────────────┐
│ glm-5.3-flash│        │ glm-5.3-flash│       ║ ✓ gpt-5.6-sol²║        │ glm-5.3-flash│
└──────────────┘        └──────────────┘       ╚═══════════════╝        └──┈┈┈┈┈┈┈┈┈┈┈┈──┘
透明底 / border-l2   →   interactive-bg-hover   business 14% 淡底 + 1.5px   2px business 环
label-secondary          label-secondary         inset 环 / label-primary      outline-offset 2px
字重 400                  字重 400                字重 500 + ✓ 字形

行 4 的角标换成配置状态点：  ║ ✓ api-tcvps-006 ●║   （● 已配置 / ○ 未配置 / ◌ 未知）
```

| 态 | 规格 |
|---|---|
| **结构** | `<button type="button" role="radio" aria-checked data-mh-chip>`，内含 `[data-mh-chip-label]` + 可选 `[data-mh-chip-badge]` |
| **尺寸** | 高 **26px**（> WCAG 2.5.8 的 24×24 最小目标），水平内边距 10px，芯片间距 6px，`border-radius: 999px`，`white-space: nowrap` |
| **字号** | `--dsw-font-xxs-12`（400）；选中态 `font-weight: 500`（用 `font-weight` 覆盖，不改字号，避免宽度跳动） |
| **未选中** | `background: transparent`；`border: 1px solid var(--dsw-alias-border-l2)`；`color: var(--dsw-alias-label-secondary)` |
| **悬停** | `background: var(--dsw-alias-interactive-bg-hover)`（两主题 1.11:1 / 1.27:1 的柔和底差，配合光标与文字不变色） |
| **按下** | `background: var(--dsw-alias-interactive-bg-active)` |
| **选中** | `background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 14%, var(--dsw-alias-bg-layer-1))`（浅 `#e4ecfc` / 深 `#2d3443`）；`box-shadow: inset 0 0 0 1.5px var(--dsw-alias-state-business-primary)`；`color: var(--dsw-alias-label-primary)`；`font-weight: 500`；**并额外渲染一个 `✓` 字形**（`aria-hidden`，见 §6.6 非颜色编码） |
| **聚焦** | `outline: 2px solid var(--dsw-alias-state-business-primary); outline-offset: 2px`（浅 `#4176e6` 4.23:1 / 深 `#679efe` 5.91:1，均 ≥ 3:1） |
| **禁用** | `opacity: .45`；`cursor: not-allowed`；`aria-disabled="true"`；不响应点击与方向键；`title` 说明禁用原因 |
| **角标** | `[data-mh-chip-badge]`：`--dsw-font-xxxs-11`、`color: var(--dsw-alias-label-secondary)`、`margin-left: 5px`、`font-variant-numeric: tabular-nums`；行 1 显示该供应商路由总数，行 2 显示该分组路由数，行 3 显示候选路由数，**行 4 不显示文字角标，改显示配置状态点**（见 §3.2 与下方「行 4 的宽度硬约束」） |

#### 3.1.1 四行按钮的文案规则（按真实配置校准，实测宽度）

> 下列宽度为本机真实 `settings.yaml`（12 路由 / 6 供应商 / 7 分组）在 1280×800 视口下的**实测值**
> （芯片高 26px、`xxs-12` 字号、左右内边距 10px、间距 6px、标签槽 64px）。
> 面板内容宽 960px → 芯片可用 **888px**。

**行 1 供应商 —— 6 个按钮，不是 7 个**（⚠ 常见误记，务必按 6 设计）：

`7` 是**行 2 的 API 类型按钮总数**（`http://ai.max66.xyz/v1` 一个供应商下挂了 2 种 api，其余 5 个各 1 种 → 5 + 2 = 7）。
行 1 只有 **6** 个：`happycodeai.com/v1`、`www.xcmapi.com/v1`、`happycodeai.com`、`ai.max66.xyz/v1`、`max66.xyz/v1`、`aihub.dog/v1`。

| 项 | 规格 |
|---|---|
| 文案 | `providers[].displayLabel` = 归一化 baseURL **去掉 `http://` / `https://` 前缀**（保留路径与 `/v1`） |
| 实测宽度 | 6 个按钮 + 路由数角标 单行合计 **761px < 888px** ✅ 不换行 |
| 最长 | `happycodeai.com/v1` **18 字符 / 132px**（无角标时） |
| 最短 | `aihub.dog/v1` **12 字符 / 92px** |
| `title` | `完整 baseURL · 协议 · N 条路由`（含 scheme） |
| 角标 | 该供应商路由总数（`4` / `1` / `1` / `2` / `1` / `3`） |

**为什么去 scheme**：6 个按钮**全部**是 `http(s)://`，scheme 对选择毫无区分价值，却要吃掉每个按钮约 40px；
去掉后行 1 从约 940px 降到 696px，在 960px 内容宽下**单行放下**（保留 scheme 则会逼近上限）。
完整 URL 仍可通过 `title` 与预览区（那里显示完整 URL）获取。

**⚠ 两个 `happycodeai` 的区分（真实可用性风险，必须处理）**：
`happycodeai.com`（anthropic，无 `/v1`）与 `happycodeai.com/v1`（openai，带 `/v1`）前缀相同、只差尾部 `/v1`。
叠加三重区分：

1. **路径高亮**（主要手段）：`/v1` 段用 `color: var(--dsw-alias-label-primary)`，
   host 段用 `label-secondary`。实测两个按钮宽度 132px vs 115px，且 `/v1` 在视觉上明显更重 —— 一眼可分。
2. **`title`**：`完整 baseURL · 协议 · N 条路由`，例如
   `https://happycodeai.com · anthropic-messages · 1 条路由`。
3. **预览区**（最终确认点）：选中后元信息行给出完整 `baseURL` + 协议名 + 实际请求 URL。
   这也是唯一能显示完整信息且有整行空间的地方。

**行 1 角标 = 该供应商的路由总数**（`4` / `1` / `1` / `2` / `1` / `3`），实测 6 个按钮合计 **761px < 888px** ✅ 单行放下。

> **⚠ 实测反例（不要这样做）**：若行 1 角标改显示**完整协议名**（`openai-completions` / `anthropic-messages`），
> 6 个按钮合计 **992px > 888px → 必然换行 → 行高 26→61px → 突破 §1.3 的 122px 预算**。
> 因此协议名只出现在行 2、`title` 与预览区，**不进行 1 角标**。
> （若确实想在行 1 提示协议，可用 2–3 字符缩写，实测合计 815px 可放下 —— 但缩写可读性差，
> 本规格**不采用**，改由路径高亮承担区分职责。）

**行 2 API 类型 —— 共 7 个按钮（跨 6 个供应商）**：
单个供应商下最多 2 个（`ai.max66.xyz/v1` → `anthropic-messages` + `openai-completions`），
实测 2 个按钮合计 **262px**，远小于 888px ✅。文案 = 协议原值。

**行 3 模型 —— 单分组最多 6 个**（xcmapi 分组）：
实测 6 个模型按钮合计 **700px < 888px** ✅ 不换行。
最长 `deepseek-v4.1-flash-expires-on-0910` = **219px**（单按钮已占 888px 的 25%）。
文案 = `name ?? id`，角标 = 该模型的候选路由数。

**行 4 路由 —— 单分组最多 4 个，且有宽度硬约束**：

| 分组 | 路由数 | 按钮文案（实测宽度） |
|---|---|---|
| `www.xcmapi.com/v1` :: `openai-completions` | **4** | `xcmapi-guomo`(113) `api-tcvps-k3test`(118) `api-tcvps-006`(105) `api-tcvps-008`(105) → 合计 **459px** |
| `https://aihub.dog/v1` :: `openai-completions` | **3** | `aihub-01`(80) `aihub-012`(86) `aihub-013`(86) → 合计 **265px** |
| 其余 5 个分组 | 1 | 不渲染行 4 |

**⚠ 行 4 的宽度硬约束（本规格的一处关键取舍，实测决定）**：
行 4 的角标**不能**显示 `credential.ref` 文字。实测把 4 个引用名
（`XCMAPI_GUOMO_KEY` / `API_TCVPS_K3TEST_API_KEY` / `API_TCVPS_006_API_KEY` / `API_TCVPS_008_API_KEY`）
作为可见角标时，行 4 合计 **913px > 888px 可用宽度** → **必然换行 → 行高从 26px 变 61px →
突破 §1.3 的 122px 选择条预算 → 首屏预算失败（AC15）**。

因此行 4 角标采用 **6px 配置状态点**（不占文字宽度）：4 个按钮合计 **459px**，单行稳放。
密钥引用名与「已配置 / 未配置」文字只在**预览区元信息行**显示（那里有整行空间），
芯片上通过 `title="路由 api-tcvps-006 · 密钥 API_TCVPS_006_API_KEY 已配置"` 提供完整信息。

**第 4 行的渲染条件（回答「只有 1 条路由时是否隐藏」）**：
**隐藏，且是「整行不渲染」而非 `display:none`**。判据是**分组作用域**的 `groups[g].routeCount > 1`，
与选了哪个模型无关（`SPEC.md` §7.4 / R6）。本机 7 个分组中只有 2 个满足 → 行 4 只在
`www.xcmapi.com/v1` 与 `aihub.dog/v1` 两个分组下出现。
边界：分组 `routeCount > 1` 但所选模型只被 1 条路由声明时，行 4 **仍渲染**且只有 1 个候选按钮（选中态）。

### 3.2 配置状态点（行 4 角标 / 预览区）

```
● 已配置（实心，success 混合色）   ● 未配置（实心，error 混合色）   ◌ 未知（空心，label-tertiary）
```

- **已配置**：实心圆 `6px`，`background: color-mix(state-success 56%, label-primary)`（浅 `#1a763e` / 深 `#81dca3`）；
  语义由 `title="密钥 API_TCVPS_006_API_KEY 已配置"` 与预览区文字承担（颜色不单独承载语义）。
- **未配置**：实心圆 `6px`，`background: color-mix(state-error 78%, label-primary)`（浅 `#bb1313` / 深 `#f47d7d`）；
  `title="未配置密钥 API_TCVPS_006_API_KEY"`。
- **未知**（`credential.configured === null`，凭据服务缺失）：**空心圆**（`6px` 盒 + `1.5px solid var(--dsw-alias-label-tertiary)` + 透明底），
  用形状而非第三色区分，避免多引入一个色相；`title="密钥配置状态未知（凭据服务不可用）"`。
- 圆点直径 6px 是**非文本图形**，且它是纯装饰冗余（文字与 `title` 已表达语义），故不受 3:1 约束；
  但仍取混合色以保证浅色下可见——纯 `#22c55e` 对白底仅 **2.28:1**，会「看不见」，这正是必须用混合值的理由。

### 3.3 行标签 `[data-mh-row-label]`

- 固定槽宽 **64px**（`flex: 0 0 64px`），右对齐或左对齐均可，本规格取**左对齐**（中文标签左对齐更易扫读）。
- `--dsw-font-xxxs-11`，`color: var(--dsw-alias-label-secondary)`（**不用 tertiary**，§2.4）。
- 行容器 `[data-mh-row]`：`display: flex; align-items: flex-start; gap: 8px; min-height: 26px`。
- 芯片容器 `[data-mh-chips]`：`display: flex; flex-wrap: wrap; gap: 6px; flex: 1 1 auto; min-width: 0`。
- 行 4 不渲染时（`groups[g].routeCount === 1`）**整行 DOM 不存在**（不是 `display:none`，便于 `V-S5` 断言）。
- 行 3 无模型时：芯片区渲染一行 `--dsw-font-xxs-12`、`label-secondary` 的文案「该分组未声明模型」，
  同时 `[data-mh-send]` 置禁用（`SPEC.md` §7.2）。

### 3.4 预览信息块 `[data-mh-preview]`

```
┌ 内凹底 bg-module-platform，radius 10px，padding 4px 10px ─────────────┐
│ POST  https://www.xcmapi.com/v1/chat/completions            [复制图标] │  ← 18px 行
│ 路由 api-tcvps-006 · 协议 openai-completions · 密钥 API_TCVPS_006_API_KEY ●已配置 │  ← 18px 行
│ ⓘ 本探针只发送协议最小头集，不应用路由的 headers / compat / 重试策略      │  ← 16px 行
└────────────────────────────────────────────────────────────────────────┘
                          合计 8 + 18 + 18 + 16 = 60px（§1.3 预算 ②）
```

| 元素 | 规格 |
|---|---|
| 方法 | `--ds-font-family-code` 11px，`color: var(--dsw-alias-label-secondary)`，固定 `POST` |
| URL | 等宽 11px/19px，`color: var(--dsw-alias-label-primary)`，`word-break: break-all`，**最多 1 行**（`-webkit-line-clamp: 1`），`title` = 完整 URL |
| 复制按钮 | 24×24，图标按钮，`aria-label="复制请求 URL"`；成功后就地显示「已复制」1.5s 并经 live region 播报 |
| 元信息行 | `--dsw-font-xxxs-11`，`label-secondary`；分隔符 ` · `；密钥只显示 `apiKeyEnv` 引用名 + 状态点 + 状态文字，**永不显示值** |
| 偏差声明行 | `--dsw-font-xxxs-11`，`label-secondary`，前置 `ⓘ` 字形；文案固定：`本探针只发送协议最小头集，不应用路由的 headers / compat / 重试策略`（`SPEC.md` §2.2 第 7 条要求可见声明） |
| 警示条 | `[data-mh-preview-warn]`，`role="alert"`；每条 `warnings[]` 一行：左侧 3px 色条（`state-warn` 混合色）+ `--dsw-font-xxxs-11` `label-primary` 文字；`ANTHROPIC_BASEURL_HAS_V1` 等用 warn 色，`MISSING_BASE_URL` / `UNSUPPORTED_API` 用 error 色；**不阻断发送** |
| 缺省态 | `source.available === false` 时不渲染本块，改渲染 §3.13 的「配置不可用」空态 |

### 3.5 测试消息输入框 `[data-mh-msg]`

- `<textarea>` 单行起步（`rows=1`），`height: 30px`，`max-height: 66px`（3 行）后内部滚动。
- 字体：`fontSize/FontWeight/LineHeight` 走 `body` 档子 token 长写（§2.4）；`color: var(--dsw-alias-label-primary)`；
  `background: var(--dsw-alias-bg-layer-1)`；
  `border: 1px solid var(--dsw-alias-border-l3)`；`border-radius: 10px`（对齐 DSH 输入框）；
  `padding: 3px 10px`；`resize: none`。（22px 行高 + 6px 内边距 + 2px 描边 = **30px**，与 §1.3 预算一致）
- 占位符 = `templates.userPrompt` 的默认值（`输出 OK`），`::placeholder { color: var(--dsw-alias-label-secondary); opacity: 1 }`
  ——**不用 `label-caption`**（浅色 2.13:1 不可读）。
- 有可见 `<label for="mh-msg">测试消息</label>`（`--dsw-font-xxxs-11`，`label-secondary`）+ `aria-describedby` 指向
  `#mh-msg-hint`（文案：`留空则使用默认模板「输出 OK」；长度上限 2000 字符`）。
- 字符计数：右下角 `--dsw-font-xxxs-11` `label-secondary`，`tabular-nums`；≥ 2000 时转 `state-error` 混合色并禁用发送。
- 快捷键 `Ctrl/Cmd + Enter` 触发送测试（发送可用时）。

### 3.6 参数与开关行 `[data-mh-param]`

`[data-mh-test]` 容器：`padding: 8px 10px`；`display: flex; flex-direction: column; gap: 6px`
（= 8 + 30 + 6 + 28 + 20 = **100px**，§1.3 预算 ③）。

参数行 `[data-mh-param]` 本身：`display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px`，高 **28px**。
一行放下 5 个控件 + 主按钮：

| 控件 | 类型 | 规格 |
|---|---|---|
| **严格校验** | `<input type="checkbox">` | 默认勾选；`accent-color: var(--dsw-alias-state-business-primary)`；标签 `--dsw-font-xxs-12` `label-secondary` |
| **流式** | `<button role="switch" aria-checked>` | 36×20 轨道 + 16px 圆形滑块，完全对齐 DSH 的 `_switch_` 规格；`aria-checked=true` 时轨道 `var(--dsw-alias-brand-primary)`；滑块 `transition: transform .12s ease` |
| **Temperature** | `<input type="number" step="0.1" min="0" max="2">` | 宽 52px；**空值 = 不发送该字段**；`placeholder="默认"` |
| **Max Tokens** | `<input type="number" step="1" min="1" max="4096">` | 宽 64px；默认 = `templates.maxOutputTokens`（64） |
| **超时** | `<input type="number" step="1000" min="1000" max="600000">` | 宽 78px + 单位 `ms`（`--dsw-font-xxxs-11` `label-secondary`）；默认 = `thresholds.hardTimeoutMs`（60000） |
| **发送测试** | `<button type="button">` | 主按钮，见 §3.7（高 28px，与同行控件等高） |

**宽度预算核对**（容器 960px = 1000 面板宽 − 40 内边距）：`checkbox+标签 ≈ 74` + `switch+标签 ≈ 62`
+ `Temp 标签+52 ≈ 100` + `Max 标签+64 ≈ 118` + `超时 标签+78+ms ≈ 140` + gap `5 × 12 = 60`
+ 主按钮 `≈ 96` = **650px < 960px**，单行放下且余量 310px。窄容器按 §1.4 换行。

**数字输入统一样式**：高 28px，`small` 档长写属性（§2.4）+ `tabular-nums`，右对齐，
`border: 1px solid var(--dsw-alias-border-l3)`，`border-radius: 8px`，`padding: 0 6px`，
`background: var(--dsw-alias-bg-layer-1)`。每个输入都有可见 `<label for>`（`--dsw-font-xxxs-11` `label-secondary`）
与 `aria-describedby` 指向提示文本。

**只读降级态**（§0.5 的 fallback 分支）：三个数字输入改渲染为 `<span>`：
`--dsw-font-xxs-12` + `tabular-nums`、`color: var(--dsw-alias-label-secondary)`、
`title="由插件配置固定，本机不可在面板修改"`、`aria-disabled="true"`，外面仍保留可见标签。

**超时字段的就地校验**：值 < 1000 或 > 600000 时输入框描边转 `state-error` 混合色，
下方 20px 错误槽位显示 `--dsw-font-xxxs-11` 的说明，并禁用发送。

> **★ 实现现状（v1.0.8 补记，供评审按此判定，勿按上表逐字核对）**：上表的
> **严格校验勾选框 / Temperature / Max Tokens / 超时** 四项**均为只读**（captain 裁定：
> 面板不得出现可编辑的 Temperature / Max Tokens / Timeout，也不得出现严格校验勾选框）。
> 实现渲染为 `[data-mh-ro]` 只读项（`label-secondary` + `tabular-nums` + `title` 说明 +
> `aria-disabled="true"`），严格校验恒开。上表保留为设计历史。

#### 3.6.1 新增控件：设为默认（§19）与自动重试（§18）

**布局原则（硬约束）**：两者**并入既有参数行**，**不新增行高**——AC15 一屏预算优先。
参数行仍为 `flex-wrap: wrap`，空间不足时换行（优雅降级），默认宽度下与只读项同行。

**为腾出横向空间的一处收窄**：`[data-mh-ro-sys]`（系统提示词只读展示）的 `max-width`
由 260px 收窄到 **150px**，仍单行截断。**功能未删减**：全文仍可在 `title` 与
「请求详情」页签中查看（§3.11）。

| 控件 | 钩子 | 规格 |
|---|---|---|
| **设为默认** | `[data-mh-defbtn]` | 高 **22px**；`border-radius: 999px`；`padding: 0 9px`；`tiny` 档字号；`border: 1px solid border-l3`；透明底。已是默认时 `[data-current="1"]` → `color/border-color: --mh-ok` 且 `cursor: default`（禁用）。文案：`设为默认` / `设置中…` / `已是默认`（前置字形 ☆ / ✓） |
| **重试模式分段** | `[data-mh-retryseg]` + `[data-mh-retrymode]` | `role="radiogroup"`；外框 999px 圆角 + `bg-module-platform` 底 + `padding: 1px`；每段高 **18px**、`padding: 0 8px`、`tiny` 档；`aria-checked="true"` → `--mh-biz-bg` 底 + `inset 0 0 0 1px` business 描边。**两段互斥必选其一**，默认「严格」，无「都不选」态 |
| **三个数字输入** | `[data-mh-retrynum]` + `[data-mh-retryinput]` | 宽 **52px**、高 **22px**（**命中区大于 DSH 原生数字输入的上下箭头**，对应用户既有反馈）；`small` 档 + `tabular-nums`；`border-radius: 6px`；每个都有可见 `<label for>`（`tiny` 档 `label-secondary`）。域：间隔 `min=0.1 step=0.1`、次数 `min=0 step=1`、时长 `min=0 step=0.1` |
| **开始/停止** | `[data-mh-retrygo]` | 高 **22px**；`border-radius: 999px`；`padding: 0 10px`；`tiny` 档；透明底 + `border-l3`。`[data-kind="stop"]` → 描边与文字转 `--mh-err`。文案：`开始重试`（↻）/ `停止`（■） |
| **会话结论** | `[data-mh-retrystatus]` | `tiny` 档；单行截断（全文在 `title`）；`data-tone`：进行中 `idle`、成功 `ok`、其余结束态 `warn`；`role="status"` + `aria-live="polite"` |
| **不限提示** | `[data-mh-retrywarn]` | `--mh-warn` 色 + `tiny` 档；**可见文本**（不是 `title`）：「次数与时长均不限，将一直重试直到成功或你手动停止」；`role="alert"`。**仅当次数与时长同时为 0 时出现**（AC25） |
| **设置结果** | `[data-mh-defnotice]` | `tiny` 档 + `label-secondary`；单行截断；渲染在既有 `[data-mh-test-slot]`（常驻 20px）内，**不新增行高**；`role="status"` |

**就地校验**：任一输入非法（`aria-invalid="true"`）时描边转 `--mh-err`，并**禁用「开始重试」**，
`title` 给出具体原因（如「间隔最多一位小数（如 0.5、2.5）」）。判定权仍在宿主，前端只做预检。

**无障碍**：三个输入均有可见 `<label for>` 与 `aria-label`；分段控件 `role="radiogroup"` +
`role="radio"` + `aria-checked`；会话结论 `role="status"`；不限提示 `role="alert"`。

### 3.7 主操作按钮 `[data-mh-send]`

| 态 | 规格 |
|---|---|
| **可用** | `background: var(--dsw-alias-button-primary-fill)`；`color: var(--dsw-alias-label-primary-foreground)`；高 **28px**（与参数行同高，对齐 DSH 紧凑主按钮 `_sm_` 的 28px 规格）；`border-radius: 999px`；`padding: 0 14px`；字体走 `btn` 档子 token 长写（§2.4）。对比度实测 **18.90:1（浅）/ 18.08:1（深）** |
| **悬停** | `background: var(--dsw-alias-button-primary-hover)` |
| **聚焦** | 2px business 环，`outline-offset: 2px` |
| **按下** | `transform: translateY(1px)`（`prefers-reduced-motion` 下取消） |
| **禁用** | `opacity: .45`；`cursor: not-allowed`；`title` 说明原因（缺失维度 / 无模型 / 超时非法 / 正在测试） |
| **测试中** | 左侧 12px 旋转环（`currentColor`，0.8s linear）+ 文字变「测试中…」；`disabled`；`aria-busy="true"` |
| **图标** | 可用态左侧一个 14px 播放/探针图标（`aria-hidden`） |

**可用性判据**（`SPEC.md` §7.3）：①②③④ 均有确定值 **且** 状态键不是 `testing` **且** 超时合法 **且** 消息长度合法。
密钥未配置、`apiSupported === false` **都不禁用发送**——让用户拿到真实结果比提前拦住更有诊断价值，
这两种情况改由预览区警示条提示。

**主按钮的完整写法**（可直接抄）：

```css
[data-mh-send] {
  background: var(--dsw-alias-button-primary-fill, currentColor);
  color: var(--dsw-alias-label-primary-foreground, currentColor);
  font-size:   var(--dsw-font-xxs-strong-12-font-size,   12px);
  font-weight: var(--dsw-font-xxs-strong-12-font-weight, 500);
  line-height: var(--dsw-font-xxs-strong-12-line-height, 18px);
  height: 28px; padding: 0 14px; border: 0; border-radius: 999px; cursor: pointer;
}
[data-mh-send]:hover:not(:disabled) { background: var(--dsw-alias-button-primary-hover, currentColor); }
[data-mh-send]:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary, currentColor); outline-offset: 2px; }
[data-mh-send]:disabled { opacity: .45; cursor: not-allowed; }
```

### 3.8 状态徽标 `[data-mh-badge]`

`role="status"` + `aria-live="polite"` + `aria-atomic="true"`，内嵌 `[data-mh-badge-dot]` + 文字。

| 状态 | 字形 | 底色（14% 淡底） | 文字色（混合值） | 文案 |
|---|---|---|---|---|
| `untested` | `○` 空心圆 6px | `var(--dsw-alias-bg-module-platform)` | `label-secondary` | **未测试** |
| `testing` | 旋转环 12px | business 14% | business P=82 | **测试中** |
| `healthy` | `✓` | success 14%（浅 `#e0f7e8` / 深 `#233a2c`） | success P=56（浅 5.04 / 深 7.46） | **Healthy** |
| `slow` | `!` | warn 14%（浅 `#fef1dd` / 深 `#403421`） | warn P=54（浅 5.13 / 深 7.78） | **Slow** |
| `failed` | `✕` | error 14%（浅 `#fcdede` / 深 `#402b2c`） | error P=78（浅 5.17 / 深 5.06） | **Failed** |

**实现要点**（可直接抄）：

```css
/* 徽标：底色与文字色各一条 color-mix，四状态共用同一公式 */
[data-mh-badge] {
  font-size:   var(--dsw-font-xs-strong-13-font-size,   13px);
  font-weight: var(--dsw-font-xs-strong-13-font-weight, 500);
  line-height: var(--dsw-font-xs-strong-13-line-height, 20px);
  height: 24px; padding: 0 10px; border-radius: 999px;
  /* 文字色：混向 label-primary —— 唯一能一套值通吃两主题的写法 */
  color: color-mix(in srgb,
    var(--dsw-alias-state-success-primary, currentColor) 56%,
    var(--dsw-alias-label-primary, currentColor));
  /* 底色：把目标底写进 color-mix 的第二个参数，不要用 alpha 叠加 */
  background: color-mix(in srgb,
    var(--dsw-alias-state-success-primary, currentColor) 14%,
    var(--dsw-alias-bg-layer-1, transparent));
}
[data-mh-badge="slow"] {
  color: color-mix(in srgb, var(--dsw-alias-state-warn-primary, currentColor) 54%, var(--dsw-alias-label-primary, currentColor));
  background: color-mix(in srgb, var(--dsw-alias-state-warn-primary, currentColor) 14%, var(--dsw-alias-bg-layer-1, transparent));
}
[data-mh-badge="failed"] {
  color: color-mix(in srgb, var(--dsw-alias-state-error-primary, currentColor) 78%, var(--dsw-alias-label-primary, currentColor));
  background: color-mix(in srgb, var(--dsw-alias-state-error-primary, currentColor) 14%, var(--dsw-alias-bg-layer-1, transparent));
}
[data-mh-badge="testing"] {
  color: color-mix(in srgb, var(--dsw-alias-state-business-primary, currentColor) 82%, var(--dsw-alias-label-primary, currentColor));
  background: color-mix(in srgb, var(--dsw-alias-state-business-primary, currentColor) 14%, var(--dsw-alias-bg-layer-1, transparent));
}
```

**为什么底色要写 `color-mix(…, var(--dsw-alias-bg-layer-1))` 而不是 `alpha`**：
前者让浏览器按**实际目标底**做不透明混合——浅色主题下是「往白里调」、深色主题下是「往暗里调」，
两主题自动得到正确的淡底；而 `rgba(state, .14)` 只是叠加，最终颜色取决于背后是什么，不可预测。
另注：**不要改用 `--dsw-alias-state-*-tertiary` 系列做底**——实测
`state-error-tertiary` 解析为 `rgba(0,0,0,0)`（完全透明），该系列不统一（详见 §2.1.1）。

- 尺寸：高 24px，`padding: 0 10px`，`border-radius: 999px`，字体走 `title` 档子 token 长写（§2.4）。
- 徽标与指标行同处 `[data-mh-result]` 顶部的一行（高 40px）：徽标左对齐，指标行右对齐或紧随其后；
  窄容器下徽标独占一行、指标行换到下一行（此时结果区增高，整面板滚动）。
- **英文状态词保留原文**（Healthy / Slow / Failed）——它们是 `SPEC.md` §9.1 的契约取值，
  中英并置会与契约值产生歧义；`未测试` / `测试中` 是客户端本地态，用中文。
- **测试中额外显示递增已耗时**：`[data-mh-badge]` 右侧 13px `tabular-nums` 数字，
  由 `Date.now() - startedAt` 每 100ms 更新（**客户端不得判定超时**，`SPEC.md` §8.2 / R27）。
- 徽标右侧是 **`reasons` 派生的小标签**：`slow-latency` → 「超出阈值 15000ms」、`strict-mismatch` → 「严格校验不符」，
  用同一 warn 色系。`reasons` 为空且 Healthy 时不渲染任何标签。

### 3.9 指标行 `[data-mh-metrics]`

四个 `[data-mh-metric]`，横向等分（窄容器 2×2）：

```
耗时               HTTP               tokens                    TTFT
122ms              200                31 → 1 = 32               —
────────────────────────────────────────────────────────────────────
label: 11px/label-secondary       value: 16px/500/label-primary/tabular-nums
行高 40px = 14（标签）+ 2（间距）+ 24（数值），与 §1.3 预算 ④ 一致
```

| 指标 | 数据来源 | 空值显示 | 备注 |
|---|---|---|---|
| 耗时 | `latencyMs` | `—` | 单位随量级切换：`< 1000` 用 `ms`，否则 `s`（保留 2 位小数）；超过 `thresholds.slowMs` 时数值后缀一个 warn 色 `▲` 字形 + `title` |
| HTTP | `httpStatus` + `httpStatusText` | `—` | `2xx` 用 success 混合色，非 2xx 用 error 混合色，`null` 用 `label-secondary` |
| tokens | `usage.promptTokens` / `completionTokens` / `totalTokens` | 三段各自 `—` | 中间用 `→` 与 `=` 连接；`usage.totalComputed === true` 时 total 后加 `*`，`title="上游未提供 total，由 input + output 计算"` |
| TTFT | `ttftMs` | `—`（非流式恒为 `null`） | 非流式时整格 `opacity: .55` 并用 `title="非流式请求无首增量耗时"` 说明 |

- 每个指标的标签与数值都用**同一组元素**（`[data-mh-metric-label]` / `[data-mh-metric-value]`），
  便于 `V-L1` 与对比度脚本统一取样。
- `usageSource` 不入指标行，放在响应区标题右侧的小字（`--dsw-font-xxxs-11`，`label-secondary`），
  文案如 `usage 来源 openai-final-chunk`。

### 3.10 三层诊断链 `[data-mh-chain]`

**横排三列 + `›` 连接符**（容器 < 720px 时竖排）。

```
┌─ ① API 请求 ✓ ───────┐ › ┌─ ② 模型响应 ✓ ──────┐ › ┌─ ③ 严格校验 ✓ ──────┐
│ 已收到 HTTP 200，      │   │ 提取到模型文本（2 个  │   │ 响应文本与期望值     │
│ 响应体 312 字节        │   │ 字符），结束原因 stop │   │ 「OK」完全一致       │
└───────────────────────┘   └──────────────────────┘   └─────────────────────┘
 3px 左色条 + 序号徽章        同左                        同左

 每层高 58px = 6（上内边距）+ 16（层头）+ 2 + 28（detail 2 行 × 14）+ 6（下内边距）
```

| 项 | 规格 |
|---|---|
| 结构 | `[data-mh-chain]` 为 `role="list"`；三个 `[data-mh-layer="api"|"model"|"strict"]` 为 `role="listitem"`，DOM 顺序固定 `api → model → strict` |
| 连接符 | `›` 字形，`aria-hidden="true"`，`color: var(--dsw-alias-label-tertiary)`（非文本字形，可用 tertiary） |
| 每层卡片 | `border-radius: 8px`；`background: var(--dsw-alias-bg-layer-1)`；`border: 1px solid var(--dsw-alias-border-l3)`；`padding: 6px 8px 6px 11px`；高 **58px**；左内嵌 3px 色条（`box-shadow: inset 3px 0 0 <state color>`，不用 `border-left` 以免位移） |
| 层头 | 序号徽章（16×16，`border-radius: 4px`，`--dsw-font-xxxs-11`，状态淡底 + 状态混合色文字）+ 状态字形（`✓` / `!` / `✕` / `—`，`aria-hidden`）+ `label` 文字（`SPEC.md` §9.2 由宿主下发的中文，**原样渲染**，`--dsw-font-xxs-12` 字重 500，`label-primary`） |
| 层体 | `detail` 文字，`--dsw-font-xxxs-11`（11px/14px），`color: var(--dsw-alias-label-secondary)`，`-webkit-line-clamp: 2`，`title` = 完整 detail |
| `pass` | 色条/序号/字形用 success 混合色（浅 `#1a763e` 5.68:1 / 深 `#81dca3` 9.52:1） |
| `fail` | 用 error 混合色（浅 `#bb1313` 6.52:1 / 深 `#f47d7d` 6.04:1）；层卡片额外加 `box-shadow: inset 0 0 0 1px <error 混合色>` |
| `skip` | 用 **`label-tertiary` 字形 + 虚线描边**（`border-style: dashed`）+ detail 用 `label-secondary`；**不使用任何状态色**，因为「未执行」不是一种结果。层头字形用 `—` |
| 可访问名 | 每层 `aria-label` = `第 N 层 <label>：<pass|fail|skip>。<detail>`（由客户端拼接的**纯描述**，不改写宿主文案） |

**为什么横排**：三层是一条链（上游 `fail` 必然导致下游 `skip`），横排 + `›` 把因果直接画出来；
同时省 **132px** 垂直预算（竖排需 `3 × 58 + 2 × 8 = 190`，横排只需 `58`）。
窄容器下竖排时 `›` 旋转为 `⌄`。

### 3.11 响应区 `[data-mh-response]`

标题行（24px）= 标题「响应内容」+ **3 段分段控件** + 右侧辅助信息 + 放大按钮（仅后两档）+ 复制按钮。
本块总高 **76px** = 24（标题行）+ 4（间距）+ 48（内容块 `max-height`），与 §1.3 预算 ④ 一致。

| 段 | 内容 | 数据源 |
|---|---|---|
| **模型文本**（默认） | `responseText`，`body` 档子 token 长写（§2.4），`color: var(--dsw-alias-label-primary)`，等宽关闭（模型文本不是代码） | `responseText` |
| **原始响应** | `responseRaw`，`--ds-font-family-code` 11px/19px，`white-space: pre-wrap; word-break: break-all`，底 `var(--dsw-alias-markdown-code-block)` | `responseRaw` |
| **请求详情** | **三小块**（§3.11.2）：系统提示 + 请求头（`requestHeaders`，鉴权头已渲染为 `Bearer ***`）+ 请求体预览（`requestBodyPreview`） | 同左 |

| 项 | 规格 |
|---|---|
| 分段控件 | `role="tablist"` + `aria-label="响应视图"`；三段为 `role="tab"` + `aria-selected` + `aria-controls`；高 22px；`border-radius: 999px`；选中 = business 14% 淡底 + `inset 0 0 0 1px` business 环 + `label-primary`；未选中 = 透明底 + `label-secondary`。面板外层的页签条与这里都是 tablist，故两者都必须有各自的 `aria-label` 以示区分 |
| 面板 | `role="tabpanel"` + `aria-labelledby` 指向当前 tab；**未选中的面板不渲染**（不是 `hidden`），保持 DOM 精简 |
| 内容块 | `max-height: 48px`（= 2 行 × 19px + 上下内边距 4px + 6px 滚动条余量）→ 超长时块内 `overflow: auto`；`border-radius: 8px`；`padding: 2px 8px` |
| 截断提示 | `truncated === true` 时，内容块底部固定一行 `--dsw-font-xxxs-11` warn 混合色文字：`内容已截断（原始长度超过展示上限）`，该行不随内容滚动 |
| 复制按钮 | 24×24 图标按钮，`aria-label="复制响应内容"`（随当前段变化：`复制原始响应` / `复制请求详情`）；成功后就地显示「已复制」1.5s |
| **放大按钮** | `[data-mh-zoom]`，24×24 图标按钮，**仅「原始响应」与「请求详情」两档渲染**（模型文本不是代码，弹窗对它无额外价值，且会让标题行变挤）；`aria-label="放大查看<档名>"`；点击打开 §3.11.1 弹窗 |
| 空文本 | `responseText === ""` 时，块内渲染 `--dsw-font-xxxs-11` `label-secondary` 的斜体占位「（空响应）」+ 虚线描边，**不渲染空块** |
| 辅助信息 | 标题行右侧：字符数（`--dsw-font-xxxs-11` `tabular-nums` `label-secondary`）+ `usageSource` |

#### 3.11.1 放大弹窗 `[data-mh-modal]`

**用户诉求**（2026-09-18）：原始响应与请求详情的内容要能**弹出显示**，并且**可做 JSON 格式化**。

| 项 | 规格 |
|---|---|
| 挂载 | `createPortal` 到 `document.body`（`[data-mh-root]` 自身 `overflow-y:auto`，留在里面会被祖先滚动容器裁切，`z-index` 也压不过外层 shell）。`require("react-dom")` 失败时回退为就地渲染（overlay 是 `position:fixed`，实测本面板到 body 的祖先链上 transform/filter/contain 全为 none） |
| 遮罩 | `[data-mh-modal-overlay]`，`position:fixed; inset:0`，`z-index:1200`，底 `--dsw-alias-bg-mask-1`；点击遮罩关闭 |
| **token 作用域** | ★ token 块的选择器是 `[data-mh-root],[data-mh-modal-overlay]` —— 弹窗 portal 出去后**不在** root 内，token 若只挂 root，弹窗内所有 `var(--mh-*)` 会全部失效（颜色/字号/圆角一起崩），且这种失效在「只看 DOM 文本存在性」的检查里完全看不见 |
| **box-sizing** | ★ `[data-mh-modal-overlay],[data-mh-modal-overlay] *{box-sizing:border-box}` —— `[data-mh-root] *` 覆盖不到 portal 内容，content-box 会让 padding 加到 width 上（实测 `width:80vw` 渲染成 **82.2vw**） |
| 尺寸 | 卡片 `width:80vw; height:80vh`（`max-width/max-height:100%`），圆角 14px，`box-shadow: 0 18px 60px rgba(0,0,0,.28)`；实测 1707×735 视口下 = 1366×588（精确 80.0%），居中且四边不溢出 |
| 结构 | 头（标题 + 目标摘要 + 计量 + 工具）/ 正文（唯一可滚动区，`overscroll-behavior:contain`）/ 脚（说明 + 截断提示） |
| 无障碍 | `role="dialog"` + `aria-modal="true"` + `aria-labelledby` 指向标题；打开时焦点进入首个可聚焦元素；`Tab` 在弹窗内循环（末尾 → 首个、首个 Shift+Tab → 末尾）；**`Esc` 在捕获阶段 `stopPropagation`**（否则会同时触发面板既有的「Escape 返回当前结果」，两个动作一起发生）；关闭后焦点回到触发按钮；打开期间锁 `document.body` 滚动并置 `html[data-mh-modal-open="1"]` |
| 动效 | 仅 overlay 淡入 120ms（§5.1 属性白名单内） |

#### 3.11.2 请求详情的分块与 JSON 格式化

★ **请求详情不是一个完整 JSON**（用户明确指出）：它是「系统提示 / 请求头 / 请求体」三块独立内容拼在一起，整体 `JSON.parse` 必然失败。故按块建模、**各块独立判断能否美化**。

| 块 | `data-mh-section` | 通常可美化？ | 说明 |
|---|---|---|---|
| 系统提示 | `sys` | 否 | 自然语言，如实标注「不是 JSON 对象或数组」 |
| 请求头 | `headers` | 是 | 鉴权头已脱敏为 `Bearer ***` |
| 请求体 | `body` | 是（未截断时） | **被截断时**原因优先说「内容已截断，不是完整 JSON」，不误导用户去怀疑自己写错了请求体 |

| 项 | 规格 |
|---|---|
| 分块容器 | `[data-mh-section]`，`display:flex; flex-direction:column; gap:2px`；块间距 4px |
| 块头 | `[data-mh-section-head]`：块名 `[data-mh-section-k]`（`nowrap`）+ 计量 `[data-mh-section-meta]`（`字符 · 行 · 字节`，不可美化时追加「 · 未格式化」并把原因放进 `title`） |
| 块正文 | `<pre data-mh-section-text>`，等宽 11px/19px，`white-space:pre-wrap; word-break:break-all` |
| **内联容器** | ★ `[data-mh-tabpanel][data-view='req']` **不再**整体套等宽 + `pre-wrap`（否则块头也会被当代码排版）；内联块仍受 `max-height:48px` 约束、内部滚动，**不改变**另两档的预算 |
| 计量口径 | `字符数 / 行数 / UTF-8 字节数`（中文按 3 字节、代理对按 4 字节）。**块头计量描述当前显示的文本**，弹窗头部计量描述**原文**（显式标注「原文」）——美化后两者行数不同（如 1 行 → 15 行），不标注会被误认为算错 |
| 美化开关 | `[data-mh-pretty]`，`aria-pressed` 表达当前态；文案「美化 / 原文」；缩进 **2 空格**；整档无任何可美化块时 `disabled` 并把原因放 `title` |
| 只认对象与数组 | ★ `JSON.parse` 接受裸标量（`"123"` → `123`），会把纯数字响应判成可美化并**剥掉引号改变语义**；故只接受 object / array |
| **复制恒给原文** | ★ 复制的是请求详情本身，不是美化后的排版（`copyText` 由未格式化的块拼装） |
| 单块失败不牵连 | 某块不可解析只影响该块的呈现（原样显示 + 原因），不影响其它块与整档 |

### 3.12 最近测试记录列表 `[data-mh-records]`

固定高 88px，内部滚动；表头 18px；每行 28px。

```
最近测试 12 条                                          [展开] [清空]
● 14:02:11  glm-5.3-flash      api-tcvps-006   122ms    200
● 14:01:03  gpt-5.6-sol        api-tcvps-008   18.40s   200  Slow
```

| 项 | 规格 |
|---|---|
| 容器 | `border-top: 1px solid var(--dsw-alias-border-l2)`；`padding-top: 8px`；`overflow-y: auto`；滚动条 `scrollbar-width: thin` |
| 表头 | 「最近测试 N 条」（`--dsw-font-xxxs-11` `label-secondary`）+ 右侧两个 24px 文字按钮：「展开/收起」「清空」 |
| 行 | `[data-mh-record]`，`role="button"` + `tabindex="0"`，高 28px，`display: grid`，列宽 `14px 62px minmax(0,1.4fr) minmax(0,1fr) 64px 44px auto`，`gap: 8px` |
| 状态点 | 6px 圆，用对应状态的混合色（同 §3.2）；**同时**行尾渲染状态文字（Healthy/Slow/Failed），非颜色编码 |
| 时间 | `HH:mm:ss`，`--dsw-font-xxxs-11` `tabular-nums` `label-secondary` |
| 模型 / 路由 | `--dsw-font-xxs-12`；模型 `label-primary`，路由 `label-secondary`；超长 `text-overflow: ellipsis` + `title` |
| 耗时 / HTTP | `--dsw-font-xxs-12` `tabular-nums`；右对齐 |
| 悬停 | `background: var(--dsw-alias-interactive-bg-hover)` |
| 聚焦 | 2px business 环，`outline-offset: -2px`（行紧邻，避免环被裁切） |
| 点击 | 把该条 `TestResult` 载入结果区，结果区顶部显示 `[data-mh-history-banner]`：「历史记录 · 14:01:03」+「返回当前」按钮；`Escape` 等价于「返回当前」 |
| 测试中 | 所有行 `aria-disabled="true"`、不响应点击（避免用户在请求在飞时被切走） |
| 空态 | 单行 `--dsw-font-xxxs-11` `label-secondary`：「还没有测试记录。选择目标后点「发送测试」」 |
| 清空 | 二次确认：按钮就地变为「确认清空？」+「取消」两个 24px 按钮，3s 无操作自动还原；成功后清空并播报「已清空 N 条记录」 |
| 展开 | 展开后 `max-height: 216px`（约 7 行）；展开状态不持久化 |

### 3.13 空态 / 加载态 / 错误态

| 场景 | 形态 |
|---|---|
| **首次加载 `GET /config`** | `[data-mh-skeleton]`：选择条 4 行、预览 1 块、结果卡 1 块的灰色占位条（`background: var(--dsw-alias-bg-skeleton)`，`border-radius: 6px`，高 12/26px），**不用全屏 spinner**（避免遮挡、避免布局跳动）。骨架带 `aria-hidden="true"`，容器 `aria-busy="true"` |
| **配置不可用**（`source.available === false`） | `[data-mh-unavailable]` 整面板空态：居中图标 + 标题「未读取到 llm-pi-ai 配置」（`--dsw-font-xs-strong-13` `label-primary`）+ 说明（`--dsw-font-xxs-12` `label-secondary`）+ 「重新加载」按钮（主按钮）。`role="status"` |
| **配置读取失败**（网络/HTTP 错误） | 同上，但标题为「配置读取失败」+ `error.title` / `error.hint`（若宿主返回），并提供「重试」 |
| **测试失败**（`status === "failed"`） | 结果区正常渲染：徽标 Failed + 指标行（HTTP 有值时显示）+ 三层链（api `fail`、下游 `skip`）+ 响应区。**额外**在指标行下方插入 `[data-mh-error]`：`role="alert"`，左侧 3px error 色条，标题 = `error.title`（`--dsw-font-xs-strong-13` `label-primary`），下一行 = `error.hint`（`--dsw-font-xxs-12` `label-secondary`），再下一行是 `error.code` 的 `<code>` 小字（`--dsw-font-xxxs-11` `label-secondary`，**不用 tertiary**） |
| **发送请求本身失败**（HTTP 4xx/网络） | **就地错误**：主按钮下方 20px 槽位内 `[data-mh-test-error]`，`role="alert"`，`--dsw-font-xxxs-11`，error 混合色文字 + `ⓘ` 字形。**不用 toast**——就地错误不遮挡、不消失、可被读屏按序读到 |
| **未测试** | 结果卡渲染 `[data-mh-result-empty]`：居中 `--dsw-font-xxs-12` `label-secondary` 文字「尚未测试当前目标」，下方一行 `--dsw-font-xxxs-11` `label-secondary` 显示当前目标摘要（`路由 · 模型 · 协议`），让用户确认「我要测的就是这个」 |
| **响应区无数据** | `[data-mh-chain]` 与 `[data-mh-metrics]` 均**不渲染**（不是渲染空值），由 `[data-mh-result-empty]` 独占结果卡；避免出现「三层链全灰」这种既占地方又无信息的中间态 |

> **修正**：错误码 `<code>` 用 `--dsw-font-xxxs-11` + **`label-secondary`**（不是 tertiary）——
> 11px 属正文，浅色下 tertiary 仅 3.42:1 不达标。

### 3.14 各状态的可触发性（供 t16 判定，避免「不可达 → 未验证」）

> **背景（qa-verifier 实测）**：本机 `.credentials.yaml` 里 12 条路由的 `apiKeyEnv` **全部已配置**，
> 且 `settings.yaml` 中不存在 `openai-responses` 路由。因此某些状态**无法由真实配置触发**。
> 本节明确每个状态**用什么方式可判定**，t16 按此执行即可，不必标「未验证」。

| 状态 / 形态 | 真实配置可否触发 | 判定方式（t16 用） |
|---|---|---|
| `untested` | ✅ 可 | 打开面板即为该态，无需构造 |
| `testing` | ✅ 可 | 点击发送后 200ms 内断言（或用 mock 挂起响应） |
| `healthy` | ✅ 可（需真实端点，消耗额度） | 真实冒烟 S1；或 mock 返回 `200` + 合法体 + `OK` |
| `slow`（`strict-mismatch`） | ⚠️ 需构造 | **mock 返回 `200` 且文本为 `OK！`**（`SPEC.md` AC8）。真实端点不可靠复现，不用真实端点验此项 |
| `slow`（`slow-latency`） | ⚠️ 需构造 | mock 延迟 > `slowMs`（或临时把 `slowMs` 调到 100） |
| `failed` | ⚠️ 需构造 | mock 返回 404 / 401 / 5xx；或把 baseURL 改为不可达主机 |
| **密钥未配置**（`MISSING_CREDENTIAL` + 红点） | ❌ **真实配置下不可触发** | **必须用构造数据**：mock `GET /config` 返回 `credential.configured = false`，或在测试 profile 里临时改一条 `apiKeyEnv` 为不存在的名字。**不得用真实配置断言此态** |
| **密钥状态未知**（空心圆，`configured === null`） | ❌ 不可触发 | 同上，mock `configured = null` |
| **`UNSUPPORTED_API` 警示条** | ❌ 本机无此路由 | mock `api` 为 `google-generative-ai` 等三协议外值 |
| **`OPENAI_BASEURL_MISSING_V1` 警示条** | ❌ 本机 6 组全部合规 | mock 一个不带 `/v1` 的 openai baseURL |
| **`ANTHROPIC_BASEURL_HAS_V1` 警示条** | ✅ **可**（本机 `ai.max66.xyz/v1` 命中） | 选 `ai.max66.xyz/v1` + `anthropic-messages`，断言 `[data-mh-preview-warn]` 出现且含 `不应带 /v1` |
| **`SETTINGS_UNAVAILABLE` 空态** | ❌ 需构造 | mock `GET /config` 返回 `source.available = false` |
| **`openai-responses` 协议** | ❌ 本机无该路由 | mock 覆盖（`SPEC.md` AC17 已如实标注） |
| **行 4 出现 / 不出现** | ✅ 可 | 选 `www.xcmapi.com/v1` 或 `aihub.dog/v1` → 出现；选其余 4 个供应商 → 不出现 |
| **行 4 候选随模型收窄** | ✅ 可 | xcmapi 分组：`gpt-5.6-sol` → 2 个；`glm-5.3-flash` → 1 个（行 4 仍渲染） |
| **`truncated` 截断提示** | ⚠️ 需构造 | mock 返回 > 8192 字符的响应体 |
| **历史记录载入** | ✅ 可 | 连测 2 次后点击第一条记录 |
| **记录溢出滚动** | ⚠️ 需构造 | 连测 > 2 次使记录条内部滚动（或 mock 多次返回） |

**通用构造方式（推荐 t16 用第一种）**：

1. **mock 宿主**：用 `tests/acceptance.mjs` 的本地 mock 服务器替换 `GET /config` / `POST /test` 的响应体，
   前端照常渲染 → 可覆盖上表全部「需构造」项，且不消耗上游额度、不依赖外网。
2. **临时改测试 profile**：复制一份 `settings.yaml` 到独立 profile，改 `apiKeyEnv` / `api` / `baseURL` 后切换；
   缺点是要改配置，需复原。
3. **不推荐**：为了触发红点而临时删真实密钥 —— 会破坏用户配置。

> **给 t16 的判定纪律**：凡上表标 ❌ / ⚠️ 的项，**必须写明用了哪种构造方式**；
> 若未构造，应写「未验证」并注明原因（不可由真实配置触发），**不得**因为「真实配置下看不到」就写「通过」。

---

## 4. 交互流程与状态迁移

### 4.1 状态机

```
                    ┌──────────────────────────────────────────┐
                    │  untested（未测试）                       │
                    └───────────────┬──────────────────────────┘
        点击「发送测试」              │  ▲  切换任一行选择
        （按钮可用时）                ▼  │  配置刷新且原选择失效
                    ┌──────────────────────────────────────────┐
                    │  testing（测试中）                        │
                    │  发送按钮 disabled + aria-busy=true       │
                    │  递增已耗时（100ms 节流）                  │
                    │  记录行 aria-disabled=true                │
                    └───────────────┬──────────────────────────┘
                        收到宿主响应  │  （客户端不自行超时）
                                     ▼
        ┌────────────┬───────────────┴────────────┬──────────────┐
        ▼            ▼                            ▼              ▼
   healthy      slow                        failed         （请求本身失败）
   三层全 pass  reasons 非空 或 latency>slowMs   任一上游层 fail  → 就地错误 + 保持上次结果
```

**判定权在宿主**（`SPEC.md` §9.1）：客户端只渲染 `status` 字段，**绝不重算**。
`untested` / `testing` 是客户端本地态，不进 `status` 字段。

### 4.2 状态槽与选择保持

- **状态键** = `routeKey + "::" + modelId + "::" + (stream ? "stream" : "plain")`（`SPEC.md` §4 术语表）。
- 面板为每个状态键记住**最近一次结果**（内存 Map，不持久化）；切换选择时结果区显示该键的历史结果，无则回 `untested`。
- **切换上行清空下行**（`SPEC.md` §7.2）：切供应商 → 清 ②③④；切 API 类型 → 清 ③④；切模型 → 重算 ④ 候选并选 `routeKeys[0]`。
- **配置刷新后**：以稳定 id（`providerId` / `groupId` / `modelKey` / `routeKey`）匹配；
  仍存在则保持选择；否则回落默认选中并在预览区上方插入一条 `role="status"` 提示「配置已变化，已回到默认选择」，5s 后自动淡出。

### 4.3 防重复提交（三层）

1. **UI 层**：进入 `testing` 立即把 `[data-mh-send]` 置 `disabled`，文字变「测试中…」。
2. **状态层**：`testing` 期间再次触发（含 `Ctrl/Cmd+Enter`）直接 return，不发请求。
3. **宿主层**：同目标在飞时宿主返回 409 + `TEST_IN_FLIGHT`（`SPEC.md` §10.1 / R25）；
   客户端收到 409 时**不覆盖当前进行中的计时**，仅在就地错误槽位显示「该目标正在测试中」。

### 4.4 键盘路径（完整可走通）

| 操作 | 按键 |
|---|---|
| 进入面板 | `Tab` 至页签条 → `Enter`/`Space` 激活「模型健康检查」页签 |
| 选择器行间移动 | 行内 `←`/`→` 移动并选中；行首 `←` / 行尾 `→` 环绕；`↑`/`↓` 在四行间纵向移动（同列优先） |
| 直接跳选 | 行内任意芯片可被 `Tab` 跳出（roving tabindex：只有选中项 `tabindex=0`） |
| 发送测试 | 输入框内 `Ctrl/Cmd + Enter`，或 `Tab` 到主按钮后 `Enter`/`Space` |
| 响应视图切换 | 分段控件上 `←`/`→` |
| 关闭历史视图 | `Escape` |
| 复制 | 聚焦复制按钮后 `Enter`/`Space` |

### 4.5 选择器交互细节

- **单击**：立即选中（不做二次确认），并即时重算下行与预览区。
- **键盘方向键**：移动焦点即选中（radiogroup 的标准行为），避免「先移动再确认」的双步操作。
- **不做**：不做多选、不做搜索框、不做「全选」。
  理由：本机最多 12 条路由、7 个分组，四行按钮一屏可见；引入搜索会破坏「一屏看全」的前提。
  若未来路由数 > 30，走变更单再议。

---

## 5. 反馈与动效

### 5.1 动效总则

| 项 | 规格 |
|---|---|
| 时长 | 状态过渡 120ms；悬停/按下 80ms；旋转 800ms（线性，无限） |
| 缓动 | `cubic-bezier(.2, 0, .2, 1)`（DSH 的 `--ds-ease-in-out` 族） |
| 属性白名单 | **只允许** `opacity` / `transform` / `background-color` / `color` / `box-shadow`。**禁止**动画 `width` / `height` / `top` / `left`（引发布局抖动，破坏一屏预算） |
| `prefers-reduced-motion: reduce` | **全部** `animation: none`、`transition-duration: 0s`；旋转环改为静态 `◐` 字形；结果出现不做位移，只做 100ms 淡入。判据见 §7.7 `V-M1` |

### 5.2 各场景动效

| 场景 | 动效 |
|---|---|
| **加载指示** | 首次配置加载：骨架条 1.4s 循环的 `opacity: .6 ↔ 1` 呼吸（`bg-skeleton`）。**不用旋转 spinner**——骨架同时承担「占位防跳动」与「加载中」两个职责 |
| **测试中** | ① 徽标内 12px 旋转环（`border: 2px solid var(--dsw-alias-border-l2)` + 一段 business 色弧）；② 主按钮左侧 12px 同款旋转环；③ 已耗时数字每 100ms 更新（`tabular-nums` 保证不抖动）；④ 结果区加 `aria-busy="true"`。**不加全屏遮罩、不做进度条**——真实耗时不可预测，假进度是欺骗 |
| **结果呈现** | 结果卡整体 `opacity: 0 → 1` + `translateY(2px) → 0`，120ms；三层链三层**依次**出现，每层延迟 30ms（`animation-delay`），总 210ms。用「链式依次点亮」呼应因果链语义 |
| **状态徽标切换** | 底色与文字色 120ms 过渡；字形**直接替换**（不做交叉淡入，避免两个字形同时可见） |
| **记录新增** | 新行 `opacity: 0 → 1` + `translateY(-4px) → 0`，120ms；列表 `scrollTop = 0` 立即回顶 |
| **就地错误出现** | `role="alert"` 出现时不做位移动画（避免读屏焦点混乱），只做 100ms 淡入；出现即占位（槽位高度常驻 20px，见 §1.3），**不推挤下方内容** |
| **复制反馈** | 按钮文字替换为「已复制」1.5s，仅 `color` 过渡；同时经 live region 播报「已复制到剪贴板」。剪贴板失败时显示「复制失败，请手动选择」并保持文本可选中 |
| **历史视图切换** | 顶部 banner 淡入 100ms；结果卡内容直接替换（不做交叉淡入） |

### 5.3 明确不做的动效

- 不做骨架屏到内容的**交叉淡入**（会让「数据到达」这个关键时刻变得模糊）。
- 不做数字**滚动/跳动计数**（诊断工具的数值要瞬时精确，滚动计数会被误读为估算）。
- 不做错误抖动（`shake`）——抖动是惩罚性反馈，与「排查工具」的冷静语气不符。
- 不做 `transition: all`（会意外动画布局属性）。

---

## 6. 无障碍

目标基线：**WCAG 2.2 AA**，并满足 DSH 平台的键盘可达与主题适配要求。

### 6.1 语义结构

| 元素 | 语义 |
|---|---|
| `[data-mh-root]` | `role="region"` + `aria-label="模型健康检查"` + `aria-busy`（配置加载中） |
| `[data-mh-rail]` | `role="group"` + `aria-label="测试目标选择"` |
| `[data-mh-row]` | `role="radiogroup"` + `aria-labelledby` 指向 `#mh-row-label-<row>` + `aria-orientation="horizontal"` |
| `[data-mh-row-label]` | `id="mh-row-label-<row>"`，普通文本节点 |
| `[data-mh-chip]` | `role="radio"` + `aria-checked` + roving `tabindex` + `aria-disabled`（禁用时） |
| `[data-mh-preview]` | `role="group"` + `aria-labelledby="mh-preview-title"` |
| `[data-mh-test]` | `role="group"` + `aria-labelledby="mh-test-title"` |
| `[data-mh-result]` | `role="region"` + `aria-label="测试结果"` + `aria-busy` |
| `[data-mh-badge]` | `role="status"` + `aria-live="polite"` + `aria-atomic="true"` |
| `[data-mh-chain]` | `role="list"`；层为 `role="listitem"` + `aria-label` |
| `[data-mh-error]` / `[data-mh-test-error]` / `[data-mh-preview-warn]` | `role="alert"` |
| `[data-mh-records]` | `role="region"` + `aria-label="最近测试记录"` |
| `[data-mh-record]` | `role="button"` + `tabindex="0"` + `aria-label`（完整描述该行） |
| 分段控件 | `role="tablist"` + `aria-label="响应视图"`；段 `role="tab"` + `aria-selected` + `aria-controls`；面板 `role="tabpanel"` + `aria-labelledby` |
| 流式开关 | `role="switch"` + `aria-checked` + 可见 `<label>` |

**禁止**：用 `div` 冒充按钮/单选；用 `title` 代替 `aria-label`；给装饰性字形（`✓` `›` `ⓘ`）不加 `aria-hidden="true"`。

### 6.2 label 关联（硬要求，逐项可判定）

| 控件 | 要求 |
|---|---|
| 测试消息 textarea | `id="mh-msg"` + `<label for="mh-msg">` + `aria-describedby="mh-msg-hint"` |
| Temperature | `id="mh-temp"` + `<label for="mh-temp">` + `aria-describedby="mh-temp-hint"` |
| Max Tokens | `id="mh-maxtok"` + `<label for="mh-maxtok">` + `aria-describedby="mh-maxtok-hint"` |
| 超时 | `id="mh-timeout"` + `<label for="mh-timeout">` + `aria-describedby="mh-timeout-hint"` |
| 严格校验 checkbox | `id="mh-strict"` + `<label for="mh-strict">` |
| 流式开关 | `id="mh-stream"` + `<label for="mh-stream">` |
| 复制按钮（多处） | `aria-label`（各有区分度，如「复制请求 URL」「复制响应内容」「复制原始响应」） |
| 图标按钮（展开/清空） | `aria-label` + 可见文字（本规格两处都带可见文字，不需要纯图标） |
| 面板内所有 `input` / `textarea` / `select` | **`id` 非空**，且 `document.querySelector('label[for=id]')` 非空（判据 `V-A3`） |

### 6.3 键盘可达与焦点管理

| 要求 | 规格 |
|---|---|
| 全部可操作元素可 `Tab` 到达 | 是（含芯片行、开关、数字输入、按钮、记录行、分段控件） |
| 芯片行用 roving tabindex | 每行**恰好一个** `tabindex="0"`（选中项），其余 `tabindex="-1"`；方向键移动并选中 |
| 焦点可见 | `:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary); outline-offset: 2px }`；紧邻元素（记录行）用 `outline-offset: -2px` |
| 焦点不被动画吞掉 | 就地错误出现时不给容器加 `tabindex`，不移动焦点 |
| 结果到达不抢焦点 | 结果区只更新 live region，**不 `focus()`**——抢焦点会打断用户的下一步操作 |
| 焦点顺序 | 与视觉顺序一致：选择条 → 预览 → 测试区 → 结果区 → 记录条 |
| 无键盘陷阱 | 分段控件与芯片行均可 `Tab` 离开 |

### 6.4 错误播报

| 场景 | 机制 |
|---|---|
| 状态徽标变化 | `[data-mh-badge]` = `role="status"` `aria-live="polite"` `aria-atomic="true"`；文本变化即播报「Healthy」「Failed」等 |
| 测试失败详情 | `[data-mh-error]` = `role="alert"`，插入时立即播报 `error.title`（`aria-atomic="true"` 保证 title + hint 一起读） |
| 发送请求失败 | `[data-mh-test-error]` = `role="alert"` |
| 配置警示 | `[data-mh-preview-warn]` = `role="alert"`（首次渲染即播报，因为是配置事实而非用户操作结果） |
| 测试中 | 结果区 `aria-busy="true"`，读屏会延迟播报该区域更新直到 `aria-busy` 复位 |
| 记录清空 | 复用 `[data-mh-badge]` 之外的独立 live region `[data-mh-live]`（`role="status"`，视觉隐藏但可读），播报「已清空 N 条记录」「已复制到剪贴板」等瞬时反馈 |
| 播报节流 | 递增耗时**不进** live region（每 100ms 播报会淹没读屏）；只播报状态跃迁 |

### 6.5 对比度门槛（可判定数值）

| 项 | 门槛 | 本设计实测 |
|---|---|---|
| 正文文本（11px–16px，非粗体） | **≥ 4.5:1** | 最低 **4.65:1**（深色 error 混合色对 `bg-layer-3`） |
| 大字号（≥24px，或 ≥18.66px 且 ≥700 字重） | ≥ 3:1 | 本设计未使用大字号，不适用 |
| 非文本（焦点环、选中环、状态色块、图标） | **≥ 3:1** | 焦点环 3.91–6.86:1；选中环 3.57–5.91:1；状态色块 5.04–9.52:1 |
| 边框（装饰性） | 不适用（**不得作为唯一识别手段**，§2.5(d)） | 实测 1.09–1.92:1 |
| 禁用控件 | 1.4.3 豁免；本设计自设下限 **≥ 1.6:1** 以保证可感知 | 浅色 1.94 / 深色 3.26 |
| 双主题 | 同一套 token 在 `body` 与 `body[data-ds-dark-theme]` 下**均**满足上表 | 是（§2.5 全表逐项实测） |

### 6.6 非颜色编码（WCAG 1.4.1）

**每一个由颜色承载的状态，都必须同时有形状或文字载体：**

| 状态 | 颜色 | 并行的非颜色载体 |
|---|---|---|
| 芯片选中 | business 淡底 + 环 | `✓` 字形（`aria-hidden`）+ `aria-checked="true"` + 字重 500 |
| Healthy | success 淡底 + 绿 | `✓` 字形 + 文字「Healthy」 |
| Slow | warn 淡底 + 黄 | `!` 字形 + 文字「Slow」+ reasons 标签文字 |
| Failed | error 淡底 + 红 | `✕` 字形 + 文字「Failed」 |
| 测试中 | business | 旋转环 + 文字「测试中」+ 递增耗时 |
| 未测试 | 中性 | `○` 空心圆 + 文字「未测试」 |
| 三层 pass/fail/skip | 绿/红/中性 | `✓` / `✕` / `—` 字形 + 层头文字 + `aria-label` |
| 密钥已配置 | 绿点 | 实心圆 vs 空心圆（形状差）+ 预览区文字「已配置」+ `title` |
| HTTP 2xx / 非 2xx | 绿/红 | 数值本身（`200` vs `404`） |
| 记录行状态 | 色点 | 行尾状态文字 |

### 6.7 缩放与文本间距

- 面板所有尺寸用 `px`，但字号走 `--dsw-font-*` token（DSH 已通过 `--dsh-content-font-size` 支持用户改字号）。
- 200% 浏览器缩放下：`[data-mh-root]` 的 `overflow-y: auto` 生效，一屏预算失效但内容完整可读，无横向溢出（判据 `V-L4`）。
- 不做 `user-select: none`——诊断工具的输出必须可选中复制。
- 不设 `user-scalable=no`（面板不控制 viewport，遵循 DSH 全局设置）。

---

## 7. 渲染级验收判据

**判定口径**：每条判据给出**可直接在浏览器控制台执行的断言**（Chrome DevTools MCP `evaluate_script`）。
【必做】项全通过 → 该维度通过；任一失败 → 不通过。**未实测的项必须写「未验证」**，
不得以源码阅读代替渲染级证据。

**统一前置**：

```js
const R = () => document.querySelector('[data-mh-root]');
const ALL = (sel) => [...document.querySelectorAll(sel)];
const rect = (el) => el.getBoundingClientRect();
const cs = (el, p) => getComputedStyle(el).getPropertyValue(p);
const approx = (a, b, tol = 1) => Math.abs(a - b) <= tol;
// 视口固定为 1280×800（AC15 口径）
```

### 7.1 几何判据（`V-L*`）

| 编号 | 级别 | 断言 | 判据 |
|---|---|---|---|
| `V-L1` | 必做 | 选择条四行、每行芯片、每行标签的几何 | `ALL('[data-mh-row]').length === 4`；每行 `rect(row).height` ∈ [26, 120]；`ALL('[data-mh-chip]').every(c => approx(rect(c).height, 26))`；`ALL('[data-mh-chip]').every(c => rect(c).width >= 24 && rect(c).height >= 24)`（WCAG 2.5.8） |
| `V-L2` | 必做 | **首屏可见性（AC15）**。**前置**：视口 = **A 档**（`VH ≥ 910`；推荐取证视口 **2048×927**，须记录实际值），默认选中，且已跑完一次测试（结果区处于完成态，`[data-mh-chain]` / `[data-mh-metrics]` / `[data-mh-response]` 均已渲染）。**A 档须同时断言两条**（见 §1.3 末注：两条判据的有效性随 root 写法反转，只写一条会成空断言）：① `root` 不溢出；② `scrollBody` 不滚动。七个必需元素全部落在 `[data-mh-root]` 的**可见矩形**内且未被裁剪。**B / C 档**（`VH < 910`）按 §1.3.1 降级：断言「滚动发生在**面板内**」并记录档位/`slot`/缺口，**不得**记为无条件 pass | 对 `['[data-mh-rail]','[data-mh-preview]','[data-mh-test]','[data-mh-badge]','[data-mh-metrics]','[data-mh-chain]','[data-mh-response]']` 逐个断言 `r.top >= R().getBoundingClientRect().top - 1 && r.bottom <= R().getBoundingClientRect().bottom + 1`；**并**断言 `R().scrollHeight <= R().clientHeight + 1` **且** `SB().scrollHeight <= SB().clientHeight + 1`（`SB = () => document.querySelector('.wSkVaW_scrollBody')`）——**两条都要** |
| `V-L2b` | 必做 | 未测试态下结果卡不出现空的三层链 | 默认进入面板（未测试）时 `document.querySelector('[data-mh-chain]') === null` 且 `document.querySelector('[data-mh-metrics]') === null`，`[data-mh-result-empty]` 存在 |
| `V-L3` | 必做 | 面板总高不超过**该视口**的可用高度（按档位分流，§1.3 / §1.3.1） | **A 档（`VH ≥ 910`）**：**两条都断言**——① `R().getBoundingClientRect().height <= slot(VH) + 1`（`slot(VH) = VH − 224`）且 `R().scrollHeight <= R().clientHeight + 1`（root 不溢出）；② `SB().scrollHeight <= SB().clientHeight + 1`（`scrollBody` 不滚动 = 页面无滚动条）。**硬约束，不允许任何一层滚动**。**注意 box 模型**：`getBoundingClientRect().height` 是 **border-box**，上限取**槽位 `slot`**（2048×927 → 703.2），**不要**再减 40 padding（减了会得到 663.2，使预算 676 假 fail）。**B / C 档（`VH < 910`）**：须断言**滚动发生在面板内而非页面**——即 `R().scrollHeight > R().clientHeight`（root 溢出）**且** `SB().scrollHeight <= SB().clientHeight + 1`（页面不滚），并断言 `cs(R(),'overflow-y') === 'auto'` 且滚动到底全部内容可达（含记录条）；记录档位 / `slot` / 缺口像素（1440×900 = B/676/缺 9.2；1366×768 = C/544/缺 119.2；1280×800 = C/576/缺 87.2）；**禁止** `overflow-y: hidden`。**不得硬编码 684 或任何单一视口常数** |
| `V-L4` | 必做 | 无横向溢出 | `R().scrollWidth <= R().clientWidth + 1`；`document.documentElement.scrollWidth <= innerWidth + 1` |
| `V-L5` | 必做 | 芯片换行不撑破行容器 | `ALL('[data-mh-chips]').every(el => el.scrollWidth <= el.clientWidth + 1)`；每行标签槽宽 `approx(rect(label).width, 64, 2)` |
| `V-L6` | 必做 | 响应内容块限高且内部滚动 | `rect(document.querySelector('[data-mh-response] [role=tabpanel]')).height <= 48 + 1`；长内容时 `el.scrollHeight > el.clientHeight` 且 `cs(el,'overflow-y') === 'auto'` |
| `V-L7` | 必做 | 记录条固定 88px 且内部滚动 | `approx(rect(document.querySelector('[data-mh-records]')).height, 88, 6)`；`cs(records,'overflow-y') === 'auto'` |
| `V-L8` | 必做 | 三层链横排（容器 ≥ 720px） | 三个 `[data-mh-layer]` 的 `rect().top` 两两相差 ≤ 1（同一行）；`ALL('[data-mh-layer]').length === 3` |
| `V-L9` | 必做 | 四行选择器顺序与标签 | `ALL('[data-mh-row]').map(r => r.dataset.mhRow)` 严格等于 `['provider','api','model','route']`（行 4 存在时）或 `['provider','api','model']`（`groups[g].routeCount === 1` 时） |
| `V-L10` | 必做 | 面板内边距与区块间距 | `cs(R(),'padding') === '16px 20px 24px'`；根容器 `cs(R(),'row-gap')` 或 `gap` 首值 ≈ 14px |
| `V-L11` | 必做 | 区块总高不超过设计预算（用于**定位**超标区块） | **口径显式（防重复计入）**：`五个区块高度之和（= 580，**不含** gap）+ 4 × 14（gap = 56）+ 40（内边距）= 676`，须 `≤ slot(VH) + 1`（A 档 2048×927 → `≤ 703.2`；**703.2 是槽位 border-box 上限，不是内容盒**，内容盒 = 663.2）。**注意基准差异**：本判据以「区块之和 580」为起点，而 §1.3 表格的「内容区合计 636」**已含 gap**——两者等价，但**不得混用**（`580+56+40 = 676 = 636+40`）。单块偏差 `\|rect(block).height − 预算\| <= 4`，预算见 §1.3 |

### 7.2 状态判据（`V-S*`）

| 编号 | 级别 | 断言 | 判据 |
|---|---|---|---|
| `V-S1` | 必做 | 初始态为未测试 | `document.querySelector('[data-mh-badge]').textContent` 包含「未测试」；`[data-mh-result]` 内存在 `[data-mh-result-empty]`；`[data-mh-chain]` 与 `[data-mh-metrics]` 均不存在（与 `V-L2b` 同源，此处作为状态机判据重述） |
| `V-S2` | 必做 | 测试中防重复点击 | 点击 `[data-mh-send]` 后 200ms 内断言：`document.querySelector('[data-mh-send]').disabled === true`；`cs(send,'cursor') === 'not-allowed'`；`document.querySelector('[data-mh-result]').getAttribute('aria-busy') === 'true'`；再点一次后宿主请求数不增加（用 `list_network_requests` 统计 `/api/model-health/test` 的 POST 数 === 1） |
| `V-S3` | 必做 | 测试中已耗时递增 | 采样两次，间隔 300ms：`const a = readElapsed(); await sleep(300); const b = readElapsed(); b > a`（`readElapsed` 读徽标右侧的 `tabular-nums` 数字，解析为毫秒） |
| `V-S4` | 必做 | 完成后 `aria-busy` 复位且状态落在三值之一 | `[data-mh-result]` 的 `aria-busy === 'false'`（或属性不存在）；徽标文本 ∈ {`Healthy`,`Slow`,`Failed`}；`[data-mh-send]` 恢复可用 |
| `V-S5` | 必做 | 第四行条件渲染（AC14） | 选中 `https://www.xcmapi.com/v1` 分组：`document.querySelector('[data-mh-row="route"]') !== null`；选中其余 5 个分组：`=== null`（**是整行不在 DOM**，不是 `display:none`） |
| `V-S6` | 必做 | 第四行候选随模型收窄 | xcmapi 分组内选 `gpt-5.6-sol` → `ALL('[data-mh-row="route"] [data-mh-chip]').length === 2`；选 `glm-5.3-flash` → `=== 1` 且**第四行仍存在** |
| `V-S7` | 必做 | 切换上行清空下行 | 点击另一个供应商芯片后立即断言：`ALL('[data-mh-row="model"] [data-mh-chip][aria-checked="true"]').length === 1` 且该芯片属于新供应商的模型集；`[data-mh-badge]` 文本回到「未测试」或该新状态键的历史结果 |
| `V-S8` | 必做 | 三层链顺序固定 | `ALL('[data-mh-layer]').map(l => l.dataset.mhLayer)` 严格等于 `['api','model','strict']` |
| `V-S9` | 必做 | 上游 fail 时下游为 skip 且不使用状态色 | 构造 401 场景后：`api` 层 `aria-label` 含 `fail`；`model` 与 `strict` 层 `aria-label` 含 `skip`；两层的左色条 `cs(el,'box-shadow')` 不含 success/error 混合色的 rgb 值；`cs(layer,'border-style') === 'dashed'` |
| `V-S10` | 必做 | 错误就地显示且不推挤布局 | 触发发送失败：`[data-mh-test-error]` 存在且 `role === 'alert'`；触发前后 `[data-mh-records]` 的 `rect().top` 变化 ≤ 1px（错误槽位常驻） |
| `V-S11` | 必做 | 记录点击载入历史并标注 | 点击第一条记录：`[data-mh-history-banner]` 存在且文本含「历史记录」；按 `Escape` 后 banner 消失 |
| `V-S12` | 必做 | 测试中记录行不可交互 | `[data-mh-send]` 进入 disabled 后，`ALL('[data-mh-record]').every(r => r.getAttribute('aria-disabled') === 'true')` |
| `V-S13` | 可选 | 配置刷新选择保持 | 修改 `settings.yaml` 后点「重新加载」，若原 id 仍在则选中项不变 |

### 7.3 无障碍判据（`V-A*`）

| 编号 | 级别 | 断言 | 判据 |
|---|---|---|---|
| `V-A1` | 必做 | `role` 集合覆盖 | `new Set(ALL('[data-mh-root] [role]').map(e => e.getAttribute('role')))` ⊇ `{region, group, radiogroup, radio, status, alert, list, listitem, tablist, tab, tabpanel, switch, button}` |
| `V-A2` | 必做 | 芯片语义完整 | 每个 `[data-mh-chip]`：`role === 'radio'`、有 `aria-checked` ∈ {`true`,`false`}、父元素 `role === 'radiogroup'` 且父的 `aria-labelledby` 指向存在的 id |
| `V-A3` | 必做 | label 关联 100% | `ALL('[data-mh-root] input, [data-mh-root] textarea, [data-mh-root] select]').every(el => el.id && document.querySelector('label[for="'+el.id+'"]') !== null)` |
| `V-A4` | 必做 | roving tabindex 正确 | 每行 `ALL('[data-mh-row="X"] [data-mh-chip]')` 中 `tabindex="0"` 的个数 **恰好 1**，其余全为 `-1` |
| `V-A5` | 必做 | 焦点可见（双主题） | 对每个可聚焦元素 `el.focus()` 后 `cs(el,'outline-width') === '2px'` 且 `cs(el,'outline-style') === 'solid'` 且 `cs(el,'outline-color')` ∈ {`rgb(65, 118, 230)`（浅）, `rgb(103, 158, 254)`（深）}；`cs(el,'outline-offset') === '2px'`（记录行 `-2px`） |
| `V-A6` | 必做 | 对比度 100% 达标 | 遍历 `[data-mh-root]` 内全部**可见文本节点**（`el.children.length === 0 && el.textContent.trim() && cs(el,'visibility') !== 'hidden' && cs(el,'opacity') !== '0'`），用 WCAG 相对亮度公式对其**实际合成底色**计算比值；断言 100% ≥ 4.5。脚本见 §7.8 |
| `V-A7` | 必做 | live region 齐备 | `[data-mh-badge]`：`role === 'status'` 且 `aria-live === 'polite'` 且 `aria-atomic === 'true'`；存在 `[data-mh-live]`（`role="status"`）；失败场景下 `[data-mh-error]` 或 `[data-mh-test-error]` 的 `role === 'alert'` |
| `V-A8` | 必做 | 无颜色单编码 | 对 `['healthy','slow','failed','testing','untested']` 五种徽标态，断言 `[data-mh-badge]` 的 `textContent.trim()` 非空；对每条记录行，断言行内存在状态文字节点（非仅色点） |
| `V-A9` | 必做 | 装饰字形隐藏 | `ALL('[data-mh-root] [data-mh-glyph]').every(g => g.getAttribute('aria-hidden') === 'true')` |
| `V-A10` | 必做 | 键盘全路径可走通 | 从页签进入后连按 `Tab` N 次（N = 可聚焦元素总数 + 2），断言焦点依次覆盖：4 行各 1 个芯片 → textarea → checkbox → switch → 3 个数字输入 → 发送按钮 → 3 个分段 → 复制按钮 → 记录行 → 清空/展开；且中途 `document.activeElement !== document.body`（无断点） |
| `V-A11` | 必做 | 结果到达不抢焦点 | 测试完成前后 `document.activeElement` 不变 |
| `V-A12` | 可选 | Lighthouse 无障碍 | 面板激活状态下 `lighthouse_audit` 无 `serious` 及以上问题 |
| `V-A13` | 必做 | 放大弹窗无障碍齐备 | 弹窗打开时：`[data-mh-modal]` 的 `role === 'dialog'`、`aria-modal === 'true'`、`aria-labelledby` 指向的 id **真实存在**；弹窗内所有 `button` 均有非空 `aria-label` 或可见文本；弹窗内 `[data-mh-glyph]` 全部 `aria-hidden === 'true'` |
| `V-A14` | 必做 | 弹窗焦点管理三件事 | ① 打开后 `document.activeElement` 在弹窗内；② 聚焦**最后一个**可聚焦元素后按 `Tab`，焦点回到**第一个**（Shift+Tab 反向同理），且全程 `[data-mh-modal].contains(document.activeElement)`；③ 关闭后 `document.activeElement` === 打开前的触发按钮 |
| `V-A15` | 必做 | `Esc` 不误触其它处理器 | 弹窗打开时按 `Esc`：弹窗关闭**且**面板既有的「Escape 返回当前结果」**未被触发**（`[data-mh-history-banner]` 仍在）。判据对象 = 捕获阶段 `stopPropagation` 是否生效 |
| `V-A16` | 必做 | 弹窗打开期间背景滚动被锁 | 弹窗打开时 `document.documentElement.getAttribute('data-mh-modal-open') === '1'` 且 `document.body.style.overflow === 'hidden'`；关闭后属性被移除、`document.body.style.overflow` 还原为打开前的值 |

### 7.4 主题适配判据（`V-T*`）

| 编号 | 级别 | 断言 | 判据 |
|---|---|---|---|
| `V-T1` | 必做 | 深色主题下重跑全绿 | `document.body.setAttribute('data-ds-dark-theme','')` 后重跑 `V-A6`（对比度）、`V-L4`（无横向溢出）、`V-L3`（高度预算）、`V-A5`（焦点环色为 `rgb(103, 158, 254)`），全部通过；随后 `document.body.removeAttribute('data-ds-dark-theme')` 还原 |
| `V-T1b` | 必做 | 主题切换机制断言（不用自造开关） | 断言深色由 `document.body.hasAttribute('data-ds-dark-theme')` 表达（不是 class、不是 `prefers-color-scheme`）；切到深色后 `document.documentElement.style.colorScheme === 'dark'`（DSH 同步设置）。**面板自身不得实现任何主题开关或主题状态**：源码中不存在 `colorScheme =` / `setAttribute('data-ds-` 的写入 |
| `V-T2` | 必做 | token 全部解析成功（含**家族边界**） | 断言面板用到的每个 token 在两主题下 `getComputedStyle(document.body).getPropertyValue(name).trim() !== ''`。三组必须逐一验过：① `--dsw-alias-state-business-primary`（**正确名**，实测 `#4176e6`/`#679efe`）而非 `--dsw-state-business-primary`（不存在的名）；② `--dsw-elevation-panel`（**无 alias 前缀**）而非 `--dsw-alias-elevation-panel`（实测为空）；③ `--dsw-font-*` / `--ds-font-family-code` 同样无 alias 前缀 |
| `V-T2b` | 必做 | 阴影真值未被 fallback 吞掉 | 结果卡 `cs(card,'box-shadow')` 必须解析出**三层**阴影（两个逗号分隔的顶层层），且**不含 fallback 灰** `128, 128, 128`。参考实现：`const v = cs(card,'box-shadow'); const layers = v.match(/rgba?\([^)]*\)[^,]*(?:,\s*rgba?\([^)]*\)[^,]*)*/g)?.length ?? v.split(/,(?![^(]*\))/).length;` 断言 `layers >= 3 && !/128,\s*128,\s*128/.test(v)`。**注意不要用朴素 `v.split(',').length`** —— `rgba()` 内部也有逗号，会得到虚高的 12。另断言深色下第一层为白色描边：`/rgba\(255,\s*255,\s*255/.test(v)` |
| `V-T2c` | 必做 | 状态色**未**被当作纯色文字 | 源码扫描：不存在把 `var(--dsw-alias-state-*-primary)` 直接赋给 `color` 且**不含** `color-mix` 的声明。正则应命中 `color: color-mix(in srgb, var(--dsw-alias-state-` 至少 4 次（四状态各一） |
| `V-T3` | 必做 | 无硬编码主题色 / 无错前缀 | 对 `lib/client.js` 做源码扫描：不存在 `#14141a` `#2a2a33` `#23232b` `#e6e6ee` `#8a8a99` `#ff4f5e` `#eab308`；不存在 `prefers-color-scheme`；不存在 `[data-ds-dark-theme]` 主题分支；不存在 `--dsw-alias-elevation` 与 `--dsw-alias-font-` 错前缀；所有 `var(--dsw-alias-*` 的 fallback 为 `currentColor` / `transparent` / `rgba(...)` 之一 |
| `V-T4` | 必做 | `tabular-nums` 生效 | `cs(R(),'font-variant-numeric') === 'tabular-nums'`；抽验一个数值元素 `cs(value,'font-variant-numeric') === 'tabular-nums'` |
| `V-T5` | 必做 | `tabular-nums` 真等宽 | 同一数值元素渲染 `1111` 与 `8888`，`rect().width` 差值 ≤ 0.5px。**实测参考值**：`--dsw-font-base-strong-16` 下两者均为 `35.5375px`（差 0） |
| `V-T6` | 必做 | 字体声明用**子 token 长写属性**，未误用简写 | 源码扫描四条：① **不存在**简写 token 被喂给长写属性（正则 `font-size:\s*var\(--dsw-font-(?!.*-font-size)` 命中数 = 0）；② **不存在**任何 `font:\s*var\(--dsw-font-` （简写会重置 `font-variant-numeric`，本规格不采用）；③ **不存在** `font:\s*var\(--ds-font-family-code` （该 token 只含字体族，作简写会被整条丢弃）；④ 至少 6 组 `-font-size` / `-font-weight` / `-line-height` 三元组齐备（对应 §2.4 的 7 档中的 6 个可缩放档） |
| `V-T7` | 必做 | 唯一抬升面 | `ALL('[data-mh-root] *').filter(el => cs(el,'box-shadow') !== 'none' && !cs(el,'box-shadow').includes('inset'))` 的元素数 === **1**，且该元素是结果卡 |

### 7.5 动效判据（`V-M*`）

| 编号 | 级别 | 断言 | 判据 |
|---|---|---|---|
| `V-M1` | 必做 | 减弱动效下全部动画关闭 | `emulate({colorScheme:'auto'})` + 注入 `matchMedia` 桩或 Chrome 的 `prefers-reduced-motion` 模拟后：`ALL('[data-mh-root] *').every(el => cs(el,'animation-name') === 'none' || cs(el,'animation-duration') === '0s')`；`ALL('[data-mh-root] *').every(el => parseFloat(cs(el,'transition-duration')) === 0)` |
| `V-M2` | 必做 | 无布局属性动画 | 源码中 `transition` / `animation` 的属性白名单内不含 `width` `height` `top` `left` `margin` `padding`；不存在 `transition: all` |
| `V-M3` | 必做 | 旋转环在测试中出现 | `[data-mh-badge]` 内存在 `[data-mh-spinner]` 且 `cs(spinner,'animation-duration') === '0.8s'` 且 `cs(spinner,'animation-timing-function') === 'linear'` |
| `V-M4` | 可选 | 结果卡入场动画 | 结果到达瞬间采样 `cs(card,'opacity') < 1`；200ms 后 `=== '1'` |

### 7.6 内容与契约判据（`V-C*`）

| 编号 | 级别 | 断言 | 判据 |
|---|---|---|---|
| `V-C1` | 必做 | 客户端不自行拼 URL | 源码中不出现 `'/chat/completions'` `'/responses'` `'/v1/messages'` 字面量；URL 只来自 `groups[].previewUrl` / `requestPreview[].url` / `actualUrl` |
| `V-C2` | 必做 | 客户端不生成中文诊断文案 | 源码中不出现三层 `detail` 文案片段（如 `已收到 HTTP`、`提取到模型文本`、`上游层未通过`）；这些字符串只出现在 `lib/index.js` |
| `V-C3` | 必做 | 客户端不判定状态 | 源码中不存在 `status = ` 赋值给 `healthy`/`slow`/`failed`；不存在 `latencyMs > slowMs` 的判定表达式（`slowMs` 只用于展示「超出阈值」标注） |
| `V-C4` | 必做 | 密钥零泄漏 | 面板 DOM 全文 `R().textContent` 与 `R().innerHTML` 中匹配 `/sk-[A-Za-z0-9_-]{8,}/` 的命中数 === 0；请求头渲染处含 `Bearer ***` 或 `***` |
| `V-C5` | 必做 | 偏差声明可见 | `[data-mh-preview]` 的可见文本含 `不应用路由的 headers`（`SPEC.md` §2.2 第 7 条要求的固定声明） |
| `V-C6` | 必做 | 预览 URL 与请求 URL 同源 | 选任意目标后读 `[data-mh-preview-url]` 的 `title`（完整 URL）；发一次测试后读记录里的 `actualUrl`；两者字符串严格相等 |
| `V-C7` | 必做 | 弹窗几何 = 80% × 80% 且居中不溢出 | 弹窗打开时 `\|modal.width − innerWidth×0.8\| ≤ 1`、`\|modal.height − innerHeight×0.8\| ≤ 1`；中心点与视口中心偏差 ≤ 1px；四边均在视口内；`cs(modal,'box-sizing') === 'border-box'`；弹窗内**无**元素右边界超出卡片（横向溢出清单为空） |
| `V-C8` | 必做 | 弹窗 token 生效（portal 作用域） | 弹窗**不在** `[data-mh-root]` 内，故断言 `cs(title,'font-size') === '13px'`（`--mh-fs-title` 解析成功，而非浏览器默认 16px）；`cs(modal,'border-radius') === '14px'`。**反面判据**：若 token 块只挂在 `[data-mh-root]` 上，此断言必失败 |
| `V-C9` | 必做 | 请求详情**分块**且整体不可解析 | 「请求详情」档渲染**恰好 3** 个 `[data-mh-section]`（`sys` / `headers` / `body`）；把三块 `textContent` 拼接后 `JSON.parse` **必须失败**（证明「整体格式化」这条路确实走不通，分块是必需而非风格选择）；`cs(panel,'white-space') !== 'pre-wrap'`（容器不整体套代码排版） |
| `V-C10` | 必做 | 各块独立美化 + 失败原因可见 | 美化开启时：可解析块的 `textContent` 含 2 空格缩进（`/^\s{2}"/m`）；不可解析块的 `[data-mh-section-meta]` 文本含「未格式化」且 `title` 非空。**截断的请求体**必须命中 `/截断/`，不得只说「不是合法 JSON」 |
| `V-C11` | 必做 | 美化 ↔ 原文一键可逆 | 点 `[data-mh-pretty]` 两次回到初态；开启时 JSON 块行数 **>** 关闭时行数（实测 1 → 15）；`aria-pressed` 随态变化；整档无任何可美化块时按钮 `disabled` 且 `title` 给出原因 |
| `V-C12` | 必做 | 复制恒给原文 | 美化开启时点复制，写入剪贴板的字符串**不含**缩进换行（与关闭美化时一致）；`copyText` 由未格式化块拼装 |
| `V-C13` | 必做 | 内联一屏预算未被改动破坏 | 响应区总高仍 **76px**（24 + 4 + 48）；`[data-mh-param]` 高 **28px 单行**（未换行）；`[data-mh-row-label]` 高 20px（未竖排折行）；`[data-mh-root]` 的 `flex === '1 1 0px'`；页面级 `document.documentElement.scrollHeight <= innerHeight` |
| `V-C14` | 必做 | 放大入口只在后两档 | 「模型文本」档 `document.querySelector('[data-mh-zoom]') === null`；「原始响应」「请求详情」档存在且 `aria-label === '放大查看' + 档名` |

### 7.7 几何断言的可执行参考实现（`V-L2` / `V-L3`）

```js
() => {
  const R = document.querySelector('[data-mh-root]');
  const rr = R.getBoundingClientRect();
  const need = ['[data-mh-rail]','[data-mh-preview]','[data-mh-test]',
                '[data-mh-badge]','[data-mh-metrics]','[data-mh-chain]','[data-mh-response]'];
  const missing = need.filter(s => !document.querySelector(s));
  const clipped = [];
  for (const s of need) {
    const el = document.querySelector(s); if (!el) continue;
    const r = el.getBoundingClientRect();
    if (r.top < rr.top - 1 || r.bottom > rr.bottom + 1) clipped.push({ sel: s, top: Math.round(r.top), bottom: Math.round(r.bottom) });
  }
  return {
    viewport: { w: innerWidth, h: innerHeight },
    rootRect: { top: Math.round(rr.top), bottom: Math.round(rr.bottom), h: Math.round(rr.height) },
    rootScroll: { scrollH: R.scrollHeight, clientH: R.clientHeight, overflows: R.scrollHeight > R.clientHeight + 1 },
    heightBudgetOK: R.getBoundingClientRect().height <= 685,
    noHorizontalOverflow: R.scrollWidth <= R.clientWidth + 1,
    missing, clipped,
    pass: missing.length === 0 && clipped.length === 0 && R.scrollHeight <= R.clientHeight + 1
  };
}
```

### 7.8 对比度断言的可执行参考实现（`V-A6`）

```js
() => {
  const parse = (s) => {
    s = String(s || '').trim();
    let m = s.match(/^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\)$/);
    if (m) return [+m[1]*255, +m[2]*255, +m[3]*255, m[4] !== undefined ? +m[4] : 1];
    m = s.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?\s*\)$/);
    if (m) return [+m[1], +m[2], +m[3], m[4] !== undefined ? +m[4] : 1];
    if (s.startsWith('#')) {
      let h = s.slice(1);
      if (h.length === 3 || h.length === 4) h = h.split('').map(c => c + c).join('');
      if (h.length === 6 || h.length === 8) return [parseInt(h.slice(0,2),16), parseInt(h.slice(2,4),16), parseInt(h.slice(4,6),16), h.length === 8 ? parseInt(h.slice(6,8),16)/255 : 1];
    }
    return null;
  };
  const over = (fg, bg) => { const a = fg[3]; return [fg[0]*a + bg[0]*(1-a), fg[1]*a + bg[1]*(1-a), fg[2]*a + bg[2]*(1-a), 1]; };
  const lum = (c) => { const f = x => { x /= 255; return x <= 0.03928 ? x/12.92 : Math.pow((x+0.055)/1.055, 2.4); }; return 0.2126*f(c[0]) + 0.7152*f(c[1]) + 0.0722*f(c[2]); };
  const ratio = (a, b) => { const l1 = lum(a), l2 = lum(b); return (Math.max(l1,l2)+0.05)/(Math.min(l1,l2)+0.05); };
  // 沿祖先链合成不透明底色
  const bgOf = (el) => {
    let acc = null;
    for (let n = el; n; n = n.parentElement) {
      const c = parse(getComputedStyle(n).backgroundColor);
      if (!c || c[3] === 0) continue;
      acc = acc === null ? c : over(acc, c);
      if (acc[3] >= 1) return acc;
    }
    return acc || [255,255,255,1];
  };
  const R = document.querySelector('[data-mh-root]');
  const leaves = [...R.querySelectorAll('*')].filter(el => {
    const t = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
    const s = getComputedStyle(el);
    return t && s.visibility !== 'hidden' && s.display !== 'none' && +s.opacity > 0 && el.getClientRects().length > 0;
  });
  const fails = [];
  for (const el of leaves) {
    const fg = parse(getComputedStyle(el).color); if (!fg) continue;
    const r = ratio(over(fg, bgOf(el)), bgOf(el));
    if (r < 4.5) fails.push({ text: el.textContent.trim().slice(0, 30), ratio: Math.round(r*100)/100, color: getComputedStyle(el).color });
  }
  return { total: leaves.length, fails, pass: fails.length === 0 };
}
```

> 注意：此脚本读的是**实际合成**结果，因此对 `color-mix()` 产出的 `color(srgb …)` 也有效——
> 已在 §7.9 的实测中验证过该解析路径。

### 7.9 本规格数值的证据来源

| 证据类型 | 手段 | 说明 |
|---|---|---|
| 主题切换机制 | 读 DSH checkout 源码 | 深色 = `document.body` 的 `data-ds-dark-theme` 属性（`@deepseek-ai/dsh-client-ui-theme` 用 `toggleAttribute` 切换，同时设 `documentElement.style.colorScheme`）→ 面板只用 CSS `var()`，不实现主题开关、不调 theme 服务 `register()` |
| token 取值 | `mcp__chrome__evaluate_script` | `getComputedStyle(document.body)` 枚举全部 **79 个** `--dsw-alias-*` 自定义属性，浅色与 `body[data-ds-dark-theme]` 各取一遍；`--dsw-font-*` / `--dsw-elevation-*` / `--ds-font-family-code` 从同一对象读取 |
| token **家族边界** | 浏览器实测 | 逐个探测确认 `--dsw-alias-elevation-panel` 为**空**、`--dsw-elevation-panel` 有值（3 层）；`--dsw-elevation-*` 共 5 个且全无 `alias-` 前缀；`--dsw-alias-bg-overlay` / `-scrollbar-bg-l1` / `-interactive-bg-hover-danger` 确实存在 |
| `state-*-tertiary` 系列一致性 | 浏览器实测 | success/warn/business 的 tertiary 为不透明色（可用）；**`state-error-tertiary` 实测 `rgba(0,0,0,0)` 完全透明** → 不采用该系列，改用自算 14% 淡底 |
| 对比度 | 离线 Node 脚本 | WCAG 2.x 相对亮度公式；输入为上一步的实测 token 值；表面集合含 `bg-base` / `bg-layer-1..3` / `bg-module-platform` / `markdown-code-block` 及 `color-mix` 淡底合成结果 |
| 纯状态色当文字色 | 浏览器实测 | 对 `bg-layer-1`：浅色 success **2.28** / warn **2.15** / error **4.50** / business **4.23**；深色 6.89 / 7.31 / 4.77 / 5.91 → 浅色下三者不达标，故**状态色当文字必须混合** |
| `color-mix` 双主题有效性 | 浏览器实测 | 对四个状态色以 1% 步长扫描 P ∈ [30,100]，求「两主题、全部表面」均 ≥ 4.5:1 的**最大饱和** P 值：success 56、warn 54、error 78、business 82 |
| **规格 CSS 端到端复验** | 浏览器实测 | 把 §3.8 的徽标 CSS 与 §2.6 的阴影声明**原文注入** `document.head` 后测量真实渲染：徽标四态对比度 浅 5.04/5.13/5.17/4.72、深 7.46/7.78/5.06/5.62，`font` 解析为 `13px/20px 500`、高 24px；结果卡 `box-shadow` 解析出 3 层（深色首层自动转白 `rgba(255,255,255,.2)`）；`font-variant-numeric` 为 `tabular-nums` 且 `1111` 与 `8888` 宽度均为 `35.5375px` |
| `color-mix` 兜底安全性 | 浏览器实测 | token 存在 → 正常解析 `color(srgb …)`；token 全缺 → 退化为近似 `label-primary`（浅 18.90 / 深 15.03），**不会产生隐形文字**。`CSS.supports('color','color-mix(in srgb, red 50%, blue)') === true` |
| `font` 子 token 长写属性 | 浏览器实测 | 按 §2.2.1 原文复现 `F` / `font()`：6 个档位全部解析出**预期**的字号/字重/行高（16/500/24、13/500/20、12/500/18、14/400/22、12/400/18、11/400/14），零偏差；`fontVariantNumeric` 在长写**之前或之后**均为 `tabular-nums`（顺序无关，简写做不到） |
| `font` 简写陷阱 | 浏览器实测 | `font: var(--dsw-font-*)` 语法合法且能生效，但**会重置 `font-variant-numeric`**（顺序写错即失效）；`font-size: var(--dsw-font-*)`（简写喂长写）**整条丢弃**（字号回落继承值）→ 故本规格统一用子 token 长写属性 |
| `--ds-font-family-code` 陷阱 | 浏览器实测 | `font: var(--ds-font-family-code, …)` **整条丢弃**（字号回落 16px、字体族回落系统默认）；必须写 `font-family: var(…)` + 单独指定字号行高 |
| 「子 token 跟随用户字号缩放」 | 浏览器实测 + 源码 | **该说法不成立**：把 `--dsh-content-font-size` 改成 `18px` 后 `--dsw-font-s-14-font-size` 仍为 `14px`。全库 142 条 `--dsw-font-*` 声明中仅 21 条（全部 `markdown-*` 系列）引用 `--dsh-content-font-delta`；DSH 设置项自述 `fontSize.description: "仅影响会话内容的字号"`。→ 采用长写属性的理由是正确性与可维护性，**不是**跟随缩放 |
| §2.2.1 常量块可用性 | 浏览器实测 | 按文档原文复现 `dsw()` / `raw()` / `stateText()` / `stateTint()` / `F.*` 并测量：徽标 success 混合比 **5.04:1**；七个 `font` 简写全部解析出正确字号/行高/字重（16/13/12/14/12/11px）；`C.shadow` 解析出 3 层真值、不含 fallback 灰；`RING` 为 `rgb(65,118,230)` |
| 视口与几何预算 | 浏览器实测 | **可用高度是函数**：`slot(VH) = VH − 76（顶部偏移）− 148（composerSeat）`，内容盒 `= slot − 40（padding）`。**实测恒等式**：2048×927 → `slot 703.2`（`703.2 + 148 = 851.2 = scrollBody` ✓）；1280×800 → `slot 576`（`576 + 148 = 724 = scrollBody` ✓）；1922×986 → `slot 762.4`。`composerSeat` 为 `flex:0 0 auto` 的**平铺兄弟**（非浮层），两视口恒等式均成立故为结构性事实。**档位**：A `VH ≥ 910`（保证无滚动，长响应最坏余量 18px）／B `888 ≤ VH < 910`（短响应无滚动）／C `VH < 888`（降级为面板自身滚动）。`[data-pane="conversation"]` 宽 1000；页签条下沿 y=76。**溢出上浮事实**：`viewArea` 为 `flex:1 0 auto` → root 恒不溢出，溢出体现在 `scrollBody`（实测 root 749/749 溢出 0 而 scrollBody 851/897 溢出 46）。**旧数字 684 系漏减 composer 148px 的错误高估，已废弃** |
| 平台组件基准 | 浏览器实测 + 源码 | DSH 页签（13px/500、`::after` 2px 下划线、gap 36px）、输入框（radius 10px、13px/20.8px）、开关（36×20 轨道、16px 滑块、`.12s ease`）、tag（11px/17px、radius 999）、pill（高 24、radius 12） |
| 平台 `color-mix` 先例 | 源码 | `dsh-web-frontend/dist/assets/index-DPX2bQLo.css` 中 `_tag_*` 的 `color-mix(in srgb,var(--dsw-alias-state-success-primary) 10%,transparent)` |

> 本规格不含未经验证的推测：所有「实测」结论均可由 §7.7 / §7.8 的脚本在本机 DSH GUI 上重放复现；
> 所有「验收判据」均为可在浏览器控制台直接执行的断言形式。

---

## 8. 交接说明

| 下游 | 需要从这里拿走的东西 |
|---|---|
| **dev-client（t15）** | §2 全部 token 与数值（照抄，不要另创）；§3 每个组件的 `data-mh-*` 钩子与尺寸；§4 状态迁移与防重复；§6 无障碍清单；§7 全部判据作为自测脚本 |
| **spec-architect（t1）** | §0.5 的契约增量请求（`capabilities.requestParams` + `POST /test` 三个可选字段 + `TestResult.target` 回显），需 captain 裁决；若否决，`§3.6` 的只读降级分支即为最终形态 |
| **qa-verifier（t16）** | §7 全部判据（`V-L1…V-L11`、`V-S1…V-S13`、`V-A1…V-A12`、`V-T1…V-T7`、`V-M1…V-M4`、`V-C1…V-C6`）；§7.7 / §7.8 两段可直接粘贴的断言脚本；AC14 / AC15 / AC16 的渲染级核对口径 |
| **reviewer（t17）** | §0.3 的四个「有意为之」与 §0.5 的契约增量，作为「非缺陷」判定依据；§2.5(d)「边框不达标故不得作唯一识别手段」 |
| **integrator（t13）** | 无需额外动作；本文件随包发布（`package.json` 的 `files` 目前只含 `lib` / `cordis.patch.yml` / `README.md` / `LICENSE`，**如需随包分发 `docs/` 需在 t13 补 `files` 字段**） |
