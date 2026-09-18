# 功能规格书：dsh-model-health —— DSH 会话视图「模型健康检查」插件

> 状态：v1.0.7 已冻结（2026-09-18）。本文件是 t4（宿主实现）、t15（客户端实现）、t16（验证）、t17（评审）、t13（集成发布）的唯一实现依据。
> 配套文件：同目录 `ASSUMPTIONS.md`（假设登记表）、`CHANGE-REQUEST-001-credential-validation.md`（§8.1 变更单）、`CHANGE-REQUEST-002-cascade-selection.md`（§7.6 级联变更单）、`ui-spec.md`（视觉与交互，由 ui-designer 独立产出）。
> 分工边界：本文件定义**数据、协议、行为、契约、验收**；`ui-spec.md` 定义**视觉、布局、动效**。两者冲突时以本文件的数据与行为约定为准。

**变更记录**

| 版本 | 日期 | 变更 | 驱动 | 是否影响实现契约 |
| --- | --- | --- | --- | --- |
| v1.0 | 2026-09-17 | 首版冻结 | t1 | — |
| v1.0.1 | 2026-09-17 | ① AC2 判定方式补「扫描范围 = 仅 `llm-pi-ai.providers`」；② §6.1 表格 responses 行示例标注为「示意（本机无 responses 路由）」 | captain 变更单（reviewer 预审 F2 / F1） | **否**——仅文档澄清，未改动任何字段名、行为语义或契约 |
| v1.0.2 | 2026-09-17 | ① 新增 §7.6「四行不是自由笛卡尔积」：写死**级联过滤**（决策 (a)），附 xcmapi 17/30 无效组合实证与 aihub 6/6 陷阱；② §7.1 步骤 3 补「路由去重仅同 api 内、绝不跨 api」（distinct keyEnv 11 vs 槽位 12）；③ §7.1 步骤 4 补「模型行按 modelId 去重」口径（xcmapi 去重 6 / raw 7）；④ §7.3 补级联不变式与宿主侧防御校验；⑤ R7 收紧、新增 R7b；⑥ 新增 **AC23** | qa-verifier 独立枚举实测 ＋ reviewer 独立复核（CHANGE-REQUEST-002） | **否**——未改动任何字段名与既有行为语义；本条把**实现既有事实**（`row4Candidates` 按 `model.routeKeys` 收窄）写进规格，消除 t15/t16/t17 判定歧义。新增字段：无 |
| v1.0.3 | 2026-09-17 | ① **第四行判据改回「分组作用域」**：渲染条件 = `groups[g].routeCount > 1`（与所选模型无关），候选集仍按 `models[m].routeKeys` 收窄，**候选数为 1 时仍然渲染**；② 同步 §5.3 表注 / §7.2 ④ / §7.4 / §7.6 UI 表现 / §11.1 `routeCount` 对照表 / R6 / AC14；③ **F-QA-14**：§11.1 示例 JSON 新增 `aimax66` 分组并把 `ANTHROPIC_BASEURL_HAS_V1` 挂到它（原误挂 `happycodeai`，该组不以 `/v1` 结尾按规则不应报警） | captain 最终裁决（撤回此前的候选数判据仲裁）＋ t16 报告 F-QA-14 | **否**——未改动任何字段名、端点或错误码；`groups[].routeCount` 字段语义不变（本机 xcmapi = 4），仅「是否作为渲染判据」的表述纠正。dev-client 实现与 ui-spec 原本即为分组口径，本版使三方一致 |
| v1.0.4 | 2026-09-18 | **AC15 按视口分流改写**：支持视口（2048×927，`viewArea` 703.2px）内一屏看全**保持硬约束**；低于阈值（1280×800，槽位 576px，缺口 ≥87.2px）**允许面板自身滚动**并登记为小屏降级，禁止 `overflow-y:hidden`，功能项不得删减。措辞与 `ui-spec.md` v1.0.1 §1.3 / §1.3.1 一致 | captain 授权解冻（reviewer **F-R-08**：ui-spec §1.3 基线算术漏减 composer 148px；用户裁定「以我的真实屏幕为准，小屏时允许面板内滚动」） | **否**——未改动任何字段名、端点或错误码；AC15 语义**未被削弱**（支持视口内仍是硬约束），仅补齐视口定义与降级登记 |
| v1.0.5 | 2026-09-18 | **AC15 改为「函数 + 分档」形式**：① 可用高度写成函数 `slot(VH) = VH − 76 − 148`（内容盒 `= slot − 40`），**取代单一常数视口**——常数会在用户改变窗口尺寸时悄悄失效；② 分档：**A `VH ≥ 910` 硬约束**（长响应最坏余量 **18px**）／B `888 ≤ VH < 910`／C `VH < 888`（降级）；③ 判据修正为 `scrollBody` 不滚动为主；④ 降级须记录档位 / `slot` / 缺口像素，验收须记录取证视口尺寸。措辞与 `ui-spec.md` v1.0.2 §1.3 / §1.3.1 一致 | captain 更新要求（reviewer 第 2 轮补充 1–4） | **否**——未改动任何字段名、端点或错误码；AC15 硬约束**未被削弱**（A 档内仍不允许滚动），功能项不得删减 |
| v1.0.6 | 2026-09-18 | **AC15 判据双轨化（修正 v1.0.5 的单条判据）**：`[data-mh-root]` 写法决定溢出发生在哪一层——`height:100%`（t24 前）下 root 被撑高、溢出上浮到 `scrollBody`（页面级滚动）；**t24 改用 `flex:1 1 0` 后反转**，root 成为上界、溢出关在面板内。故：**A 档两条都断言**（root 不溢出 **且** `scrollBody` 不滚动）；**B/C 档判别式为「root 溢出 且 `scrollBody` 不滚动」**（= 滚动在面板内而非页面级，符合用户裁定「小屏时允许**面板内**滚动」）。**只写单条判据会随 root 写法变化而成为空断言**，v1.0.5 的「主判据」表述已作废 | reviewer 第 2 轮 `flex:1 1 0` 发现 ＋ qa-verifier `render-report.md` §7.2 独立复现（两种写法使两条判据各恒真一条） | **否**——未改动任何字段名、端点或错误码；判据**更严**（A 档由一条变两条），功能项不得删减 |
| v1.0.7 | 2026-09-18 | **新增 §18「自动重试（直到成功）」**（用户新确认功能，属**范围增量**）：① §18.1 功能定位与启用条件；② §18.2 **两种成功判定模式互斥必选**——严格模式（默认，`responseText.trim() === "OK"`）／连通模式（HTTP 2xx 且响应体可解析，不比对内容）；③ §18.4 **参数域**（间隔分钟/一位小数/最小 0.1/默认 1；最大次数默认 30，0=不限；最长时长默认 30 分钟，0=不限；两者同 0 须**可见文本**提示无限重试）；④ §18.5 **停止条件穷举 4 条**（成功／次数上限／时长上限／手动停止）+ **致命错误 401/403/404/400 不短路**（用户裁定，继续重试至上限）；⑤ §18.3 每次尝试均写记录（含 `attempt`/`sessionId`/`isFinal`）；⑥ §18.6 **单会话并发约束**（重复 start 返回 409 + `RETRY_IN_FLIGHT`，拒绝而非静默覆盖）；⑦ §18.7 3 个端点增量；⑧ **§2.1 登记为范围内**，**§2.2 第 1、2 条边界改写**为区分「后台常驻监控」（仍排除）与「用户显式发起、成功即停的有限重试会话」（纳入）；⑨ 新增 **R29–R33 / AC24–AC27**（**新编号，未改动任何既有 R/AC 编号语义**） | 用户 2026-09-18 确认自动重试功能（captain 转达） | **是**——**新增 3 个宿主端点**（`/retry/start`、`/retry/status`、`/retry/stop`）与**新错误码 `RETRY_IN_FLIGHT`**；既有字段名/端点/错误码语义**未改动**。范围增量，需 t35 实现、t34 设计控件 |
| v1.0.8 | 2026-09-18 | **新增 §19「当前默认模型」（用户新需求）**：① §19.1 定位与用户诉求（每次打开面板默认选中平时用的模型，一键即可测）；② §19.2 数据来源=宿主既有命名空间 `agent-default-model`（**不新增自有存储**）+ `routeKey → 四层选择状态` 映射规则（**逐分组查找**，同 baseURL 多 api 分组是易错点）+ `GET /config` 下发 `defaultModel`；③ §19.3 写路径 `POST /default`，用 **`replace`** 而非 `update`（合并语义无法移除字段），`reasoningEffort` **只在目标模型支持时才带**；④ §19.4/§19.5 端点与面板控件；⑤ 新增 **R34–R36 / AC28–AC30**。**同时登记 §18.2 的两处规格文字冲突与实现取舍**（见 §18.2 实现注记）——不修改 §18.2 正文语义，只把冲突显式化并按**最严侧**取唯一解 | 用户 2026-09-18 提出「将当前模型设置为默认选择，这样每次打开，都能快速测试自己默认使用的模型」 | **是**——新增 1 个宿主端点（`/default`）、`GET /config` 新增 `defaultModel` 与 `retryDefaults` 字段、`groups[].models[]` 新增 `reasoningEfforts`。既有字段名/端点/错误码语义**未改动** |

**文档结构与编号索引**（正文引用形如 §6.1 者，均指本索引对应小节）

| 编号 | 小节 | 编号 | 小节 |
| --- | --- | --- | --- |
| 1 | 目标 | 10 | 错误映射表（错误处理） |
| 2 | 边界 | 11 | 宿主 HTTP 端点契约 |
| 3 | 插件定位与非目标 | 12 | 测试记录结构与内存策略 |
| 4 | 术语与约定 | 13 | 需求 |
| 5 | 配置数据模型与读取路径 | 14 | 验收标准 |
| 6 | 三协议完整规则表 | 15 | 验证方法 |
| 7 | 四层选择器：数据流与分组算法 | 16 | 假设、风险与变更控制 |
| 8 | 请求执行、流式解析与安全基线 | 17 | 追溯索引 |
| 9 | 状态机与三层诊断链 | **18** | **自动重试（直到成功）** |
| 9 | 状态机与三层诊断链 | — | — |

---

## 目标

在 DSH Web GUI 的会话视图内新增一个「模型健康检查」页签（`conversation.view` 槽）。用户用四行按钮依次选定目标：**供应商（按 baseURL 分组）→ API 类型 → 模型 → 路由**，点击「发送测试」后，插件向该目标发起**一条真实 HTTP 请求**（自写裸 HTTP，不经过宿主 `ctx.llm.stream`），并把结果一屏呈现：

1. 耗时（总耗时、流式下的首增量耗时 TTFT）；
2. HTTP 状态码；
3. token 用量（prompt / completion / total）；
4. 响应内容（模型文本 + 原始响应体或 SSE 事件摘要）；
5. **三层诊断链**：API 请求 / 模型响应 / 严格校验，逐层给出通过或失败与人话化说明；
6. 状态徽标：未测试 / Testing / Healthy / Slow / Failed。

可观察、可度量的达成标志：

- 打开页签后，四行按钮的选择项**完全由本机 `settings.yaml` 的 `llm-pi-ai.providers` 动态推导**，无任何硬编码组数、模型名、路由名；
- 对任一可选目标点击一次「发送测试」，在 `hardTimeoutMs`（默认 60000 毫秒）内必定返回一条结果记录，记录中三层诊断链、耗时、HTTP 状态、token 用量字段齐备；
- 请求 URL 与鉴权头严格复现 openai / anthropic 官方 SDK 的拼接与头部规则，面板展示的「将请求」预览与真实发出的请求同源同值；
- 任一失败路径都给出中文人话化说明与下一步动作，且**任何响应、日志、记录、错误文本中都不出现密钥明文**。

## 边界

### 2.1 范围内

- 插件骨架：`package.json`（`dsh.bundle.patch` + `dsh.client`）、`cordis.patch.yml`、宿主入口 `lib/index.js`、客户端 bundle `lib/client.js`。
- 只读读取 `llm-pi-ai` 命名空间的 `providers` 配置，构建「供应商 / API 类型 / 模型 / 路由」四层选择模型。
- 自写裸 HTTP 探测：`openai-completions`、`openai-responses`、`anthropic-messages` 三协议的 URL 拼接、鉴权头、请求体、响应解析、流式与非流式两条路径。
- 密钥读取：`ctx.get("credentials").resolve(credentialRef(ref))`，环境变量快照为兜底。
- 测试消息模板（系统提示 + 用户提示）、严格校验（响应文本 trim 后精确等于 `OK`）、流式 / 非流式开关。
- 状态机、三层诊断链、错误码到中文人话化文案的映射表。
- 宿主 HTTP 端点 4 个（配置列表、执行测试、记录读取、记录清空）与内存 RingBuffer（容量 50，重启清空）。
- 客户端面板：四行按钮选择器、结果区、请求预览区、无障碍语义与主题适配（视觉细节由 `ui-spec.md` 规定）。
- **「自动重试（直到成功）」有限重试会话**：用户显式启动、单例运行、成功即停，含间隔 / 次数上限 / 时长上限三个参数与手动停止（完整规则见 §18）。**这不是后台监控**——区别见 §2.2 第 1、2 条。
- 验收脚本 `tests/acceptance.mjs`：以本地 mock HTTP 服务器覆盖三协议 × 流式 / 非流式 × 错误码矩阵。

### 2.2 范围外（明确不做的）

1. **不做实时监控（后台常驻监控）**：无后台轮询、无定时探测、无健康度时间序列、**无「插件自行决定何时发请求」的行为**。任何请求都源于用户的一次显式动作。
   > **边界修订（2026-09-18）**：本条的排除对象是「**后台常驻监控**」——即插件在无用户在场时自行、无限期地周期性探测。**用户主动发起、成功即停的有限重试会话属范围内**（见 §18 与本表第 2 条），它由用户显式启动、有明确终止条件、且不构成常驻探测。
2. **不做轮询**：**不自行、无限期地周期性发请求**。原「一次点击对应一次请求」的描述因自动重试功能而收窄为：**单次测试**一次点击对应一次请求；**重试会话**（§18）一次启动对应一串请求，但**必须**满足全部四项有限性约束——① 由用户显式启动；② 有次数上限或时长上限（或两者）；③ 达成成功判定即停；④ 可被用户随时手动停止。**缺少任一约束的周期性请求一律不在范围内**（那就是第 1 条排除的常驻监控）。
   > 429 / 5xx 在**单次测试**下仅提示「稍后重试」，由用户手动再点；在**重试会话**下按 §18.5 继续重试至上限。
3. **不做告警**：无通知、无桌面提示、无邮件 / Webhook、无阈值订阅。
4. **不做历史趋势**：记录只保留最近 50 条于内存，进程重启即清空；不落盘、不写状态文件、不做统计聚合、不做导出。
5. **不改写配置**：不调用 `settings.update / replace / mutate`，不提供「修正 baseURL」按钮。发现配置问题只提示，由用户自行改 `settings.yaml`。
6. **不复用宿主模型调用链**：不调用 `ctx.llm.stream`，不注册 `llm/stream` 监听，不经过宿主重试策略与 `compat` 开关。
7. **不应用路由的 `headers` / `compat` / `transport` / `retryPolicy`**：本插件发送的是**协议最小头集**（见 §6.2），测的是「裸协议可达性」，不等价于宿主实际请求。此偏差在面板「将请求」区以固定文案声明。
8. **不注册模型可见工具**：不新增 `model_health_*` 之类的 agent 工具，纯手动面板。
9. **不支持三协议之外的 api**：`azure-openai-responses`、`bedrock-converse-stream`、`google-generative-ai`、`pi-messages` 等一律不测，只标记 `UNSUPPORTED_API`。
10. **不做多模型批量测试**：一次点击只测一个（路由, 模型）目标。
11. **不持久化面板状态**：流式开关、当前选择、结果列表都不跨会话保存。

## 插件定位与非目标

- **定位**：一个**手动触发的连通性探针**，回答一个问题——「这条路由 + 这个模型，用真实协议打过去，到底通不通、慢不慢、回的内容对不对」。它服务于排查与配置核对，不服务于容量规划或 SLA 观测。
- **与 dsh-concurrency-guard 的关系**：只共享插件骨架写法（`package.json` 字段结构、`cordis.patch.yml`、宿主侧 `name / inject / apply` 与 `ctx.get("webServer")` 惰性注册路由）。业务逻辑、数据模型、UI 均独立，**不参考 guard 的视觉设计**。
- **核心非目标**：本插件不是监控系统、不是压测工具、不是模型评测器。它不判断模型回答质量（除 `OK` 这一条精确匹配外不做语义评估），不对模型优劣下结论，不给出「哪个供应商更好」的结论。**「自动重试」（§18）不改变这一非目标**——它是用户主动发起、有上限、成功即停的有限会话，不是常驻监控，也不构成压测（间隔下限 0.1 分钟）。

## 术语与约定

| 术语 | 含义 |
| --- | --- |
| 路由（route） | `llm-pi-ai.providers` 字典的一个键值对；键为 `routeKey`（如 `api-tcvps-006`）。 |
| 供应商（provider 组） | 按**归一化 baseURL** 归并的一组路由，即选择器第一行。 |
| 分组（group） | 按 **(归一化 baseURL, api)** 归并的一组路由，即第二行的落点，也是预览与请求规则的宿主。 |
| 归一化 baseURL | 仅去除**尾部一个或多个** `/`；**绝不补全、绝不裁剪 `/v1` 段**。 |
| 目标（target） | 三元组 `(routeKey, modelId, stream)`，一次测试的唯一标识。 |
| 三层诊断链 | `api`（API 请求）/ `model`（模型响应）/ `strict`（严格校验）三层，顺序固定。 |
| 状态键 | `routeKey + "::" + modelId + "::" + (stream ? "stream" : "plain")`，面板状态槽的键。 |
| 密钥 | 由 `apiKeyEnv` 指向的凭据引用解析出的明文值。只存在于宿主内存中单次请求的生命周期内。 |

约定：文中所有 JSON 字段名为**冻结契约**，实现与测试均按此字面量；时间字段一律为 epoch 毫秒整数；可选缺失用 `null`（不用 `undefined`、不用字段消失）。

## 配置数据模型与读取路径

### 5.1 读取路径（硬要求）

```
ctx.get("settings")            // 服务；缺失时降级为可提示的空结果
  .get("llm-pi-ai")            // 命名空间，只读
  .providers                   // Record<routeKey, PiAiProviderProfile>
```

**扫描范围（口径冻结，禁止扩大）**：本插件**只**读 `llm-pi-ai.providers` 一个命名空间下的 `providers` 字典。**不读** `llm-deepseek`、**不读** `describe-image`、不读任何其他命名空间或配置段。所有分组计数、选择器按钮、测试目标均以该字典为唯一输入。

> 该口径必须写死，否则计数会打架：本机「原始 baseURL 字符串去重」在全配置段范围内为 **7**，而 `llm-pi-ai` 内的**供应商组**为 **6**——差异来自 `describe-image.baseURL = https://happycodeai.com`（**非 LLM provider**）与 `llm-pi-ai.happycodeai.baseURL = https://happycodeai.com/` 只差一个尾斜杠。若实现误扫全配置段，会多出一个不存在的供应商组。**本插件一律以 `llm-pi-ai.providers` 为准。**

- 只在 `GET /api/model-health/config` 与 `POST /api/model-health/test` 两个时机读取，**每次读取重新取值**，不做跨请求缓存（用户在 `settings.yaml` 改完配置后刷新面板即可看到新值）。
- `ctx.get("settings")` 返回 `undefined`，或命名空间未注册（`get()` 返回 `undefined`），或 `providers` 不是对象时：`GET /config` 返回 HTTP 200 + `source.available = false` + `providers: []` + `groups: []` + `warnings[0].code = "SETTINGS_UNAVAILABLE"`；面板显示「未读取到 llm-pi-ai 配置」并提供「重新加载」。**不得抛异常、不得让插件纤维失败。**
- 只读：全程不调用 `update` / `replace` / `mutate`。

### 5.2 本插件消费的字段

| 字段 | 类型 | 用途 | 缺失时 |
| --- | --- | --- | --- |
| `routeKey` | string（字典键） | 路由唯一标识、目标寻址 | 不存在 |
| `displayName` | string? | 展示名 | 回落 `routeKey` |
| `apiKeyEnv` | string? | 凭据引用名（POSIX 标识符） | 该路由 `credential.ref = null`，测试返回 `MISSING_CREDENTIAL` |
| `api` | string? | 三协议之一 | 标记 `UNSUPPORTED_API`，可选中但测试必失败并给出说明 |
| `baseURL` | string? | 请求基址 | 标记 `MISSING_BASE_URL`，可选中但测试必失败并给出说明 |
| `models[]` | `{id, name?, contextWindow?, maxTokens?}` | 第三行模型按钮 | 该路由不贡献任何模型；若整组无模型，则该组不可测 |

其余字段（`compat`、`headers`、`transport`、`retryPolicy`、`timeoutMs`、`modelOverrides`、`defaultContextWindow` 等）本插件**不读取、不应用**，见 §2.2 第 7 条。

### 5.3 本机实测基准（2026-09-17 复核）

`C:\Users\pc\.dsh\settings.yaml` 的 `llm-pi-ai.providers` 当前为 **12 条路由**，归一化后得到 **6 个供应商组**、**7 个 (baseURL, api) 分组**。

**动态性要求（硬约束）**：组数、API 类型按钮数、路由数、模型并集**全部由配置在运行时动态得出**；下表数值只是**本机当前配置的期望值**，供验收比对，**不得硬编码**。用户随时会改 `settings.yaml`，硬编码会导致配置一变面板就错。每次 `GET /config` 重新读取并重算（§5.1）。

> **★「7」有歧义，必须按口径区分（t15 / t16 / t17 一律以此表为准）**
>
> | 指标 | 数值 | 口径 |
> | --- | --- | --- |
> | 供应商组（第一行按钮） | **6** | `llm-pi-ai.providers` 内、baseURL 去尾斜杠归一化后去重 |
> | API 类型按钮（第二行） | **7** | `llm-pi-ai.providers` 内、按 (归一化 baseURL, api) 去重 |
> | 路由按钮（第四行） | **12** | `llm-pi-ai.providers` 的条目总数 |
> | 全配置段 distinct **原始** baseURL 字符串 | 7 | **非本插件口径**，仅作歧义来源说明 |
>
> 两个「7」数值相同但含义完全不同，是本机配置的巧合：全配置段的原始 baseURL 去重恰好也是 7（因为 `describe-image.baseURL = https://happycodeai.com` 是**非 LLM provider**，只与 `llm-pi-ai.happycodeai.baseURL = https://happycodeai.com/` 差一个尾斜杠，归一化后合并成 1 组，7 减 1 得 6）。**判定基准永远是上表前三行**；任何按「全配置段原始字符串去重」得到的 7 都是错误口径（§5.1 已冻结扫描范围）。

**期望值对照基准（验收可直接逐条比对；全部为运行时动态推导的结果）**：

| 项 | 期望值 | 证据 / 说明 |
| --- | --- | --- |
| provider 数 | **12** | `llm-pi-ai.providers` 条目数 |
| 供应商组（去尾斜杠，仅 llm-pi-ai） | **6** | 下方 7 行明细按 baseURL 归并后为 6 个供应商 |
| API 类型按钮 | **7** | `ai.max66.xyz/v1` 贡献 2，其余 5 组各 1 |
| 路由按钮 | **12** | 与 provider 数一致 |
| `https://aihub.dog/v1` 路由 | **3** | `AIHUB_01_API_KEY`、`AIHUB_012_API_KEY`、`AIHUB_013_API_KEY`（三路由 baseURL/api/模型全同，仅密钥不同） |
| `https://www.xcmapi.com/v1` 路由 | **4** | `XCMAPI_GUOMO_KEY`、`API_TCVPS_K3TEST_API_KEY`、`API_TCVPS_006_API_KEY`、`API_TCVPS_008_API_KEY` |
| `http://ai.max66.xyz/v1` API 类型 | **2** | `anthropic-messages`（`AI_MAX66_API_KEY` / aimax66） + `openai-completions`（`AI_MAX66_API_KEY` / aimax66-open） |
| `openai-responses` 真实 provider | **0** | 本机无样本，只能 mock 覆盖（AC17） |

**协议真实覆盖度**（决定哪些路径能真机验证）：

| api | provider 数 | 验证方式 |
| --- | --- | --- |
| `openai-completions` | **10** | 可真机验证 |
| `anthropic-messages` | **2**（happycodeai、aimax66） | 可真机验证 |
| `openai-responses` | **0** | **仅 mock 验证**，不得写成「真机验证通过」（AC17） |

**凭据就绪度**（值不落任何输出）：12/12 provider 的 `apiKeyEnv` 在 `.credentials.yaml` 的 `refs:` 中有值；**0/12** 存在于进程环境。故 (a) 凭据解析必须走 §8.1 的 `credentials.resolve`（只读 `process.env` 会让 12/12 全 401，面板整体不可用）；(b) UI 的「密钥未配置」态**无法用本机真实配置触发**，只能用 mock/构造数据判定（AC9、AC10）。

| # | 供应商（归一化 baseURL） | API 类型 | 路由数 | 路由键 | 模型并集 |
| --- | --- | --- | --- | --- | --- |
| 1 | `https://www.xcmapi.com/v1` | `openai-completions` | 4 | xcmapi-guomo, api-tcvps-k3test, api-tcvps-006, api-tcvps-008 | glm-5.3-flash, deepseek-v4.1-flash, deepseek-v4.1-flash-expires-on-0910, deepseek-v4-flash, k3, gpt-5.6-sol |
| 2 | `https://happycodeai.com` | `anthropic-messages` | 1 | happycodeai | claude-opus-5 |
| 3 | `https://happycodeai.com/v1` | `openai-completions` | 1 | happycodeai-gpt | gpt-5.6-sol |
| 4 | `http://ai.max66.xyz/v1` | `anthropic-messages` | 1 | aimax66 | deepseek-v4.1-flash, deepseek-v4-flash |
| 5 | `http://ai.max66.xyz/v1` | `openai-completions` | 1 | aimax66-open | deepseek-v4-flash, deepseek-v4.1-flash |
| 6 | `http://max66.xyz/v1` | `openai-completions` | 1 | max66 | deepseek-v4.1-flash, deepseek-v4-pro |
| 7 | `https://aihub.dog/v1` | `openai-completions` | 3 | aihub-01, aihub-012, aihub-013 | gpt-5.6-sol, gpt-5.6-terra |

三条由本基准直接推出的判定依据：

1. 第 2 行与第 3 行证明「归一化只去尾斜杠」：`https://happycodeai.com/`（anthropic，无 `/v1`）与 `https://happycodeai.com/v1`（openai，带 `/v1`）是**两个不同的供应商组**。若实现裁剪或补全 `/v1`，这两组会错误合并。
2. 第 4 行与第 5 行是本机唯一「同一 baseURL 下存在两种 API 类型」的供应商：`http://ai.max66.xyz/v1` 的第二行必须有 **2 个按钮**（这是第二行存在的硬证据）。
3. 第四行「路由」的出现条件与实测候选见 §7.4（第 1 行 4 条与第 7 行 3 条是第四行存在的硬证据）。

**三种真实分组形态（实现与验收各取一例）**：

| 形态 | 实例 | 证明什么 |
| --- | --- | --- |
| 同 baseURL + 同 api + 多条路由 | `https://www.xcmapi.com/v1`（4 条）、`https://aihub.dog/v1`（3 条） | 第四行「路由」确有必要（触发条件是**分组作用域**的 `routeCount > 1`，见 §7.4） |
| 同 baseURL + **两种 api** | `http://ai.max66.xyz/v1`（anthropic + openai，各 1 条） | 第二行「API 类型」确有必要 |
| 归一化后仅差尾斜杠的相邻形态 | `https://happycodeai.com`（anthropic）vs `https://happycodeai.com/v1`（openai） | 归一化不得增删 `/v1` |

> 已知配置隐患（**仅提示，不阻断**）：第 4 行 `aimax66` 的 `api = anthropic-messages` 且 `baseURL` 以 `/v1` 结尾。按 §6.1 拼接规则，真实请求 URL 为 `http://ai.max66.xyz/v1/v1/messages`。宿主 `dsh-llm-pi-ai` 走同一 SDK，行为一致；本插件必须**如实复现**该 URL（而不是替用户修正），并在预览区给出 `ANTHROPIC_BASEURL_HAS_V1` 警告。

## 三协议完整规则表

本节全部结论已逐行核对官方 SDK 与 `@earendil-works/pi-ai` 源码，核对坐标见 §6.7。

### 6.1 URL 拼接（唯一实现，禁止各写一份）

三协议共用**同一条**拼接式（`openai` 与 `@anthropic-ai/sdk` 两个官方 SDK 的实现逐字相同）：

```js
new URL(baseURL + (baseURL.endsWith('/') && path.startsWith('/') ? path.slice(1) : path))
```

| 协议 | path | baseURL 是否自带 `/v1` | 示例（baseURL → 实际 URL） |
| --- | --- | --- | --- |
| `openai-completions` | `/chat/completions` | **必须自带** | 本机：`https://www.xcmapi.com/v1` → `https://www.xcmapi.com/v1/chat/completions` |
| `openai-responses` | `/responses` | **必须自带** | **示意（本机无 responses 路由，见 §5.3 / AC17）**：任何自带 `/v1` 的 baseURL → `<base>/responses` |
| `anthropic-messages` | `/v1/messages` | **不能自带**（SDK 自己加） | 本机：`https://happycodeai.com/` → `https://happycodeai.com/v1/messages` |

**关键不对称**：openai 系要求 baseURL 自带 `/v1`（SDK 默认 baseURL 就是 `https://api.openai.com/v1`）；anthropic 系要求 baseURL **不带** `/v1`（SDK 默认 baseURL 是 `https://api.anthropic.com`，路径里已经含 `/v1`）。同一个 baseURL 值在两个协议下会产生不同的最终 URL，这是本插件最需要如实呈现的事实。

**anthropic 的两种真实形态（本机两条 provider 正好各覆盖一种，实现与验收各取一例）**：

| 形态 | provider | baseURL | 最终 URL |
| --- | --- | --- | --- |
| 规范形态（单 `/v1`） | `happycodeai` | `https://happycodeai.com/`（无 `/v1`） | `https://happycodeai.com/v1/messages` |
| 配置怪癖（双 `/v1`） | `aimax66` | `http://ai.max66.xyz/v1`（**带** `/v1`） | `http://ai.max66.xyz/v1/v1/messages` |

**双 `/v1` 必须如实暴露、不得静默改写**：`aimax66` 是 `anthropic-messages` 却带 `/v1`，正确实现的终址就是 `/v1/v1/messages`。这不是 bug，是配置形态；本插件**只显示、不修正**——不得做「智能去重 `/v1`」，否则违反 §7.1 的归一化硬约束，并会让预览 URL 与真实请求 URL 不一致（AC4）。同时在预览区给出 `ANTHROPIC_BASEURL_HAS_V1` 警告（§7.5），由用户自行决定是否改配置。

有意偏差（记录在案，非缺陷）：宿主 `pi-ai` 的 anthropic 适配器调用 `client.beta.messages.create`，实际路径为 `/v1/messages?beta=true`；本插件探针走**稳定端点** `/v1/messages`，不携带 `beta` 查询参数。探针不依赖任何 beta 特性（无工具、无 thinking、无 mid-convo effort），同网关同鉴权，健康检查结论不受影响。

### 6.2 请求头

| 头 | `openai-completions` | `openai-responses` | `anthropic-messages` |
| --- | --- | --- | --- |
| `authorization` | `Bearer <key>` | `Bearer <key>` | — |
| `x-api-key` | — | — | `<key>` |
| `anthropic-version` | — | — | `2023-06-01` |
| `content-type` | `application/json` | `application/json` | `application/json` |
| `accept` | 流式 `text/event-stream`，非流式 `application/json` | 同左 | 同左 |

- 三协议均**不发送**除上表之外的鉴权与协议头；不发送 `anthropic-dangerous-direct-browser-access`。
- `anthropic-version` 固定 `2023-06-01`（与 SDK 常量一致）。
- 仅当 `apiKeyEnv` 解析成功时携带鉴权头；解析失败直接返回 `MISSING_CREDENTIAL`，**不发出未鉴权请求**。

### 6.3 请求体

公共部分：`model` = 所选 `modelId`；输出上限固定 `maxOutputTokens = 64`（不读取 `model.maxTokens`，保持探针与目录元数据解耦）；模板文本见 §6.4。

| 字段 | `openai-completions` | `openai-responses` | `anthropic-messages` |
| --- | --- | --- | --- |
| 系统提示位置 | `messages[0] = {role:"system", content:<systemPrompt>}` | 顶层 `instructions: <systemPrompt>` | 顶层 `system: <systemPrompt>`（字符串，非数组） |
| 用户消息 | `messages[1] = {role:"user", content:<userPrompt>}` | `input: [{role:"user", content:[{type:"input_text", text:<userPrompt>}]}]` | `messages: [{role:"user", content:<userPrompt>}]` |
| 输出上限字段 | `max_tokens: 64` | `max_output_tokens: 64` | `max_tokens: 64`（**必填**） |
| 流式开关 | `stream: true/false` | `stream: true/false` | `stream: true/false` |
| 流式专属 | `stream_options: {include_usage: true}` | — | — |
| 其他固定字段 | — | `store: false` | — |

`openai-responses` 的 `max_output_tokens` 若小于 16 会被上游拒绝，故取 64（高于该下限）。

### 6.4 测试消息模板

| 项 | 默认值 | 可覆盖 |
| --- | --- | --- |
| `systemPrompt` | `你是连通性探针。只输出 OK 两个大写字母，不要输出任何其他字符、标点或解释。` | `POST /test` 可选覆盖，长度 ≤ 2000 |
| `userPrompt` | `输出 OK` | `POST /test` 可选覆盖，长度 ≤ 2000 |
| `maxOutputTokens` | `64` | 否（插件配置项可改，默认 64） |
| `expectText` | `OK` | 否 |

严格校验规则：`responseText.trim() === expectText`（只做首尾空白归一化，`trim()` 覆盖空格、制表、换行）。大小写敏感、标点敏感、不接受任何附加内容。用户覆盖提示词后若模型不再回 `OK`，按严格校验失败记为 Slow，`layers.strict.detail` 中说明期望值。

### 6.5 响应解析与 token 字段

| 项 | `openai-completions` | `openai-responses` | `anthropic-messages` |
| --- | --- | --- | --- |
| 文本路径 | `choices[0].message.content` | `output[]` 中 `content[]` 各项 `type === "output_text"` 的 `.text` 拼接 | `content[]` 中 `type === "text"` 的 `.text` 拼接（本机样本为 `content[0].text`） |
| 结束原因 | `choices[0].finish_reason` | `status`（`completed` / `incomplete` / `failed`） | `stop_reason` |
| prompt token | `usage.prompt_tokens` | `usage.input_tokens` | `usage.input_tokens` |
| completion token | `usage.completion_tokens` | `usage.output_tokens` | `usage.output_tokens` |
| total token | `usage.total_tokens` | `usage.total_tokens` | 上游不提供，由 `input + output` 计算并置 `usage.totalComputed = true` |
| 缓存 token（可选展示） | `usage.prompt_tokens_details.cached_tokens` / `prompt_cache_hit_tokens` / `cached_tokens` | `usage.input_tokens_details.cached_tokens` | `usage.cache_read_input_tokens` / `cache_creation_input_tokens` |

### 6.6 流式规则

| 项 | `openai-completions` | `openai-responses` | `anthropic-messages` |
| --- | --- | --- | --- |
| 帧格式 | `data: <json>` 行，空行分隔 | `event: <type>` + `data: <json>` | `event: <type>` + `data: <json>` |
| 文本增量 | `choices[0].delta.content` | `response.output_text.delta` 事件的 `.delta` | `content_block_delta` 事件且 `delta.type === "text_delta"` 时的 `.delta.text` |
| 终止标记 | `data: [DONE]` | `response.completed`（或 `response.incomplete` / `response.failed`） | `message_stop` |
| usage 位置 | **必须**先发 `stream_options: {include_usage: true}`，否则流式下拿不到 usage；usage 出现在 `usage` 非空的帧（通常为 `[DONE]` 前的最后一帧） | `response.completed` 事件的 `response.usage`（`input_tokens` / `output_tokens` / `total_tokens`） | **跨事件累积**：`input_tokens` 来自 `message_start.message.usage`；`output_tokens` 来自 `message_delta.usage`。只在流末取一次会丢掉 `input_tokens` |
| 缺终止标记 | 判 `STREAM_NO_TERMINAL` | 同左（上游 SDK 亦会抛「stream ended before a terminal response event」） | 同左（上游 SDK 亦会抛「Anthropic stream ended before message_stop」） |
| 首增量耗时 | 首个携带文本增量的帧到达时刻 | 同左 | 同左 |

SSE 解析要求（三协议通用）：

1. **按字节缓冲 + 增量解码**：使用 `TextDecoder` 且 `{ stream: true }`（宿主先例为 `TextDecoderStream`）。**禁止**对每个 `Uint8Array` 直接 `toString()`——多字节 UTF-8 序列会跨 chunk 断开，中文会被切碎。
2. 按行切分时保留行缓冲，容忍 `\n` 与 `\r\n`；一次到达多条 `data:` 行时按 SSE 规范以空行作为事件边界。
3. 以 `:` 开头的行是注释，跳过；`event:` 与 `data:` 字段值的前导单空格按规范剥离。
4. 记录 `sseEventCount` 与 `sseEventTypes`（去重、按首现顺序），供诊断链与「原始响应」区展示。
5. 流式响应体同样受 §8.3 的字节上限约束；超限即中断并判 `RESPONSE_TOO_LARGE`。

### 6.7 源码核对坐标（实现与评审可直接复核）

| 结论 | 坐标 |
| --- | --- |
| openai SDK URL 拼接式 | `openai/client.mjs:282` |
| anthropic SDK URL 拼接式（逐字相同） | `@anthropic-ai/sdk/client.mjs:390` |
| openai 默认 baseURL 自带 `/v1` | `openai/client.mjs:134` |
| anthropic 默认 baseURL 不含 `/v1` | `@anthropic-ai/sdk/client.mjs:88` |
| `/chat/completions` | `openai/resources/chat/completions/completions.mjs` |
| `/responses` | `openai/resources/responses/responses.mjs` |
| `/v1/messages`（beta 变体为 `/v1/messages?beta=true`） | `@anthropic-ai/sdk/resources/messages/messages.mjs`、`.../resources/beta/messages/messages.mjs:39` |
| `anthropic-version: 2023-06-01` | `@anthropic-ai/sdk/client.mjs:838` |
| 流式必发 `stream_options.include_usage` | `pi-ai/dist/api/openai-completions.js:594-596` |
| openai usage 字段解析 | `pi-ai/dist/api/openai-completions.js:1178-1206` |
| openai 系统提示进 `messages` | `pi-ai/dist/api/openai-completions.js:909-912` |
| responses 终止事件与缺终止抛错 | `pi-ai/dist/api/openai-responses-shared.js:637-657` |
| responses 文本增量与 usage | `pi-ai/dist/api/openai-responses-shared.js:520`、`:440-450` |
| responses `max_output_tokens` 下限 16 | `pi-ai/dist/api/openai-responses.js:16-17,236` |
| anthropic `max_tokens` 必填 | `pi-ai/dist/api/anthropic-messages.js:797` |
| anthropic `system` 为顶层字段 | `pi-ai/dist/api/anthropic-messages.js:803-825` |
| anthropic `message_start` 提供 `input_tokens` | `pi-ai/dist/api/anthropic-messages.js:409-425` |
| anthropic `message_delta` 更新 usage 且保留 `message_start` 的 `input_tokens` | `pi-ai/dist/api/anthropic-messages.js:556-575` |
| anthropic 以 `message_stop` 终止，缺则抛错 | `pi-ai/dist/api/anthropic-messages.js:316,327` |
| 密钥可发送性校验：`LEGAL_API_KEY = /^[\x21-\x7E]+$/`、先 trim、`empty` / `illegalCharacters` 两种 reason | `dsh-llm/lib/index.js:472,484-496`、`dsh-llm/lib/types/api-key.js` |
| `assertUsableApiKey(raw, pkg, ref)` 封装该校验并抛 `INVALID_CREDENTIAL` | `dsh-llm/lib/index.js:1607-1608`（定义）、`dsh-llm/lib/index.js:120-121`（再导出） |
| 宿主凭据解析三元语义：`credentials !== void 0 ? resolve() : launchEnvironmentOf().get()`，命中后过 `assertUsableApiKey` | `dsh-llm-pi-ai/lib/index.js:2595-2600` |

## 四层选择器：数据流与分组算法

### 7.1 分组算法（宿主侧，纯函数）

```
输入：providers: Record<routeKey, Profile>          // 仅 llm-pi-ai.providers，见 §5.1
步骤 0  范围：只遍历上述字典；不读其他命名空间/配置段
步骤 1  归一化：normalize(baseURL) = baseURL.replace(/\/+$/, "")      // 仅去尾部一个或多个 /
        ★ 硬约束：不得补全、不得裁剪、不得识别或去重 /v1 段；不做小写化、不去除默认端口、
          不做 URL 解析归一（保持原字符串除尾部 / 外逐字不变）
步骤 2  供应商组：按 normalize(baseURL) 归并，保持首次出现顺序
步骤 3  分组：在每个供应商组内按 api 值再归并，得到 (供应商, api) 单元；api 缺失或非三协议者仍成组，api 值原样保留（如 null 或 "azure-openai-responses"）
        ★ 路由去重只在**同一 api 内**进行，**绝不跨 api 去重**：同一 baseURL 下 anthropic 与 openai 是两条独立路由槽位。
          本机实证：distinct apiKeyEnv = 11，但路由槽位 = 12 —— 因为 `AI_MAX66_API_KEY` 被
          `http://ai.max66.xyz/v1` 的 anthropic 与 openai **两条路由共用**。跨 api 去重会丢掉一个真实测试目标。
步骤 4  模型并集：在分组内按 modelId 去重（保留首个出现项的名称与容量），每个模型记录 routeKeys = 该分组内声明了此 modelId 的路由键列表（按配置顺序）
        ★ 口径钉死：模型行按 **modelId 去重**显示（distinct），**不是**按路由累计的 raw 计数。
          本机实证（xcmapi 分组）：去重 **6** 个模型；按路由累计 raw = **7**（因 `gpt-5.6-sol` 在
          api-tcvps-006 / api-tcvps-008 两条路由各出现一次）。**验收取去重值 6**；raw 计数不得作为断言口径。
        ★ `models[].routeKeys` 是级联的唯一依据（见 §7.6）：它同时表达「该模型由哪些路由提供」，
          因此第四行候选集恒为该列表，不可能出现「模型 × 路由」的无效组合。
步骤 5  预览：对每个分组用 §6.1 的**同一个**拼接函数产出 previewUrl，并生成 requestPreview（§11.1）
输出：providers[] + groups[]（结构见 §11.1）
```

**归一化的唯一反例（回归用例，t16 必测）**：`happycodeai`（anthropic，`https://happycodeai.com/` 带尾斜杠）与 `happycodeai-gpt`（openai，`https://happycodeai.com/v1`）必须是**两个不同的供应商组**。若归一化裁剪或补全 `/v1`，这两组会被**错误合并**，anthropic 与 openai 混进同一个供应商按钮下。等价地，`https://happycodeai.com` 与 `https://happycodeai.com/v1` 归一化后**必须仍不相等**。

顺序稳定性要求：同一份配置连续两次调用 `GET /config`，`providers[]`、`groups[]`、`models[]`、`routes[]` 的顺序必须完全一致（按配置声明顺序），以便前端用稳定 id 做选择保持。

稳定 id：`providerId = sha1(baseURLNormalized).slice(0, 12)`；`groupId = providerId + ":" + api`；`modelKey = groupId + "#" + modelId`。id 只用于前端选择保持与 DOM key，不参与协议逻辑。

### 7.2 四行按钮的数据流

| 行 | 数据来源 | 交互 | 默认选中 |
| --- | --- | --- | --- |
| ① 供应商 | `providers[]`，按钮文本为 host + 路径（去尾斜杠），`title` 为完整 baseURL，角标显示路由数 | 单选；切换后清空 ②③④ 的选择 | `providers[0]` |
| ② API 类型 | `providers[i].groupIds` 对应的 `groups[].api`，按钮文本为协议名 | 单选；切换后清空 ③④ | 所选供应商的第一个分组 |
| ③ 模型 | `groups[g].models[]`，按钮文本为 `name ?? id`，角标显示候选路由数 | 单选；切换后重算 ④ | 所选分组的 `models[0]` |
| ④ 路由 | **渲染条件**：`groups[g].routeCount > 1`（**分组作用域**，§7.4）；**候选集**：`groups[g].models[m].routeKeys` 对应的 `groups[g].routes[]`（按模型收窄，候选数为 1 时**仍渲染**），按钮文本为 `displayName ?? routeKey`，角标显示密钥引用名与配置状态 | **仅当分组路由数 > 1 时渲染该行**；单选 | `routeKeys[0]` |

四行均始终渲染标题；① ② ③ 恒有内容（分组无模型时第三行显示「该分组未声明模型」且禁用发送）。④ 的条件渲染是唯一动态行。

### 7.3 选择状态的保持

- 面板以稳定 id 记录当前选择；`GET /config` 刷新后，若原 id 仍存在则保持选择，否则回落到默认选中并提示「配置已变化，已回到默认选择」。
- **级联不变式校验（防御性，§7.6）**：任何时刻所选 `routeKey` 必须属于当前所选模型的 `routeKeys`。`GET /config` 刷新导致配置变化时，若原 `routeKey` 已不在新模型的 `routeKeys` 中，**必须回落到该模型的 `routeKeys[0]`**（而不是保留一个不可解析的路由）。发送前宿主侧再做一次等价校验：`routeKey` 未声明该 `modelId` 时返回 400 + `UNKNOWN_MODEL`（§11.2），**不发出请求**。
- 「发送测试」按钮的可用条件：① ② ③ ④ 均有确定值 **且** 当前状态键不是 `testing`。缺任一维时按钮禁用，`title` 说明缺失项。

### 7.4 第四行「路由」的出现条件与实测候选

**精确规则（分组作用域）**：第四行的出现条件是**所选分组自身的路由条数** `groups[g].routeCount > 1`；`= 1` 时该唯一路由自动成为目标，第四行不渲染。判定只看分组，**与当前选了哪个模型无关**。

**依据（任务书原文）**：任务书的条件是「同 baseURL+api 下**多条路由**时第四行才出现」——这是**分组作用域**的判据；判定只看分组路由条数，**不**按「当前所选模型有几个候选」来决定是否渲染。

选定模型后，第四行的**候选按钮集**再按模型收窄为 `models[m].routeKeys`（该分组内声明了所选 `modelId` 的路由键）。

**边界条款（不可省略）**：分组 `routeCount > 1` 但所选模型只被 1 条路由声明时，第四行**仍然渲染**，只有 1 个候选按钮且处于选中态——**不得因候选数为 1 而隐藏第四行**（隐藏条件只有分组路由数一个）。这向用户如实反映「该模型只在此一条路由上提供」。

判据与取值对照（实现须取 `groups[].routeCount` 决定**是否渲染**，取 `models[].routeKeys` 决定**列出哪几条**）：

| 判据 | 决定 | 本机 xcmapi 分组示例 |
| --- | --- | --- |
| `groups[g].routeCount > 1` | 第四行**是否渲染** | 4 > 1 → **恒渲染**（任何模型下都渲染） |
| `models[m].routeKeys` | 第四行**列出哪几条** | 选 `gpt-5.6-sol` → 2 条（api-tcvps-006, api-tcvps-008）；选 `glm-5.3-flash` → 1 条（xcmapi-guomo，**仍渲染**） |

本机实测（按上述规则）：

| 供应商 | API 类型 | 分组路由数 | 第四行是否出现 | 各模型下的候选按钮数 |
| --- | --- | --- | --- | --- |
| `https://aihub.dog/v1` | `openai-completions` | 3 | **出现**（任意模型） | `gpt-5.6-sol` → 3；`gpt-5.6-terra` → 3 |
| `https://www.xcmapi.com/v1` | `openai-completions` | 4 | **出现**（任意模型） | `gpt-5.6-sol` → **2**；`glm-5.3-flash` / `k3` / `deepseek-v4.1-flash` / `deepseek-v4-flash` / `deepseek-v4.1-flash-expires-on-0910` → **各 1（仍渲染）** |
| 其余 5 个分组 | 各自 | 1 | 不出现 | 各模型均 1（该路由自动成为目标） |

**AC14 验收口径以本节为准**：xcmapi（4 条）与 aihub（3 条）两个分组**在任意模型下第四行都出现**；其余 5 个分组不出现；且 xcmapi 内候选按钮数随模型变化：选 `gpt-5.6-sol` 为 **2 个**、选 `glm-5.3-flash` 为 **1 个**（**第四行仍渲染，不得隐藏**）。

### 7.5 分组警告（非阻断）

| code | 触发条件 | 面板展示位置 |
| --- | --- | --- |
| `ANTHROPIC_BASEURL_HAS_V1` | `api === "anthropic-messages"` 且 `baseURLNormalized.endsWith("/v1")` | 预览区警示条：该 baseURL 会拼成 `/v1/v1/messages`；anthropic 系 baseURL 不应带 `/v1` |
| `OPENAI_BASEURL_MISSING_V1` | `api` 为 openai 系且 `baseURLNormalized` 不以 `/v1` 结尾 | 预览区提示条：openai 系 baseURL 通常自带 `/v1`；若上游返回 404，核对此项 |
| `UNSUPPORTED_API` | `api` 不属于三协议 | 预览区警示条：该协议不在支持范围，测试将失败 |
| `MISSING_BASE_URL` | 路由无 `baseURL` | 预览区警示条 |

本机当前命中：第 4 行 `aimax66`（`ANTHROPIC_BASEURL_HAS_V1`）。这些是提示，**不阻断**测试——用户仍可点击发送，用真实结果确认判断。

### 7.6 四行不是自由笛卡尔积（级联语义，设计决策）

**决策（唯一实现口径）**：四层选择器采用 **(a) 级联过滤**——后一行的选项恒由前行收窄，**禁止**四行各自独立维护选中值。

**为什么必须级联（实测证据）**：同 baseURL + 同 api 下，多条路由的模型集**可以互不相同**。`https://www.xcmapi.com/v1` 的 4 条路由：

| routeKey | apiKeyEnv | models |
| --- | --- | --- |
| `xcmapi-guomo` | `XCMAPI_GUOMO_KEY` | glm-5.3-flash, deepseek-v4.1-flash, deepseek-v4.1-flash-expires-on-0910 |
| `api-tcvps-k3test` | `API_TCVPS_K3TEST_API_KEY` | deepseek-v4-flash, k3 |
| `api-tcvps-006` | `API_TCVPS_006_API_KEY` | gpt-5.6-sol |
| `api-tcvps-008` | `API_TCVPS_008_API_KEY` | gpt-5.6-sol |

模型行去重后 6 个 × 路由行 4 个 = **24 个自由组合**，其中**只有 7 个真实存在**：

| 模型 | 有效路由数 |
| --- | --- |
| glm-5.3-flash | 1/4（仅 `XCMAPI_GUOMO_KEY`） |
| deepseek-v4.1-flash | 1/4（仅 `XCMAPI_GUOMO_KEY`） |
| deepseek-v4.1-flash-expires-on-0910 | 1/4（仅 `XCMAPI_GUOMO_KEY`） |
| deepseek-v4-flash | 1/4（仅 `API_TCVPS_K3TEST_API_KEY`） |
| k3 | 1/4（仅 `API_TCVPS_K3TEST_API_KEY`） |
| gpt-5.6-sol | **2/4**（`API_TCVPS_006_API_KEY`、`API_TCVPS_008_API_KEY`） |

全量统计：**30 个「模型 × 路由」组合中 17 个（57%）解析不到任何 provider**。
⚠️ **关键陷阱**：`https://aihub.dog/v1` 分组是 **6/6 全有效**——**只测 aihub 会误判「无问题」**。验收必须包含 xcmapi 分组（§AC23）。

**若不做级联会怎样（这是本决策的理由）**：用户可选出 `glm-5.3-flash` + `API_TCVPS_006_API_KEY` 这种**不存在**的组合 → 预览区拼不出真实目标 → 点击测试后发出语义错误的请求 → 错误人话化给出**误导性归因**（用户以为是供应商故障，实为自己选了不存在的组合）。本插件的定位是「如实反映配置」，不是「让用户构造任意请求」。

**级联的精确规则（实现必须同时满足）**：

| 行 | 级联行为 |
| --- | --- |
| ① 供应商 | 切换后清空 ②③④ 的选择，并落到该供应商下**第一个有模型的**分组 |
| ② API 类型 | 候选 = 所选供应商的 `groupIds`；切换后清空 ③④ |
| ③ 模型 | 候选 = 所选分组的 `models[]`（**按 modelId 去重**，见 §7.1 步骤 4）；切换后重算 ④ |
| ④ 路由 | 候选 **恒为** `models[m].routeKeys`（按配置顺序）；**不是**该分组的全部 `routes[]` |

**不变式（AC23 逐条断言）**：对任意可达的 (供应商, api, 模型, 路由) 四元组，**该路由必定声明了该模型**——即 `models[m].routeKeys` 恒包含所选 `routeKey`。换言之：**面板无法选中一个解析不到 provider 的组合**。这条不变式由「第四行候选集 = `routeKeys`」直接保证，实现**不得**改为「第四行列出分组全部路由」。

**UI 表现（无歧义补充）**：
- 级联下**不存在**无效组合，故**不需要**「该模型不在所选路由的配置中」这类错误态；预览区恒显示一个可解析的目标。
- 第三行角标显示候选路由数（`models[].routeCount`）；第四行的渲染只看分组路由数 `groups[].routeCount > 1`（§7.4）——**候选数为 1 时仍然渲染**（只列 1 个按钮），只有分组路由数为 1 时才整行不渲染。
- 若某分组**无任何模型**，第三行显示「该分组未声明模型」并禁用发送（§7.2）。

> 注：本决策取代早前「自由选择 + 校验/拦截」的备选方案 (b)/(c)。(a) 同时天然消除了「模型行是否跨路由去重」的歧义——去重后每个模型自带 `routeKeys`，语义自洽。

## 请求执行、流式解析与安全基线

### 8.1 密钥解析（硬要求，blocker 级）

**只读进程环境变量会让本机 12/12 路由全部鉴权失败**：12 个 `apiKeyEnv` 名在进程 / User / Machine 三个环境作用域均不存在，值只存在于 `C:\Users\pc\.dsh\.credentials.yaml` 的 `refs:` 段。解析顺序**必须**照抄宿主 `dsh-llm-pi-ai/lib/index.js:2595-2600`：

```js
const credentials = ctx.get("credentials");
const hit = credentials !== undefined
  ? (await credentials.resolve(credentialRef(ref)))?.value   // 首选：凭据服务
  : launchEnvironmentOf(ctx).get(ref)?.value;                // 兜底：启动环境快照
if (hit === undefined || hit.length === 0) {
  // 人话化：该供应商未配置密钥（<apiKeyEnv>）
  // code = MISSING_CREDENTIAL，不发请求
}
```

- 使用 `credentialRef()` 前先判断引用名合法性（POSIX 标识符），非法名直接判 `MISSING_CREDENTIAL` 并给出「apiKeyEnv 不是合法环境变量名」说明。
- **解析语义是三元表达式，不是「依次尝试」**（宿主实测语义，见下方代码）：当 `credentials` 服务**存在**但 `resolve()` 返回 `undefined` 时，**不会**再回退查环境快照——回退只在 `credentials` 服务**整体缺失**（`ctx.get("credentials") === undefined`）时发生。实现必须保持这一语义，不得写成 `a || b` 的链式兜底。
- 解析成功后必须**再过一次可发送性校验**（对照宿主 `usableProbeKey()` / `assertUsableApiKey()` / `normalizeApiKey()`，见下方精确规则）。不合法判 `INVALID_CREDENTIAL`，**不发请求**（否则 `fetch` 会抛 ByteString `TypeError`，被误报成网络错误）。
- **可发送性校验的精确规则**（与宿主 `dsh-llm` 实现逐字对齐，勿自行放宽）：
  1. **先静默 `trim()`**（首尾空白只有一种读法，不报错）；
  2. `trim` 后为空 → `reason = "empty"`（人话化：「密钥为空」）；
  3. 不匹配 `LEGAL_API_KEY = /^[\x21-\x7E]+$/` → `reason = "illegalCharacters"`（人话化：「密钥含 HTTP 头无法承载的字符」）。
  注意字符类下界是 **`\x21`（`!`）而非 `\x20`**——**空格不在合法集内**（`trim` 只处理首尾，内部空格属非法字符）。两个 `reason` 取值必须原样使用 `empty` / `illegalCharacters`，供 AC9 分别断言。
- 每次测试**重新解析**，不跨请求缓存密钥；解析结果只存在于本次请求的局部作用域。
- 面板与记录中只出现 `apiKeyEnv` 引用名与「已配置 / 未配置」状态，**永不出现值**。

### 8.2 超时

- 用 `AbortController` 实现总超时，默认 `hardTimeoutMs = 60000` 毫秒（插件配置可调，范围 1000–600000）。
- 超时触发 `controller.abort()`，捕获到 `AbortError` 后判 `TIMEOUT`，记录 `latencyMs` 为实际经过时间。
- 流式请求的超时是**总时长**超时，不是空闲超时；v1 不实现空闲超时（列入非目标）。
- 面板**不得**自行判定超时：Testing 状态只在收到宿主响应或请求失败时结束。

### 8.3 响应体上限

- 默认 `maxResponseBytes = 4 * 1024 * 1024`（4 MiB），与宿主 `discoverModels()` 先例一致（`dsh-llm-pi-ai/lib/index.js:2142`）。
- 两段式执行：先查 `content-length`，声明值超限立即 `body.cancel()` 并判 `RESPONSE_TOO_LARGE`（不传输）；再在累计读取中二次校验实际字节数，超限即中断。
- 上限同时约束流式与非流式。截断后的展示文本另有更小的展示上限（§10.3）。

### 8.4 记录脱敏（零泄漏硬要求）

`dsh-credentials` 的 `describe()` / `listRecords()` 是 **never-the-value** 语义：任何 `sk-` 明文都不得出现在**前端 payload、日志、状态文件、错误消息**这四个面上。本插件不写状态文件（§2.2 第 4 条 / §12.2），故第三个面由「不存在此类文件」保证。

在写入 RingBuffer、返回 HTTP 响应、写日志之前，对记录对象做一次统一**清洗**：

1. 本次解析出的密钥字符串若出现在任何字符串字段中（网关回显、错误体、请求回显），替换为 `***`；
2. `requestHeaders` 中的鉴权头值固定渲染为 `Bearer ***` 或 `***`（不区分是否解析成功）；
3. `requestBodyPreview` 不含密钥（请求体本就不带密钥，此条为防御）；
4. 日志只打印 `routeKey`、`modelId`、`api`、`httpStatus`、`latencyMs`、`status`，**不打印**密钥、请求头原文、响应体全文。

## 状态机与三层诊断链

### 9.1 状态机

```
untested ──点击「发送测试」──▶ testing ──宿主返回──▶ healthy | slow | failed
   ▲                                                        │
   └──────────── 切换选择 / 清空记录 / 配置刷新 ──────────────┘
```

- `untested`：该状态键从未测试（含刚切换过选择）。
- `testing`：请求在飞。面板禁用发送按钮、显示递增的已耗时、`aria-busy="true"`。
- `healthy`：三层全 pass 且 `latencyMs ≤ slowMs`。
- `slow`：未 Failed，且 `latencyMs > slowMs` 或严格校验失败（两者可同时成立）。
- `failed`：API 层失败或模型层失败。

判定优先级（宿主侧唯一实现，客户端不重算）：**Failed > Slow > Healthy**。`status` 只取 `healthy | slow | failed` 三个小写值；`untested` 与 `testing` 是客户端本地状态。

`slowMs` 默认 `15000` 毫秒（插件配置可调，范围 100–600000），随 `GET /config` 的 `thresholds.slowMs` 下发，面板仅用于展示「超出阈值」标注，不参与判定。

### 9.2 三层诊断链

`layers` 为固定三键对象，顺序 `api → model → strict`；每层结构 `{ status, label, detail, code }`。

| 层 | `label`（宿主给中文，客户端原样渲染） | pass 条件 | fail 时的 `code` |
| --- | --- | --- | --- |
| `api` | `API 请求` | 完成 DNS / TCP / TLS / 收到 HTTP 2xx / 响应体在 4 MiB 内 | `DNS_FAILED`、`CONNECTION_REFUSED`、`CONNECTION_RESET`、`TLS_ERROR`、`TIMEOUT`、`HTTP_401`…`HTTP_5XX`、`RESPONSE_TOO_LARGE`、`MISSING_CREDENTIAL`、`INVALID_CREDENTIAL`、`MISSING_BASE_URL`、`UNSUPPORTED_API` |
| `model` | `模型响应` | 从响应体（或 SSE 流）按 §6.5 / §6.6 提取到**非空**文本，且收到协议规定的终止标记 | `BAD_RESPONSE_JSON`、`MISSING_RESPONSE_FIELD`、`EMPTY_RESPONSE`、`STREAM_NO_TERMINAL`、`STREAM_PARSE_ERROR` |
| `strict` | `严格校验` | `responseText.trim() === expectText` | `STRICT_MISMATCH` |

`status` 取值：`pass` | `fail` | `skip`。上游层 fail 时，下游层一律 `skip`（`detail` 说明「上游层未通过，本层未执行」），例如 API 层 401 时 `model` 与 `strict` 均为 `skip`。

`detail` 为**中文人话化说明**，由宿主生成，客户端原样渲染（避免中文文案两端维护）。示例：

```
api:    pass  "已收到 HTTP 200，响应体 312 字节"
model:  pass  "提取到模型文本（12 个字符），结束原因 stop"
strict: fail  "响应文本为「OK！」，与期望值「OK」不完全一致"
```

### 9.3 降级规则（不可改）

- **严格校验失败 → Slow，绝不 Failed**：模型答得不对不等于链路不通。
- **超时 → Failed**（`TIMEOUT`）：`latencyMs` 记录实际经过时间。
- **HTTP 非 2xx → Failed**：HTTP 状态原样展示。
- **2xx 但无文本内容 → Failed**（模型层失败）。
- **流式未收到终止标记 → Failed**（模型层失败），已累积的文本仍展示在 `responseText`。
- **耗时超阈值但三层全 pass → Slow**（`reasons` 含 `slow-latency`）。

`reasons` 数组取值：`slow-latency`、`strict-mismatch`。Healthy 时为 `[]`。Failed 时记录失败层的 code，`reasons` 可为空数组。

## 错误映射表（错误处理）

### 10.1 映射表

`error` 对象结构：`{ code, title, hint, httpStatus, raw }`。`title` 是结论，`hint` 是下一步动作，均为中文。`raw` 为原始错误信息（已脱敏，≤ 1000 字符）。

| 触发 | `code` | `title` | `hint` |
| --- | --- | --- | --- |
| DNS 解析失败（`ENOTFOUND` / `EAI_AGAIN`） | `DNS_FAILED` | 域名解析失败，请求未发出 | 核对 Base URL 的主机名拼写；确认本机 DNS 与外网可达 |
| 连接被拒（`ECONNREFUSED`） | `CONNECTION_REFUSED` | 目标端口拒绝连接 | 确认服务端在运行、端口与协议（http / https）与配置一致 |
| 连接被重置（`ECONNRESET` / `EPIPE`） | `CONNECTION_RESET` | 连接被对端中断 | 链路或中间网关中断；稍后重试一次以区分偶发与常态 |
| TLS 握手失败（`CERT_HAS_EXPIRED`、`DEPTH_ZERO_SELF_SIGNED_CERT`、`UNABLE_TO_VERIFY_LEAF_SIGNATURE`、`ERR_TLS_*`） | `TLS_ERROR` | TLS 握手失败（证书或协议版本） | 检查证书是否过期、是否自签；确认 Base URL 用的是 `https` |
| `AbortError`（超时） | `TIMEOUT` | 请求超过设定时限未完成 | 提高超时或换非流式；确认上游未限流 |
| HTTP 401 | `HTTP_401` | 鉴权失败：密钥被拒绝 | 核对密钥是否有效、是否过期；确认密钥与协议匹配（anthropic 的 key 不能用于 openai 端点，反之同理） |
| HTTP 403 | `HTTP_403` | 无权访问该资源 | 密钥缺少该模型或该路径的权限、被风控、或需要 IP 白名单 |
| HTTP 404 | `HTTP_404` | 路径不存在：URL 拼错或路径后缀不符 | 核对 Base URL 后缀：openai 系必须自带 `/v1`（缺少时会请求 `/chat/completions` 而 404）；anthropic 系不能带 `/v1`（多带时会请求 `/v1/v1/messages`）。面板已按所选协议给出对应警示 |
| HTTP 405 | `HTTP_405` | 该地址不接受 POST | Base URL 指向了非 API 路径（网页地址或文档地址） |
| HTTP 408 | `HTTP_408` | 上游报告请求超时 | 稍后重试；确认网关侧超时配置 |
| HTTP 413 | `HTTP_413` | 请求体过大被拒 | 本插件请求体极小；该错误说明 Base URL 指向了其他服务 |
| HTTP 429 | `HTTP_429` | 触发上游限流 | 稍后重试；检查该密钥的配额与并发占用 |
| HTTP 5xx（500/502/503/504 等） | `HTTP_5XX` | 上游服务端错误 | 网关故障或模型不可用；稍后重试，持续失败则联系供应商 |
| 其他 HTTP 非 2xx | `HTTP_ERROR` | 上游返回非预期状态 | 查看原始响应体定位原因 |
| 2xx 但响应体不是合法 JSON | `BAD_RESPONSE_JSON` | 响应不是 JSON，疑似被网关拦截 | 查看原始响应体；确认该地址提供的是所选协议 |
| 2xx 且 JSON 合法但缺少协议字段 | `MISSING_RESPONSE_FIELD` | 响应结构不符合该协议 | 核对所选 API 类型与上游实际协议是否一致 |
| 2xx 但提取到的文本为空 | `EMPTY_RESPONSE` | 请求成功但模型没有返回文本 | 上游返回了空内容或被内容策略拦截；查看原始响应体 |
| 流式结束但缺终止标记 | `STREAM_NO_TERMINAL` | 流被提前关闭 | 网关不支持流式或中途断开；改用非流式核对 |
| 流式帧解析异常 | `STREAM_PARSE_ERROR` | 流式帧无法解析 | 查看原始事件摘要；确认上游返回的是标准 SSE |
| 响应体超过 4 MiB | `RESPONSE_TOO_LARGE` | 响应体超过大小上限 | 该地址返回的内容疑似网页或文件，而非模型响应 |
| 未配置密钥 | `MISSING_CREDENTIAL` | 该供应商未配置密钥 | 在模型设置页填写 `<apiKeyEnv>` 指向的密钥，或在环境变量中提供 |
| 密钥含不可发送字符 | `INVALID_CREDENTIAL` | 密钥含 HTTP 头无法承载的字符 | 只粘贴密钥原文，不要带引号、空格或换行 |
| `api` 缺失或不属于三协议 | `UNSUPPORTED_API` | 该路由的协议不在支持范围 | 该路由声明的是 `<api 原值>`；本插件只测三种协议 |
| 路由无 `baseURL` | `MISSING_BASE_URL` | 该路由未配置 Base URL | 在模型设置页补齐 Base URL |
| 同目标已有测试在飞 | `TEST_IN_FLIGHT` | 该目标正在测试中 | 等待当前测试返回（HTTP 409） |
| 配置命名空间不可用 | `SETTINGS_UNAVAILABLE` | 未读取到 llm-pi-ai 配置 | 确认 llm-pi-ai 插件已加载、命名空间已注册；点「重新加载」 |

### 10.2 错误对象的两处落点

1. `POST /test` 返回的 `TestResult.error`（HTTP 状态仍为 200，测试失败是数据不是传输错误）；
2. 请求本身不合法时（未知 `routeKey`、未知 `modelId`、body 非法）返回 HTTP 4xx + `{ ok: false, error: { code, message } }`，其中 `code` 取 `BAD_REQUEST` / `UNKNOWN_ROUTE` / `UNKNOWN_MODEL` / `TEST_IN_FLIGHT`。

### 10.3 展示截断

| 字段 | 上限 | 超出行为 |
| --- | --- | --- |
| `responseRaw` | 8192 字符 | 截断并置 `truncated = true` |
| `requestBodyPreview` | 4000 字符 | 截断并置 `truncated = true` |
| `error.raw` | 1000 字符 | 截断 |
| 流式事件摘要 | 每类事件保留首个 `data` 样本，总长 ≤ 8192 字符 | 截断 |

## 宿主 HTTP 端点契约

统一前缀 `/api/model-health`。全部响应头：`content-type: application/json; charset=utf-8`、`cache-control: no-store`。路由注册方式照抄 guard 先例：`ctx.get("webServer")` 惰性获取 + `ctx.on("internal/service", ...)` 补挂 + `ctx.effect(() => webServer.register({ kind: "exact", path, handler }))`；`webServer` 缺失时只告警，**不让插件纤维失败**。

### 11.1 `GET /api/model-health/config`

```json
{
  "ok": true,
  "pluginVersion": "0.1.0",
  "generatedAt": 1789655281628,
  "source": { "namespace": "llm-pi-ai", "available": true, "providerCount": 12 },
  "thresholds": { "slowMs": 15000, "hardTimeoutMs": 60000, "maxResponseBytes": 4194304 },
  "templates": { "systemPrompt": "你是连通性探针。…", "userPrompt": "输出 OK", "maxOutputTokens": 64, "expectText": "OK" },
  "defaults": { "stream": false, "maxRecords": 50 },
  "providers": [
    {
      "id": "p1a2b3c4d5e6",
      "baseURL": "https://happycodeai.com/",
      "baseURLNormalized": "https://happycodeai.com",
      "displayHost": "happycodeai.com",
      "displayLabel": "happycodeai.com",
      "apiCount": 1,
      "routeCount": 1,
      "groupIds": ["p1a2b3c4d5e6:anthropic-messages"]
    },
    {
      "id": "bac72f37364c",
      "baseURL": "http://ai.max66.xyz/v1",
      "baseURLNormalized": "http://ai.max66.xyz/v1",
      "displayHost": "ai.max66.xyz",
      "displayLabel": "ai.max66.xyz/v1",
      "apiCount": 2,
      "routeCount": 2,
      "groupIds": ["bac72f37364c:anthropic-messages", "bac72f37364c:openai-completions"]
    }
  ],
  "groups": [
    {
      "id": "p1a2b3c4d5e6:anthropic-messages",
      "providerId": "p1a2b3c4d5e6",
      "api": "anthropic-messages",
      "apiSupported": true,
      "previewUrl": "https://happycodeai.com/v1/messages",
      "routeCount": 1,
      "warnings": [],
      "models": [
        {
          "modelKey": "p1a2b3c4d5e6:anthropic-messages#claude-opus-5",
          "id": "claude-opus-5",
          "name": "claude-opus-5",
          "contextWindow": 1000000,
          "maxTokens": 256000,
          "routeKeys": ["happycodeai"],
          "routeCount": 1
        }
      ],
      "routes": [
        {
          "routeKey": "happycodeai",
          "displayName": "happycodeai",
          "modelIds": ["claude-opus-5"],
          "credential": { "ref": "HAPPYCODEAI_API_KEY", "configured": true, "source": "file", "writable": false }
        }
      ],
      "requestPreview": {
        "nonStream": {
          "method": "POST",
          "url": "https://happycodeai.com/v1/messages",
          "headers": {
            "content-type": "application/json",
            "accept": "application/json",
            "x-api-key": "<发送时解析>",
            "anthropic-version": "2023-06-01"
          },
          "body": { "model": "claude-opus-5", "max_tokens": 64, "system": "你是连通性探针。…", "messages": [{ "role": "user", "content": "输出 OK" }], "stream": false }
        },
        "stream": { "…": "同上，stream=true，accept=text/event-stream" }
      }
    },
    {
      "id": "bac72f37364c:anthropic-messages",
      "providerId": "bac72f37364c",
      "api": "anthropic-messages",
      "apiSupported": true,
      "previewUrl": "http://ai.max66.xyz/v1/v1/messages",
      "routeCount": 1,
      "warnings": [{ "code": "ANTHROPIC_BASEURL_HAS_V1", "message": "该 Base URL 以 /v1 结尾，anthropic 系会拼成 /v1/v1/messages；anthropic 系 baseURL 不应带 /v1" }],
      "models": [
        {
          "modelKey": "bac72f37364c:anthropic-messages#deepseek-v4.1-flash",
          "id": "deepseek-v4.1-flash",
          "name": "deepseek-v4.1-flash",
          "contextWindow": 1000000,
          "maxTokens": 256000,
          "routeKeys": ["aimax66"],
          "routeCount": 1
        }
      ],
      "routes": [
        {
          "routeKey": "aimax66",
          "displayName": "aimax66",
          "modelIds": ["deepseek-v4.1-flash", "deepseek-v4-flash"],
          "credential": { "ref": "AI_MAX66_API_KEY", "configured": true, "source": "file", "writable": false }
        }
      ],
      "requestPreview": {
        "nonStream": {
          "method": "POST",
          "url": "http://ai.max66.xyz/v1/v1/messages",
          "headers": {
            "content-type": "application/json",
            "accept": "application/json",
            "x-api-key": "<发送时解析>",
            "anthropic-version": "2023-06-01"
          },
          "body": { "model": "deepseek-v4.1-flash", "max_tokens": 64, "system": "你是连通性探针。…", "messages": [{ "role": "user", "content": "输出 OK" }], "stream": false }
        },
        "stream": { "…": "同上，stream=true，accept=text/event-stream" }
      }
    }
  ],
  "warnings": []
}
```

> **★ 示例中 `warnings` 的取值说明（避免照抄出错）**：
> - **`happycodeai` 分组**（`baseURLNormalized = "https://happycodeai.com"`，**不以 `/v1` 结尾**）→ 按 §7.5 规则表**不触发**任何警告，故其 `warnings` 为 **空数组** `[]`。
> - **`aimax66` 分组**（`baseURLNormalized = "http://ai.max66.xyz/v1"`，**以 `/v1` 结尾**且 `api === "anthropic-messages"`）→ 命中 `ANTHROPIC_BASEURL_HAS_V1`，故其 `warnings` 含该条；其 `previewUrl` 与请求 URL 均为 **`http://ai.max66.xyz/v1/v1/messages`**（双 `/v1` 必须**如实暴露**，见 §6.1 / AC5b，不得静默去重）。
> - **警告挂载规则**：警告挂在**触发它的那个分组**上（`groups[].warnings`），**不要**因为「该供应商下有 anthropic 路由」就挂到别的分组；判据只有 §7.5 规则表那一行。
> - 本机实测：**恰好 1 个分组**触发该警告，即 `http://ai.max66.xyz/v1`（§7.5 亦如此陈述）。

契约要点：

- `providers[]` 与 `groups[]` 是**唯一**数据源；`groups[].providerId` 回指 `providers[].id`，`providers[].groupIds` 正向列出。两者由同一次分组计算产出，顺序稳定。
- **`routeCount` 三处同名不同义，实现与客户端均按此取值（第四行判定见 §7.4）**：
  | 位置 | 含义 | 本机 xcmapi 分组取值 |
  | --- | --- | --- |
  | `providers[].routeCount` | 该**供应商**（归一化 baseURL）下的路由总数 | 4 |
  | `groups[].routeCount` | 该**分组**（归一化 baseURL + api）下的路由总数 —— **第四行的渲染判据**（`> 1` 才渲染，§7.4） | 4 |
  | `models[].routeCount` | 该**模型**的候选路由数，恒等于 `models[].routeKeys.length` —— 只决定第四行列出几个按钮 | gpt-5.6-sol → 2；glm-5.3-flash → 1 |
- `providers[].apiCount` 为该供应商下的 API 类型（分组）个数，恒等于 `providers[].groupIds.length`。
- `requestPreview.nonStream` / `requestPreview.stream` **必须**由与真实请求**同一个** `buildRequest(route, modelId, stream)` 函数产出（真实发送时仅把 `<发送时解析>` 占位替换为真实密钥）。因此恒有 `actualUrl === requestPreview[stream ? "stream" : "nonStream"].url`。**客户端禁止自行拼接 URL 或构造请求体。**
- `credential` 只含引用名与状态，来自 `ctx.get("credentials").describe(credentialRef(ref))`；凭据服务缺失时三字段均为 `null`（`configured: null` 表示未知）。**任何情况下不含密钥值。**
- `apiSupported`：`api` 属于三协议为 `true`，否则 `false`（面板仍可展示，但发送按钮提示不支持）。
- `warnings[]` 为 §7.5 的分组级警告与全局警告（如 `SETTINGS_UNAVAILABLE`）。

### 11.2 `POST /api/model-health/test`

请求体：

```json
{ "routeKey": "api-tcvps-006", "modelId": "gpt-5.6-sol", "stream": false, "systemPrompt": null, "userPrompt": null }
```

- `routeKey`、`modelId` 必填字符串；`stream` 可选布尔，缺省 `false`；`systemPrompt` / `userPrompt` 可选字符串（≤ 2000 字符）。
- 校验：`routeKey` 不存在 → 404 + `UNKNOWN_ROUTE`；`modelId` 不在该路由 `models` 中 → 400 + `UNKNOWN_MODEL`；body 非法 JSON 或字段类型不符 → 400 + `BAD_REQUEST`；同目标在飞 → 409 + `TEST_IN_FLIGHT`。

响应：HTTP 200 + 一条完整的 `TestResult`（结构见 §12.1），无论测试成功或失败。该记录同时被追加到 RingBuffer。

### 11.3 `GET /api/model-health/records`

```json
{ "ok": true, "capacity": 50, "count": 3, "records": ["<TestResult>", "<TestResult>", "<TestResult>"] }
```

`records[]` 为 `TestResult` 数组，最新在前（`records[0]` 为最新一条）。

记录结构与 `POST /test` 的返回**同构**（同一构造函数产出），客户端不需要两套解析。

### 11.4 `POST /api/model-health/records`

请求体 `{ "action": "clear" }`；响应 `{ "ok": true, "cleared": 3 }`。其他 action → 400 + `BAD_REQUEST`。

### 11.5 对 dev-client 三问的冻结答复

1. **完整 URL 由谁算**：宿主。`groups[].previewUrl` 与 `groups[].requestPreview.*.url` 均由 `buildRequest()` 产出，与真实请求同一函数；客户端只渲染。同时 `TestResult.actualUrl` 回填真实 URL，`actualUrl === previewUrl` 是验收项（AC4）。
2. **字段名与三层诊断链表示法**：见 §12.1（`status` / `latencyMs` / `httpStatus` / `layers` / `responseText` / `usage.promptTokens` / `finishReason` / `ttftMs` / `actualUrl` / `error`）。`layers` 是**固定三键对象**（不是数组），每层含 `status` / `label` / `detail` / `code`；中文文案由宿主给，客户端原样渲染。`GET /records` 返回**同构**的 `TestResult[]`。
3. **Slow 阈值**：`thresholds.slowMs` 随 `GET /config` 下发，客户端只用于「超出阈值」标注，判定权在宿主。

## 测试记录结构与内存策略

### 12.1 `TestResult`（冻结契约）

```json
{
  "id": "r-1789655281628-1",
  "pluginVersion": "0.1.0",
  "startedAt": 1789655281628,
  "finishedAt": 1789655281750,
  "latencyMs": 122,
  "ttftMs": null,
  "status": "healthy",
  "reasons": [],
  "target": {
    "routeKey": "api-tcvps-006",
    "displayName": "api-tcvps-006",
    "baseURL": "https://www.xcmapi.com/v1",
    "baseURLNormalized": "https://www.xcmapi.com/v1",
    "api": "openai-completions",
    "modelId": "gpt-5.6-sol",
    "stream": false,
    "routeCount": 2,
    "credentialRef": "API_TCVPS_006_API_KEY"
  },
  "actualUrl": "https://www.xcmapi.com/v1/chat/completions",
  "httpStatus": 200,
  "httpStatusText": "OK",
  "requestHeaders": {
    "content-type": "application/json",
    "accept": "application/json",
    "authorization": "Bearer ***"
  },
  "requestBodyPreview": "{ \"model\": \"gpt-5.6-sol\", ... }",
  "responseText": "OK",
  "responseRaw": "{\"id\":\"...\",\"choices\":[{\"message\":{\"content\":\"OK\"}}]}",
  "truncated": false,
  "finishReason": "stop",
  "usage": { "promptTokens": 31, "completionTokens": 1, "totalTokens": 32, "cacheReadTokens": null, "cacheWriteTokens": null, "totalComputed": false },
  "usageSource": "body",
  "sseEventCount": null,
  "sseEventTypes": null,
  "layers": {
    "api":    { "status": "pass", "label": "API 请求", "detail": "已收到 HTTP 200，响应体 312 字节", "code": null },
    "model":  { "status": "pass", "label": "模型响应", "detail": "提取到模型文本（2 个字符），结束原因 stop", "code": null },
    "strict": { "status": "pass", "label": "严格校验", "detail": "响应文本与期望值「OK」完全一致", "code": null }
  },
  "error": null
}
```

失败样例（`error` 与 `layers` 联动）：

```json
{
  "status": "failed",
  "httpStatus": 404,
  "responseText": "",
  "usage": { "promptTokens": null, "completionTokens": null, "totalTokens": null, "cacheReadTokens": null, "cacheWriteTokens": null, "totalComputed": false },
  "usageSource": "none",
  "error": { "code": "HTTP_404", "title": "路径不存在：URL 拼错或路径后缀不符", "hint": "…", "httpStatus": 404, "raw": "<html>404 Not Found</html>" },
  "layers": {
    "api":    { "status": "fail", "label": "API 请求", "detail": "HTTP 404，未进入模型响应阶段", "code": "HTTP_404" },
    "model":  { "status": "skip", "label": "模型响应", "detail": "上游层未通过，本层未执行", "code": null },
    "strict": { "status": "skip", "label": "严格校验", "detail": "上游层未通过，本层未执行", "code": null }
  }
}
```

字段约定：

- `id` 格式 `r-<startedAt>-<自增序号>`，进程内唯一。
- `usageSource` 取值：`body` | `openai-final-chunk` | `responses-completed` | `anthropic-accumulated` | `none`。
- `ttftMs`：流式下为首个文本增量帧的耗时；非流式固定 `null`。
- `sseEventCount` / `sseEventTypes`：流式下为整数 / 去重后的字符串数组；非流式固定 `null`。
- `httpStatus`：未拿到响应时为 `null`。
- 所有字段恒存在；无值用 `null`（不用 `undefined`、不省略键）。

### 12.2 内存 RingBuffer

| 项 | 规格 |
| --- | --- |
| 容量 | 50 条（插件配置 `maxRecords` 可调，范围 1–500，默认 50） |
| 顺序 | 新记录插入队首；`records[0]` 为最新 |
| 溢出 | 丢弃最旧一条 |
| 生命周期 | 仅进程内存；**不写盘、不落状态文件、不跨重启**；插件卸载即释放 |
| 并发 | 单进程内串行写入；`GET /records` 读取的是同一数组的快照副本（避免调用方改动内部状态） |
| 内存上限 | 单条 ≤ 约 14 KB（受 §10.3 截断约束），50 条上限约 700 KB |
| 清空 | `POST /records {action:"clear"}` 立即清空并返回清空条数 |

## 需求

| 编号 | 需求 |
| --- | --- |
| R1 | 插件以 DSH 插件形态交付：宿主半 `lib/index.js`（`name` / `inject` / `apply`），客户端半 `lib/client.js`（`__ModuleLoader__.load` + `exports.inject = ["slots"]` + `ctx.slots.inject("conversation.view", …)` 注册「模型健康检查」页签），`package.json` 声明 `dsh.bundle.patch` 与 `dsh.client`，`cordis.patch.yml` 插入插件行。 |
| R2 | 配置只读读取 `llm-pi-ai` 命名空间的 `providers`（**扫描范围仅此一处**，不含 `describe-image`/`llm-deepseek` 等其他命名空间）；不写配置；服务或命名空间缺失时降级为可提示的空结果，不让插件纤维失败。 |
| R2b | 组数 / API 类型按钮数 / 路由数 / 模型并集**全部由配置在运行时动态得出**，禁止硬编码；§5.3 的数值仅为本机当前期望值，供验收比对。 |
| R3 | 第一行供应商按钮按归一化 baseURL 分组；归一化**只去尾部斜杠**（`/+$` → 空），**绝不**补全、裁剪或改写 `/v1` 等路径段。 |
| R4 | 第二行 API 类型按钮按 `(归一化 baseURL, api)` 分组；同 baseURL 下多种 api 时全部列出。 |
| R5 | 第三行模型按钮为分组内模型按 id 去重后的并集，每个模型携带候选 `routeKeys`。 |
| R6 | 第四行路由按钮的**渲染条件**是所选分组的路由数大于 1（**分组作用域**，`groups[g].routeCount > 1`，见 §7.4）；分组只有 1 条路由时该路由自动成为目标、不渲染第四行。渲染后候选按钮集按所选模型的 `routeKeys` 收窄，**候选数为 1 时仍然渲染**（不得隐藏）。 |
| R7 | 四行选择**级联过滤**（§7.6）：切换上行即重算下行并清空其选择；默认选中 `providers[0] → 首个有模型的分组 → models[0] → routeKeys[0]`。 |
| R7b | **禁止自由笛卡尔积**：第四行候选集恒为所选模型的 `models[m].routeKeys`，**不得**改为「分组全部路由」。面板必须保证「所选路由必定声明了所选模型」（AC23 不变式）。 |
| R8 | 测试消息模板由宿主提供默认值与可选覆盖，随 `GET /config` 下发并在预览区展示。 |
| R9 | 严格校验：`responseText.trim() === "OK"`；失败降级为 Slow，绝不 Failed。 |
| R10 | 流式 / 非流式开关，默认非流式；开关状态在会话内保持，不持久化。 |
| R11 | 三协议 URL 拼接使用 §6.1 的同一函数与同一拼接式；openai 系自带 `/v1`，anthropic 系不带 `/v1`。 |
| R12 | 三协议鉴权头与固定头严格按 §6.2。 |
| R13 | 三协议请求体严格按 §6.3（anthropic `system` 顶层、`max_tokens` 必填；openai `system` 进 `messages`；responses 用 `instructions` + `input`）。 |
| R14 | 三协议响应解析与 token 字段严格按 §6.5。 |
| R15 | 三协议流式解析严格按 §6.6：openai 必发 `stream_options.include_usage`；anthropic usage 跨事件累积；终止符分别为 `[DONE]` / `response.completed` / `message_stop`。 |
| R16 | 流式按字节缓冲 + `TextDecoder({stream:true})` 增量解码，跨 chunk 的中文不得被切碎。 |
| R17 | `AbortController` 总超时（默认 60000 毫秒）与 4 MiB 响应体上限（先查 `content-length` 再累计校验）。 |
| R18 | 密钥解析顺序：`ctx.get("credentials").resolve(credentialRef(ref))` 优先，启动环境快照兜底；**三元语义**（服务存在但 `resolve()` 返回 `undefined` 时不回退，回退仅在服务整体缺失时发生）；解析失败判 `MISSING_CREDENTIAL` 且不发请求；解析成功后须过可发送性校验（trim → 空则 `empty` → 不匹配 `/^[\x21-\x7E]+$/` 则 `illegalCharacters`），不合法判 `INVALID_CREDENTIAL` 且不发请求。 |
| R19 | 密钥零泄漏：记录、HTTP 响应、日志、错误文本中均不出现密钥明文；鉴权头固定渲染为 `***`。 |
| R20 | 状态机与判定优先级：Failed > Slow > Healthy；Testing 只在收到宿主响应时结束。 |
| R21 | 三层诊断链 `layers` 为固定三键对象，含 `status` / `label` / `detail` / `code`；中文文案由宿主生成。 |
| R22 | 错误映射表按 §10.1 实现，每条给出 `code` / `title` / `hint`。 |
| R23 | 测试记录 RingBuffer 容量 50、最新在前、重启清空、不落盘。 |
| R24 | 四个 HTTP 端点按 §11 实现，含统一响应头与错误体。 |
| R25 | 同目标并发保护：在飞时第二次请求返回 409 + `TEST_IN_FLIGHT`；面板在飞期间禁用发送按钮。 |
| R26 | 客户端只渲染不重算：不自行拼接 URL、不构造请求体、不生成中文诊断文案、不判定状态。 |
| R27 | Testing 期间显示递增已耗时与 `aria-busy="true"`；发送按钮禁用并说明原因。 |
| R28 | 无障碍与主题适配按 `ui-spec.md` 落地：键盘可达、`role` / `aria-*` 齐备、焦点管理正确、颜色走语义 token、字号走子 token，深浅主题均可读。 |
| R29 | **自动重试会话（§18）**：用户显式启动后按固定间隔反复测试同一目标，直到成功或触发停止条件；**每次尝试复用单次测试的同一实现与同一记录写入路径**，不引入新协议行为。属 §2.1 范围内（非后台监控，见 §2.2 第 1、2 条）。 |
| R30 | **两种成功判定模式互斥且必选其一**（§18.2）：**严格模式**（默认）= `responseText.trim() === "OK"`；**连通模式** = HTTP 2xx **且**响应体可解析（`layers.model.status === "ok"`），不比对内容。严格模式下 `slow` 不算成功；连通模式下 `slow` 算成功。不得提供第三种「任一满足」模式。 |
| R31 | **参数域（§18.4）**：间隔单位为**分钟**、允许**一位小数**、最小 **0.1**、默认 **1**；最大次数默认 **30**（**0 = 不限**）；最长时长默认 **30 分钟**（**0 = 不限**）。**两者同时为 0 时**须以**可见文本**（非仅 `title`）提示「将一直重试直到成功或手动停止」。 |
| R32 | **停止条件穷举为 4 条**（§18.5）：成功 / 次数上限 / 时长上限 / 用户手动停止；四条之外无其它结束路径。手动停止须能**中断在飞请求**。**致命错误 `401`/`403`/`404`/`400` 一律不短路**，继续重试至上限（用户裁定），不得提前结束、不得询问、不得自动降频。 |
| R33 | **重试并发约束（§18.6）**：同一时刻只允许**一个**重试会话；重复 start 返回 **409 + `RETRY_IN_FLIGHT`**，**必须被拒绝而非静默覆盖**（不得替换、忽略或排队）。会话期间单次测试仍可并发执行（受 R25 约束）。 |
| R34 | **默认模型读取与映射（§19.2）**：只读读取宿主 `agent-default-model` 命名空间（**不新增自有存储**）；把 `provider`（= 路由名，**非** `providers[].id`）与 `model` **逐分组**映射为四层选择状态；命名空间不可用或定位不到时降级为 `available:false` / `selection:null` + 中文原因，**绝不让插件纤维失败**。 |
| R35 | **默认模型写入（§19.3）**：`POST /default` 只写 `agent-default-model` 一节（**绝不碰 `llm-pi-ai`**，AC19）；用 **`replace`** 而非 `update`（合并语义无法移除字段）；`reasoningEffort` **只在目标模型支持时才带**，不支持则丢弃；非法目标 404/400，settings 不可写 5xx，**不得谎报成功**。 |
| R36 | **默认模型预选（§19.5）**：面板**首次加载**时预选默认模型；`provider` 与 `model` **两者都相等**才算「已是默认」；预选只影响首次，不覆盖用户后续操作与配置刷新时的选择保持（§7.3）。 |

## 验收标准

每条给出判定方式；`tests/acceptance.mjs` 为机器判定载体，人工项标注「人工」。

| 编号 | 验收标准 | 判定方式 |
| --- | --- | --- |
| AC1 | **源码树**完整：`package.json`（含 `dsh.bundle.patch`、`dsh.client.inject`、`main`、`exports["./client"]`、`scripts.test`）、`cordis.patch.yml`、`lib/index.js`、`lib/client.js`、`lib/probe.js`、`lib/providers.js`、`lib/records.js`、`tests/acceptance.mjs` 均存在且可被 Node 解析。**npm 包（tarball）**只需包含运行时文件：`lib/**`、`cordis.patch.yml`、`package.json`（`tests/**` 属开发/验证产物，**不要求**进 tarball） | 源码树：`node --check lib/index.js`、`node --check lib/client.js`、`node -e "import('./lib/index.js')"` 三者 exit 0；tarball：`npm pack --dry-run` 的文件清单含 `lib/*.js`、`cordis.patch.yml`、`package.json`。**判定时不得要求 tarball 含 `tests/`** |
| AC2 | `GET /config` 对本机配置的返回与 §5.3「期望值对照基准」**逐条**一致：provider 数 12、供应商组 `providers.length === 6`、API 类型按钮 `groups.length === 7`、路由总数 12、`aihub.dog/v1` 路由 3（AIHUB_01/012/013_API_KEY）、`www.xcmapi.com/v1` 路由 4（XCMAPI_GUOMO/API_TCVPS_K3TEST/006/008_API_KEY）、`ai.max66.xyz/v1` API 类型 2、模型并集与 §5.3 表一致；**口径必须是「仅 `llm-pi-ai.providers` + 只去尾斜杠归一化」**，不得出现按「全配置段原始 baseURL 去重」得到的 7 组。**术语澄清（防误判为笔误）**：此处 `providers.length === 6` 的 `providers` 指**供应商组**（§4 术语表 / §11.1 的 `providers[]`），**不是** settings 里 `llm-pi-ai.providers` 的 provider 条目数 **12**；两者相差的原因是 `providers` 字典的 12 个条目按归一化 baseURL 归并后为 6 组。`groups.length === 7` 指 (baseURL, api) 分组数。三数与 §4 术语表、§5.3 表格内部自洽 | 验收脚本：**扫描范围 = 仅 `llm-pi-ai.providers`；不包含 `describe-image`、`llm-deepseek` 等命名空间**（范围不同会得到 6 或 7，见 §5.1）。读真实 `settings.yaml` → 起宿主 → 逐条比对断言（§5.3 期望值表全部行 + 「7 歧义对照表」前三行）；另设反硬编码用例：构造 3 组假配置，断言输出恰为 3 组（证明组数为运行时动态推导）；另设反越界用例：向 `describe-image`/`llm-deepseek` 塞入干扰 baseURL，断言供应商组数**不变** |
| AC3 | 归一化只去尾斜杠：`https://happycodeai.com/` 与 `https://happycodeai.com/v1` 是**两个**供应商组；`baseURLNormalized` 不出现 `/v1` 的增删；`https://happycodeai.com`（尾斜杠归一化后）与 `https://happycodeai.com/v1` **必须仍不相等** | 单测：`normalize("https://a.com/") === "https://a.com"`；`normalize("https://a.com/v1") === "https://a.com/v1"`；`normalize("https://a.com/v1/") === "https://a.com/v1"`；本机配置断言 6 组（§7.1 回归用例） |
| AC4 | 预览 URL 与真实请求 URL 同源：对每个可测目标，`actualUrl === groups[g].requestPreview[stream?stream:nonStream].url` | 验收脚本对 7 个分组逐一比对；另设断言「同一 baseURL 在 openai 与 anthropic 下产出不同 URL」 |
| AC5 | 三协议 URL / 鉴权头 / 请求体正确：openai 系 `baseURL + "/chat/completions"` 与 `+ "/responses"` 且带 `Bearer`；anthropic 为 `baseURL + "/v1/messages"` 且带 `x-api-key` + `anthropic-version: 2023-06-01`；anthropic 请求体 `system` 在顶层且 `max_tokens` 存在；openai 请求体 `messages[0].role === "system"` | mock 服务器断言收到的路径、头、体；逐协议至少 2 条用例 |
| AC5b | **双 `/v1` 如实暴露**：`aimax66`（anthropic + `http://ai.max66.xyz/v1`）的 `previewUrl` 与 `actualUrl` 均为 `http://ai.max66.xyz/v1/v1/messages`，**不得**被去重为单 `/v1`；同时 `happycodeai`（anthropic + `https://happycodeai.com/`）为 `https://happycodeai.com/v1/messages`（单 `/v1`）。两者构成 anthropic 的两种真实形态 | 单测两条 URL 断言 + 面板预览人工核对；若实现输出单 `/v1` 即判失败 |
| AC6 | 流式：openai 请求体含 `stream_options.include_usage === true`；anthropic usage 由 `message_start` 的 `input_tokens` 与 `message_delta` 的 `output_tokens` 累积得到（`promptTokens` 非空）；三协议终止符分别识别 `[DONE]` / `response.completed` / `message_stop` | mock 服务器按协议发送分片 SSE，断言 `usage`、`sseEventTypes`、`status` |
| AC7 | 跨 chunk UTF-8 正确：mock 把「中文」的字节序列切成两个 chunk 发送，`responseText` 不得出现替换字符（`\uFFFD`） | 专用用例：逐字节拆分同一多字节字符 |
| AC8 | 状态机与降级：严格校验失败（返回 `OK！`）→ `status === "slow"` 且 `reasons` 含 `strict-mismatch`；耗时超 `slowMs` 但内容正确 → `slow` 且含 `slow-latency`；mock 延迟超时 → `failed` + `TIMEOUT`；非 2xx → `failed` | 验收脚本 4 条用例 |
| AC9 | 错误映射表覆盖：`tests/acceptance.mjs` 对 §10.1 中可由 mock 触发的 code（`HTTP_401`/`403`/`404`/`405`/`408`/`413`/`429`/`5XX`/`BAD_RESPONSE_JSON`/`MISSING_RESPONSE_FIELD`/`EMPTY_RESPONSE`/`STREAM_NO_TERMINAL`/`RESPONSE_TOO_LARGE`/`MISSING_CREDENTIAL`/`INVALID_CREDENTIAL`/`UNSUPPORTED_API`/`MISSING_BASE_URL`）逐一断言 `error.code` 与中文 `title` 非空；网络类 code（`DNS_FAILED`/`CONNECTION_REFUSED`/`CONNECTION_RESET`/`TLS_ERROR`）用不可达地址与非法主机名触发并断言分类。**`INVALID_CREDENTIAL` 须分别覆盖两个 reason**：① 密钥仅含空白 → `empty`；② 密钥含内部空格或非 `[\x21-\x7E]` 字符（如 `sk-abc def`、含换行）→ `illegalCharacters`；并断言两种情况**均不发请求**。**`MISSING_CREDENTIAL` / `INVALID_CREDENTIAL` / `UNSUPPORTED_API` / `MISSING_BASE_URL` 与「密钥未配置」UI 态在本机真实配置下不可触发**（12/12 密钥均已配置、12/12 api 均属三协议、均有 baseURL），一律用 **mock/构造配置** 判定，验收报告中须标注「构造数据」而非「真机」 | 验收脚本 + 人工复核 title/hint 文案可读 |
| AC10 | 密钥来源正确：把 `ctx.get("credentials")` 置为 `undefined`（仅走环境快照）时，本机 12 条路由全部得到 `MISSING_CREDENTIAL`（实测环境快照 0/12 命中）；接入凭据服务后本机 12/12 路由的密钥均可解析，真实测试返回 `httpStatus === 200` 且不出现 401 | 反证用例（mock，无需额度）+ 真实端点冒烟（**需 captain 授权**）各 1 次 |
| AC11 | 密钥零泄漏（四个面逐一断言）：① **前端 payload**——`GET /config`、`POST /test`、`GET /records` 的完整响应文本；② **日志**——插件全部 logger 输出；③ **状态文件**——`~/.dsh` 与工作目录下该插件写出的任何文件（本插件不落盘，故断言为「无此类文件」，与 AC12 共用目录快照）；④ **错误消息**——`error.title` / `error.hint` / `error.raw` 与 HTTP 4xx 错误体。四个面匹配 `sk-[A-Za-z0-9_-]{8,}` 的命中数均为 0；另构造「网关在 401 响应体中回显密钥」的 mock，断言记录中该值被替换为 `***` | 验收脚本正则扫描（四个面分别统计命中数）+ 回显用例 |
| AC12 | RingBuffer：连续测试 55 次后 `count === 50` 且 `records[0]` 为最后一次；重启宿主进程后 `count === 0`；工作目录与 `~/.dsh` 下不新增该插件写出的文件 | 验收脚本 + 重启实测 + 目录快照比对 |
| AC13 | 超时与体积上限：mock 挂起 3 秒（`hardTimeoutMs=1000`）→ `TIMEOUT` 且 `latencyMs` 接近 1000；mock 返回 `content-length: 8388608` → `RESPONSE_TOO_LARGE` 且不读取正文 | 验收脚本 2 条用例 |
| AC14 | 面板四行选择器行为：① ② ③ 恒渲染且默认选中；④ 的渲染条件是**分组作用域**的 `groups[g].routeCount > 1`（§7.4）——`https://www.xcmapi.com/v1`（4 条）与 `https://aihub.dog/v1`（3 条）两个分组**在任意模型下第四行都出现**；其余 5 个分组（各 1 条）**不出现**；且 xcmapi 内候选按钮数随模型变化：选 `gpt-5.6-sol` 为 **2 个**、选 `glm-5.3-flash` 为 **1 个**（**第四行仍渲染，不得隐藏**） | 人工 + qa-verifier 按 `ui-spec.md` 渲染级核对（DOM 断言）；另设反例：断言 xcmapi 分组在选 `glm-5.3-flash` 时第四行**存在且仅 1 个按钮**（若实现按模型判据则会误隐藏整行） |
| AC15 | 一屏信息密度（**按视口高度分档**，措辞与 `ui-spec.md` §1.3 / §1.3.1 一致）：**可用高度由函数给出，不取常数**——`slot(VH) = VH − 76（顶部偏移）− 148（composerSeat）`，内容盒 `= slot − 40（面板 padding）`。**A 档（`VH ≥ 910`，`slot ≥ 686`）内，首屏无需滚动即可见** 状态徽标、耗时、HTTP 状态、token 用量、三层诊断链、响应内容与四行选择器——**这是硬约束**（长响应最坏余量 18px；用户真实视口 2048×927 属本档）。**A 档须同时断言两条**（二者有效性随 `[data-mh-root]` 写法反转，只写一条即成空断言，见 `ui-spec` §1.3 末注）：① `root` 不溢出；② `scrollBody` 不滚动（页面无滚动条）。**B 档（`888 ≤ VH < 910`）/ C 档（`VH < 888`）允许滚动，但必须发生在面板内而非页面级**，属**已登记的小屏降级**（`ui-spec` §1.3.1）：判别式为「`root` 溢出 **且** `scrollBody` 不滚动」，滚动后全部内容仍可达；**禁止** `overflow-y: hidden` 掩盖缺口；须**记录档位、`slot` 与缺口像素**（如 1280×800 = C/576/缺 87.2；1366×768 = C/544/缺 119.2）并说明降级，**不得**记为无条件通过。**任何情形下都不得为迁就小屏而删除、合并或折叠功能/信息项**；验收须**记录取证时的视口尺寸** | 人工 + 截图核对；渲染级由 qa-verifier 按 `ui-spec.md` `V-L2` / `V-L3`（按档位分流、双轨断言）实测 `root` 与 `scrollBody` 两层 |
| AC16 | 无障碍达标：所有按钮可 Tab 到达、有可读名称、选中态通过 `aria-pressed` / `aria-selected` 表达；Testing 区 `aria-busy="true"`；深浅主题切换后文字对比度达标（Lighthouse 无障碍项无 serious 及以上问题） | qa-verifier 渲染级核对 + 对比度实测 |
| AC17 | openai-responses 无真实样本：以 mock 覆盖三协议同构用例，验收记录中明确标注「本机无 openai-responses 路由，仅 mock 覆盖」，不得声称真实端点已验证 | 验收报告如实标注 |
| AC18 | 端点契约：4 个端点返回 `content-type: application/json; charset=utf-8` 与 `cache-control: no-store`；`UNKNOWN_ROUTE` → 404、`UNKNOWN_MODEL` → 400、非法 body → 400、在飞重复 → 409，且错误体形如 `{ok:false,error:{code,message}}` | 验收脚本逐条断言 |
| AC19 | 配置只读：源码与运行期均无 `settings.update` / `replace` / `mutate` 调用；测试前后 `settings.yaml` 的 mtime 与内容不变 | 静态检查 + 文件哈希比对 |
| AC20 | 规格门禁：`keel_review` 对 `docs/SPEC.md` 与 `docs/ASSUMPTIONS.md` 的错误数为 0 | 运行 `keel_review` 并附报告 |
| AC22 | **反假绿（零用例守卫）**：任何测试/验收命令**必须自报用例数**，且 `用例数 > 0` 才算通过。只报 exit code **不算**通过；输出 `tests 0` 一律判「**未验证 / 失败**」，不得计为绿 | `npm test` 与 `node tests/acceptance.mjs` 的输出须含 `tests > 0` 与 `total > 0`；另设负向用例：临时把测试文件移出目录，断言命令**不再**被判为通过（实测 `node --test` 在零匹配时输出 `ℹ tests 0` 且 **exit=0**，故仅看 exit code 会假绿） |
| AC23 | **级联不变式（禁止自由笛卡尔积，§7.6）**：对全部可达的 (供应商, api, 模型, 路由) 四元组，所选 `routeKey` **必定**属于该模型 `models[m].routeKeys`；且第四行候选集**恒等于** `routeKeys`（不是分组全部 `routes[]`）。**必测 xcmapi 分组**：模型行去重后 **6** 个、路由行 **4** 个，自由组合 24 个中**仅 7 个有效**；具体断言 `glm-5.3-flash`/`deepseek-v4.1-flash`/`deepseek-v4.1-flash-expires-on-0910` → 候选仅 `XCMAPI_GUOMO_KEY`（1 条）；`deepseek-v4-flash`/`k3` → 候选仅 `API_TCVPS_K3TEST_API_KEY`（1 条）；`gpt-5.6-sol` → 候选 `API_TCVPS_006_API_KEY`+`API_TCVPS_008_API_KEY`（2 条）。⚠️ **只测 aihub 会误判通过**（该分组 6/6 全有效），**必须**用 xcmapi 验证 | 验收脚本：枚举每个分组内每个模型的 `routeKeys`，断言「候选集 == routeKeys 映射」且「不存在 routeKey ∉ routeKeys 的可达组合」；另设负向用例：把第四行候选集替换为分组全部 `routes[]` 时，断言该用例**失败**（证明断言有效）。DOM 断言由 qa-verifier 按 `ui-spec.md` 核对 |
| AC21 | 测试命令口径正确：`package.json` 含 `"scripts": { "test": "node --test" }`；在插件根执行 **`npm test`** 得到 **exit 0**；交付物（SPEC / README / 验收脚本 / 报告）中**不出现** `node --test tests/`、`node --test tests`、`node --test .` 这三种形式 | `npm test` 实跑 exit 0；对交付物 grep `--test\s+(tests/?\s*$|\.)` 命中数为 0。**不得**因 `node --test tests/` 失败而判定实现有缺陷（Node 24 行为变更，见 §15.1b） |
| AC24 | **两种成功判定模式判据精确**（§18.2）：**严格模式**下 mock 返回 `OK` → 会话成功结束（停止原因 `success`）；mock 返回 `OK！` / `ok` / 空响应 → **不成功**，继续重试。**连通模式**下 mock 返回 `OK！` 且 HTTP 200 → **成功**（不比对内容）；mock 返回 HTTP 500 → 不成功。两模式**互斥**：面板无「都不选」态，默认选中严格模式 | 验收脚本：mock 服务器按上述四种响应 × 两模式组合断言「会话是否结束 + 停止原因」；另设反例：严格模式下仅 HTTP 200 但内容不符时**不得**判成功 |
| AC25 | **参数域与无限重试提示**（§18.4）：间隔 `0.1` 合法、`0.05` 非法（多于一位小数/低于下限）；最大次数与最长时长接受 `0`（= 不限）；**两者同时为 0 时**面板出现**可见文本**提示「将一直重试直到成功或手动停止」（断言该文本节点的 `textContent` 命中，且**不是**仅存在于 `title` 属性） | 验收脚本：参数校验断言（合法/非法各 2 例）+ DOM 断言提示文本可见（`getComputedStyle` 非 `display:none` / 非 `visibility:hidden`） |
| AC26 | **停止条件穷举 4 条 + 致命错误不短路**（§18.5）：① 成功 → `success`；② 达次数上限 → `max-attempts`；③ 达时长上限 → `max-duration`；④ 手动停止 → `stopped-by-user` 且**在飞请求被中止**。**致命错误不短路**：mock 持续返回 `401`/`403`/`404`/`400` 时，会话**继续重试至次数上限**（断言尝试次数 == 上限值，且未提前结束、未出现询问）；**会话结束后不自动重启** | 验收脚本：4 条停止条件各 1 例 + 致命错误 4 码各 1 例（断言 `attempts === maxAttempts` 且 `stopReason === "max-attempts"`）+ 手动停止期间在飞请求的 abort 断言 |
| AC27 | **重试并发约束**（§18.6）：会话在飞时再次 `POST /retry/start` → **409 + `RETRY_IN_FLIGHT`**（断言未替换旧会话、旧 `sessionId` 不变、未排队）；无会话时 `POST /retry/stop` → 409；`GET /retry/status` 无会话时返回 `{active:false}`。会话期间 `POST /test` 仍可成功执行 | 验收脚本：并发 start 断言旧会话 `sessionId` 不变 + 状态码/错误码断言 + 会话期间单测可执行断言 |
| AC28 | **默认模型读取与映射**（§19.2）：`GET /config` 的 `defaultModel` 含 `available`/`provider`/`model`/`reasoningEffort`/`source`/`reason`/`selection`；`selection` 满足 AC23 不变式（所选 `routeKey` 属于该模型 `routeKeys`，`modelKey` 属于该分组）。**必测同 baseURL 多 api 分组**：默认模型落在**第二个**分组时仍能定位（只查第一个分组会失败）。命名空间不可用 / 定位不到 → `available:false` / `selection:null` + 非空中文 `reason` | 单测（`tests/default-model.test.mjs`）+ 端点集成（`tests/host-endpoints.test.mjs`）；另设负例：路由存在但该分组不声明该模型 → `null`，不得张冠李戴 |
| AC29 | **默认模型写入**（§19.3）：`POST /default` 只写 `agent-default-model` 一节且**用 `replace`**（断言写入调用是 replace 而非 update；断言 `llm-pi-ai` 从未被写）；`reasoningEffort` 在目标模型**不支持**时被丢弃、**支持**时保留；非法目标 404/400 且**不产生任何写入**；settings 不可写 → 5xx + 结构化错误码（不谎报成功） | 单测 + 端点集成；「不写入」用写入记录条数断言（0 条），而非只看状态码 |
| AC30 | **默认模型预选与「已是默认」判定**（§19.5）：首次加载时预选 `defaultModel.selection`；**必须证明该选择与 §7.3 默认选择不同**（否则断言是空的——构造一个「默认模型不是第一个模型」的配置，断言两者 `modelKey` 不相等）；`provider` 或 `model` 任一不等即不算「已是默认」 | 单测（`tests/client-retry-default.test.mjs`）；另设对照：`defaultModel.available === false` 时必须回落 §7.3 默认选择 |

## 验证方法

### 15.1 机器验证（t4 交付物）

```powershell
# 工作目录：D:\Company\dsh-plugin\dsh-model-health

# 0) 单元测试（唯一验收命令；不要写 node --test tests/，见 §15.1b）
#    ★必须自报用例数且 > 0（零用例守卫，见 AC22）
npm test

# 1) 验收脚本（本地 mock 服务器，不依赖外网）
#    注意：这是**直接执行文件**，不受 Node 24 的 --test 目录语义影响
#    不要改写成 node --test tests/ —— Node 24 把位置参数当测试文件路径，
#    目录会 MODULE_NOT_FOUND 并计为失败（captain 已复现 exit=1，见 §15.1b）
node tests/acceptance.mjs

# 2) 语法检查
node --check lib/index.js
node --check lib/client.js

# 3) 规格门禁
#    在会话工作区调用 keel_review，path 指向 docs/SPEC.md 与 docs/ASSUMPTIONS.md

# 4) 包完整性
npm pack --dry-run

# 5) 密钥泄漏扫描（四个面分别统计，见 AC11）
Get-ChildItem -Recurse lib,docs,tests -File |
  Select-String -Pattern 'sk-[A-Za-z0-9_\-]{8,}'

# 6) 计数口径独立复核（第三方 ground-truth 脚本，位于插件目录之外、不污染交付物）
node D:\Company\dsh-plugin\_qa-ground-truth.mjs
#    期望输出：supplierGroups=6  apiButtons=7  routeButtons=12
#    并含「PROVENANCE OF 7」小节，说明 7 的两种来源
```

验收脚本覆盖矩阵（最低要求）：三协议 × {非流式, 流式} × {成功, 严格校验不符, 非 2xx, 无终止标记} + §10.1 中可 mock 的 code 各 1 条 + AC7 中文分片 + AC12 55 次溢出 + AC13 超时与体积 + AC2 反越界用例（干扰其他命名空间不改组数）+ AC5b 双 `/v1` 保真。

**计数口径独立复核**：`_qa-ground-truth.mjs` 由 qa-verifier 独立编写，位于插件目录之外（不进入交付物），仅做只读解析。t16 应用它交叉核对实现输出的 6 / 7 / 12 三个数，避免「实现与验收共用同一份错误口径」。若该脚本缺失，t16 须自行用等价方式复核 §5.3 的「7 歧义对照表」三行。

**★零用例守卫（反假绿，硬要求，见 AC22）**：**只报 exit code 不算通过**。测试文件被改名、放错目录或 glob 写错时，命令会「绿着通过 0 个用例」——本机 v24.18.0 实测：空 `tests/` 目录下 `node --test` 输出 `ℹ tests 0` 且 **exit=0**；`node --test "tests/**/*.test.mjs"` 同样 `tests 0` / exit=0。因此：
- 每一条测试/验收命令都必须**自报用例数**，且 `用例数 > 0` 才算通过；
- 输出 `tests 0`（或等价零计数）一律判「**未验证 / 失败**」；
- §15.4 的 JSON 报告须含 `total` / `passed` / `failed` 三个计数，且 **`total > 0`**；
- 换命令**不能**消除假绿（无参 `node --test` 与 glob 形式都会零匹配假绿），故守卫必须落在**计数断言**上，而不是命令形式。

### 15.1b 测试命令口径（Node 24 行为变更，**硬要求**）

**验收命令统一为 `npm test`**，并在 `package.json` 约定 `"scripts": { "test": "node --test" }`。**禁止**在 SPEC / README / 验收脚本 / 报告中使用 `node --test tests/`——那是 Node 24 的行为变更，**不是实现缺陷**，照抄会导致必然失败并误判实现有问题。

本机 Node **v24.18.0** / Windows 实测矩阵（captain 与 dev-host 复现，本规格编写时独立复跑确认）：

| 命令（cwd = 插件根） | 结果 | 说明 |
| --- | --- | --- |
| `npm test` | ✅ exit 0 | **唯一验收命令**（等价于无参 `node --test`） |
| `node --test` | ✅ exit 0 | 无位置参数时递归发现正常 |
| `node --test tests/probe.test.mjs` | ✅ exit 0 | 显式文件路径 |
| `node --test "tests/**/*.test.mjs"` | ✅ exit 0 | 引号 glob，由 Node 自行展开 |
| `node --test "tests/*"` | ✅ exit 0 | 引号 glob（单层） |
| `node --test tests/` | ❌ exit 1 | **不可用**：位置参数被当作测试文件路径解析，目录进 CJS loader 即 MODULE_NOT_FOUND，计为 1 个失败测试 |
| `node --test tests` | ❌ exit 1 | 同上 |
| `node --test .` | ❌ exit 1 | 同上 |

机制：Node 24 起 `--test` 后的位置参数按**测试文件路径**解析，不再作为目录递归根。

语法检查命令可用 `node --check lib/<file>.js`（实测 exit 0）。

> **与 captain 报告的一处差异（如实记录）**：captain 的矩阵把 `node --test "tests/*"` 列为不可用，我在本机 v24.18.0 复跑得到 **exit 0**（引号 glob 由 Node 自行展开，与 `"tests/**/*.test.mjs"` 同样可用）。差异不影响结论：**唯一验收命令仍为 `npm test`**，上表所有 ❌ 形式一律不使用。验收脚本与文档不得依赖 glob 形式，以免不同 Node 小版本或 shell 展开策略差异导致误判。

### 15.2 真实端点冒烟（人工，需用户在场）

| 用例 | 目标 | 预期 |
| --- | --- | --- |
| S1 | `xcmapi-guomo` + `glm-5.3-flash`（openai 非流式） | `status === "healthy"`，`responseText === "OK"`，`httpStatus === 200`，`usage.promptTokens > 0` |
| S2 | `happycodeai` + `claude-opus-5`（anthropic 非流式） | `healthy`；`usageSource === "body"` |
| S3 | 同 S1 目标开启流式 | `ttftMs` 非 `null`；`sseEventCount > 0`；`usageSource === "openai-final-chunk"` |
| S4 | 同 S2 目标开启流式 | `usageSource === "anthropic-accumulated"`；`usage.promptTokens` 非 `null`（证明跨事件累积生效） |
| S5 | `aimax66` + `deepseek-v4.1-flash`（anthropic，baseURL 带 `/v1`） | 预览 URL 为 `http://ai.max66.xyz/v1/v1/messages`；若上游 404，错误提示指向「anthropic 系 baseURL 不应带 /v1」 |

真实端点冒烟消耗上游额度，由 captain 决定执行时机与次数；失败不自动重试。

### 15.3 人工核对

- AC14 / AC15 / AC16 由 qa-verifier 按 `ui-spec.md` 做渲染级核对（DOM 结构、aria 属性、键盘路径、主题切换、对比度）；
- AC9 的中文 `title` / `hint` 可读性由 reviewer 人工复核；
- AC17 的样本覆盖说明由 qa-verifier 写入测试报告。

### 15.4 证据留存

验收脚本输出 JSON 报告到 `tests/report.json`，须含每条用例的 code、期望、实际、通过与否，**并含 `total` / `passed` / `failed` 三个计数，且 `total > 0`**（零用例守卫，见 AC22）；`total === 0` 视为**未验证**，不得作为通过证据。测试报告由 qa-verifier 汇总为 `docs/AUDIT.md`，逐条对照「验收标准」小节。

## 自动重试（直到成功）

> **本节为 v1.0.7 新增**（用户 2026-09-18 确认）。需求编号 **R29–R33**，验收编号 **AC24–AC27**（均为新编号，不改动既有 R/AC 编号语义）。
> 与 §2.2 第 1、2 条边界的关系：本功能**属范围内**——它是「用户显式启动、成功即停的有限重试会话」，不是「后台常驻监控」。四条有限性约束见 §2.2 第 2 条。

### 18.1 功能定位与启用条件

**定位**：用户选定一个目标后，可以让插件**按固定间隔反复测试该目标，直到成功或触发停止条件**。它服务于「等一个上游恢复 / 等一个限流窗口过去」这类场景——用户启动后可以离开，回来后看到「第几次成功」或「已重试 N 次仍失败」。

**启用条件（三条同时满足才可启动）**：
1. 目标已完整选定（① ② ③ ④ 四行均有确定值，与 §7.3 单次测试同一前置）；
2. 当前**没有**进行中的重试会话（并发约束见 §18.6）；
3. 参数合法（见 §18.4；不合法时禁用启动按钮并在 `title` 说明原因）。

**与单次测试的关系**：重试会话的每一次尝试**就是**一次完整的单次测试（复用同一套探测实现、同一状态机、同一错误映射、同一条记录写入路径）。本功能**不引入**新的协议行为、新的错误码或新的请求构造逻辑。

### 18.2 两种成功判定模式（互斥且必选其一）

启动前必须选定且**只能选定一种**模式；面板不得提供「都不选」的状态（默认选中**严格模式**）。

| 模式 | 精确判据 | 适用场景 |
| --- | --- | --- |
| **严格模式**（默认） | 该次尝试的**严格校验通过**，即 `responseText.trim() === "OK"`（与 §9 / R9 完全同一判据） | 验证模型确实按指令返回了约定内容 |
| **连通模式** | 收到 **HTTP 2xx**（`200 ≤ httpStatus < 300`）**且**响应体可解析（该协议的响应解析成功、`layers.model.status === "ok"`），**不比对内容** | 只关心「通不通」，不关心模型回了什么 |

**判据补充（消除歧义）**：
- **严格模式下**，仅 HTTP 2xx **不算成功**——必须内容精确等于 `OK`。返回 `OK！`、`ok`、空响应均判**未成功**，继续重试（对应单次测试的 `slow` / 失败态，但在重试语境下统一按「未成功」处理，见 §18.3）。
- **连通模式下**，HTTP 2xx 且解析成功即成功，**即使**响应文本是 `OK！` 或任意其它内容。
- 两模式的判据**不得混用**；不得提供「任一满足即成功」的第三种模式。
- 状态机语义不变：**单次尝试**内部仍按 §9 产出 `healthy` / `slow` / `failed`；重试会话只关心「这次算不算成功」，其中**严格模式下 `slow` 不算成功**（因为严格校验未通过或耗时超阈），连通模式下 `slow` **算成功**（2xx 且解析成功，耗时只影响该次的状态徽标）。

**★ 实现注记（v1.0.8 补记，两处规格文字的内部冲突与唯一解）**

本节表格与「判据补充」在两种情形下文字不一致，实现按**最严侧**取唯一解，**不新增第三种语义**：

1. **严格模式 + 严格校验通过但耗时超阈值**：表格行只写「严格校验通过」，而判据补充又写「严格模式下 `slow` 不算成功」。
   → **唯一共同解 = `status === "healthy"`**（既蕴含严格校验 pass，又排除 `slow`）。实现取此解。
2. **连通模式的解析成功判据**：原文写 `layers.model.status === "ok"`，但 §9.2 与 R21 冻结的 `status` 取值只有 `pass | fail | skip`，`"ok"` **恒不成立**。
   → 照字面实现会让连通模式**永远失败**（一条空断言）。实现按 §9.2 冻结契约取 `"pass"`。

> 两处均已在 `tests/retry.test.mjs` 中固化为断言（含「两模式结论必须不同」的区分力对照，防恒真/恒假）。
> **§18.2 正文语义未被修改**，本注记只把冲突显式化，供下游评审按此判定。

### 18.3 每次尝试的记录规则

- **每次尝试都写一条记录**（与单次测试同一条写入路径、同一 RingBuffer），**不做合并、不做覆盖**——用户需要看到「第 1 次失败、第 2 次失败、第 3 次成功」的完整序列。
- 每条记录**额外携带**重试上下文：`attempt`（本次为第几次尝试，从 1 开始计数）、`sessionId`（该重试会话的标识）、`isFinal`（是否为本会话的最后一次尝试）。
- 记录条数受 RingBuffer 容量 50 约束（R23）：若重试次数超过 50，**最早的记录被挤出**，属预期行为；面板须显示「会话已重试 N 次」（N 为会话自身计数，不受 RingBuffer 挤出影响）。
- 会话结束后，面板须能回答：**总共尝试几次、最后一次结果、停止原因**（见 §18.5 四类）。

### 18.4 参数域（三个参数）

| 参数 | 单位 | 取值域 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| **间隔** | **分钟** | 允许**一位小数**；最小 **0.1**；无上限（但须为正数） | **1** | 两次尝试之间的等待时长。`0.1` 分钟 = 6 秒。**首次尝试立即执行**，不等间隔 |
| **最大次数** | 次 | 整数 `≥ 0`；**0 = 不限** | **30** | 达到该次数即停止（停止条件之一） |
| **最长时长** | **分钟** | 允许一位小数；`≥ 0`；**0 = 不限** | **30** | 从会话启动起算的总时长上限（含等待时间与请求耗时） |

**参数域硬要求**：
- 间隔的最小值 **0.1 分钟**为硬下限，低于此值判参数非法（防止高频请求被上游判为滥用）。
- 间隔与最长时长**允许一位小数**（如 `0.5`、`2.5`）；多于一位小数判非法。
- **最大次数与最长时长同时为 0 时**（`0 = 不限` × 2），面板**必须明确提示**：「次数与时长均不限，将**一直重试直到成功或你手动停止**」——该提示须在启动前可见（不是启动后才出现），且不得仅以 `title` 承载（须为可见文本，无障碍可达）。

### 18.5 停止条件（穷举 4 条）

会话在下列**任一**条件成立时立即结束；四条之外**没有**其它结束路径。

| # | 停止条件 | 停止原因标识 | 结束时的尝试 | 面板文案要求 |
| --- | --- | --- | --- | --- |
| 1 | **成功**（按 §18.2 选定模式的判据） | `success` | 该次尝试即最后一次 | 「第 N 次尝试成功」（附该次结果） |
| 2 | **次数上限**：已达 `最大次数`（且该值 ≠ 0） | `max-attempts` | 不再发起新尝试 | 「已达最大次数 N，仍未成功」 |
| 3 | **时长上限**：会话已运行达 `最长时长`（且该值 ≠ 0） | `max-duration` | 不再发起新尝试 | 「已达最长时长 N 分钟，仍未成功」 |
| 4 | **用户手动停止** | `stopped-by-user` | 立即中止（含中止在飞请求，见下） | 「已手动停止（第 N 次尝试后）」 |

**判定细节**：
- 条件 2 与 3 **按先到者**生效；两者都未达且都非 0 时继续重试。
- 若两者均为 0（不限），会话**只在条件 1 或 4 下结束**——这正是 §18.4 要求提示「无限重试」的原因。
- 条件 4（手动停止）**必须能中断正在飞行的请求**：调用与单次测试同一的 `AbortController` 中止路径，该次尝试记为「已中止」（不计入成功）。
- **会话结束后不得自动重启**；再次重试须用户重新启动（符合 §2.2 第 2 条「不自行、无限期」）。

**★ 致命错误不短路（用户裁定，必须照此实现）**：
`401` / `403` / `404` / `400` 这类**通常被视为致命**的错误，在重试会话中**一律不短路**——按用户裁定**继续重试至上限**。
理由：这类错误多为**上游配置态**（如刚补上 `/v1`、刚换密钥、刚开通权限），「等它变好」正是本功能的目标场景之一。
- 实现**不得**因这些错误码提前结束会话，**不得**弹出「是否需要停止」的询问，**不得**自动降低重试频率。
- 这些错误在**单次尝试**的记录里仍按 §10.1 正常映射为对应 `code`（`HTTP_401` 等）与人话化文案；会话层面只把它们当作「未成功」。
- 唯一的例外是**参数非法**（§18.4）：那不是「尝试失败」，而是**启动前**即被拒绝，不进入重试循环。

### 18.6 并发约束

- **同一时刻只允许一个重试会话**（全局，不区分目标）。会话运行期间，启动按钮禁用并说明「已有重试会话进行中」。
- **重复 start 必须被拒绝，而不是静默覆盖**：宿主端点在已有会话在飞时返回 **409 + `RETRY_IN_FLIGHT`**（与 R25 单测的 `TEST_IN_FLIGHT` 同族但**不同码**，便于区分两种在飞态）；**不得**以新会话替换旧会话、**不得**静默忽略、**不得**排队等待。
- 会话运行期间，**单次测试**（§11.2 `POST /test`）**允许**并发执行（用户可同时手动测别的目标），但须遵守其自身的同目标 409 保护（R25）。
- 会话的启动 / 状态查询 / 停止三个动作由宿主端点承载（端点契约见 §18.7）。

### 18.7 宿主端点增量（3 个）

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `POST` | `/api/model-health/retry/start` | 启动重试会话；已在飞时返回 409 + `RETRY_IN_FLIGHT` |
| `GET` | `/api/model-health/retry/status` | 查询当前会话状态（无会话时返回 `{active:false}`） |
| `POST` | `/api/model-health/retry/stop` | 手动停止；无会话时返回 409（不得静默成功） |

统一响应头、错误体形如 `{ok:false,error:{code,message}}` 的约定与 §11 一致。**端点字段的完整定义由实现任务（t35）按本节语义冻结**；本节只规定语义与约束，不预先发明字段名以外的结构。
状态查询响应**至少**须能表达：是否在飞、`sessionId`、已尝试次数、下次尝试时间、选定模式、三个参数、以及（已结束时）停止原因与最后一次结果。

## 当前默认模型

> **本节为 v1.0.8 新增**（用户 2026-09-18 需求）。需求编号 **R34–R36**，验收编号 **AC28–AC30**（均为新编号，不改动既有 R/AC 编号语义）。

### 19.1 定位与用户诉求

**诉求原文**：「再加个将当前模型设置为默认选择，这样每次打开，都能快速测试自己默认使用的模型了」。

**定位**：面板打开时**默认选中用户平时使用的那个模型**，用户点一次「发送测试」即可测它，不必每次在四行选择器里重新点一遍；反过来，用户也能把当前选中的模型一键设为新的默认。

**关键设计决定（不新增自有存储）**：默认模型的真相就是**宿主自己的** `agent-default-model` 命名空间（由 `@deepseek-ai/dsh-agent-default-model` 注册，见 `dsh-base` 的 `cordis.patch.yml`）。写它就等于真正改变了「新建 Agent 的默认模型」，而不是在本插件里另记一份私有偏好——后者会与宿主的真实默认值分叉，用户改了系统默认后本面板会给出过期答案。

### 19.2 读取与映射

**读取（只读，绝不写）**：`ctx.get("settings").get("agent-default-model")` → `{ provider, model, reasoningEffort? }`。

- `source` 字段区分 `user`（用户在 settings.yaml 显式设过，判据 = `describe()` 的 `user` 层存在且含 `provider`）与 `base`（只有 composition 默认值），供面板区分「你设的」与「宿主默认」。
- 命名空间未注册 / 字段不全 / settings 不可用 → `available:false` + 中文 `reason`，**绝不让插件纤维失败**。

**★ 映射（易错点，必须照此实现）**：命名空间里的 `provider` 是 **llm-pi-ai 的 provider 路由名**（即本插件术语的 `routeKey`，如 `max66`），**不是** `providers[].id`（那是归一化 baseURL 的 sha1 前缀）。

映射规则 `(routeKey, modelId) → { providerId, groupId, modelKey, routeKey }`：

1. **逐分组查找**，不得只看第一个分组——同一 baseURL 下可能有多个 api 分组（本机 `http://max66.xyz/v1` 同时有 openai 与 anthropic 两个分组）。
2. 必须命中「该分组内存在该 `modelId` 的模型行」**且**「该路由的 `modelIds` 含该 `modelId`」（AC23 不变式）。
3. 定位不到 → 返回 `null`，面板回落 §7.3 默认选择并给出**可见提示**（不静默）。

`GET /config` 新增字段：

```json
{
  "defaultModel": {
    "available": true,
    "provider": "max66",
    "model": "deepseek-v4.1-flash",
    "reasoningEffort": "max",
    "source": "user",
    "reason": null,
    "selection": { "providerId": "…", "groupId": "…", "modelKey": "…", "routeKey": "max66" }
  },
  "retryDefaults": { "mode": "strict", "intervalMinutes": 1, "maxAttempts": 30, "maxDurationMinutes": 30, "unlimited": false }
}
```

### 19.3 写入（`POST /api/model-health/default`）

- 请求体 `{ "routeKey": "max66", "modelId": "deepseek-v4.1-flash" }`；`routeKey`/`modelId` 必填字符串。
- **校验**：路由不存在 → 404 `UNKNOWN_ROUTE`；该路由未声明该模型 → 400 `UNKNOWN_MODEL`；字段缺失/类型不符 → 400 `BAD_REQUEST`；settings 不可写 → 5xx `SETTINGS_READONLY` / `SETTINGS_WRITE_FAILED`（**不得谎报成功**）。
- **用 `replace` 而非 `update`**：`update` 是合并语义，**无法移除字段**。若目标模型不支持现有的 `reasoningEffort`，合并会把那个非法挡位留在用户层。`replace` 写整节，缺席键回落 composition base 与 schema 默认值——正是「默认选择 = 该路由 + 该模型，effort 交给宿主决定」的语义。
- **`reasoningEffort` 只在目标模型确实支持时才带**（判据 = `models[].reasoningEfforts` 含该值）；不支持则**丢弃**，不得写入一个该模型无法执行的挡位。
- 响应 `{ ok:true, written:{…}, defaultModel:{…同 §19.2…} }`（回填最新默认模型，面板无需二次请求）。
- **只写 `agent-default-model` 一节，绝不碰 `llm-pi-ai`**（AC19 配置只读不变式）。

### 19.4 `groups[].models[]` 新增字段

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `reasoningEfforts` | `string[]` | 该模型可用的推理挡位名。配置里既可能是数组，也可能是 `{ off: null, low: "low", … }` 对象（**对象形态的键**才是挡位名），两种都归一为字符串数组；缺失/畸形一律 `[]` |

### 19.5 面板行为

- **首次加载**（`sel === null`）时按 §19.2 的 `selection` 预选；**之后**每次配置刷新仍按 §7.3 用稳定 id 保持选择（预选只影响首次，不覆盖用户正在进行的操作）。
- 面板在「参数行」内提供「设为默认」按钮：当前选中已是默认时显示「已是默认」且**禁用**；否则点击后写入并即时回显结果（成功/失败一句话）。
- 判据 = `provider` 与 `model` **两者都相等**；只看 `provider` 会在「同一路由下的另一个模型」上误判为已是默认。
- 该按钮与重试控件**并入既有参数行**（见 `ui-spec` §3.6），**不新增行高**——AC15 一屏预算的硬约束优先。

## 假设、风险与变更控制

- 本规格依赖的假设与其风险等级见同目录 `ASSUMPTIONS.md`；高风险假设均已完成验证并回填结论。
- 规格冻结后，任何范围变化（新增协议、新增端点、改字段名、改状态语义）必须走变更单，由 captain 决策后更新本文件版本号，并同步通知 t4 / t15 / t16 / t17 / t13。
- 已知偏差清单（有意为之，非缺陷，评审时按此判定）：① 不应用路由 `headers` / `compat`；② anthropic 探针走稳定端点而非 `?beta=true`；③ 无空闲超时，只有总超时；④ 无批量测试；⑤ openai-responses 本机无真实样本。

## 追溯索引

| 小节 | 覆盖的任务要求 | 主要下游任务 |
| --- | --- | --- |
| §3 插件定位与非目标 | 插件定位与非目标（不做实时监控 / 轮询 / 告警 / 历史趋势；边界修订见 §2.2 第 1、2 条） | t17 评审 |
| §5 配置数据模型与读取路径 | 配置数据模型与读取路径 | t4 |
| §6 三协议完整规则表 | 三协议完整规则表 | t4、t16、t17 |
| §7 四层选择器：数据流与分组算法 | 四层选择器数据流与分组算法 | t4、t15 |
| §9 状态机与三层诊断链 | 状态机与三层诊断链、降级规则 | t4、t15 |
| §10 错误映射表（错误处理） | 错误人话化 | t4、t15 |
| §11 宿主 HTTP 端点契约 | 宿主端点契约 | t4、t15 |
| §12 测试记录结构与内存策略 | 测试记录 RingBuffer 50 条 | t4 |
| §14 验收标准 | 验收标准清单 | t16、t17、t13 |
| **§18 自动重试（直到成功）** | **自动重试功能（用户 2026-09-18 确认）：两种成功判定模式、参数域、4 条停止条件、致命错误不短路、单会话并发约束、3 个端点增量** | **t35（宿主实现）、t34（ui-spec 控件）、t16 / t17（验收与评审）** |
| **§19 当前默认模型** | **默认模型功能（用户 2026-09-18 需求）：只读宿主 `agent-default-model`、逐分组映射、replace 写入与 effort 取舍、首次预选、1 个端点增量 + 2 个 config 字段增量** | **宿主 `lib/default-model.js`、客户端 `lib/client.js`、`tests/default-model.test.mjs` / `tests/client-retry-default.test.mjs` / `tests/host-endpoints.test.mjs`** |
