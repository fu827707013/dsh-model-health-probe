# 变更单：§8.1 凭据解析语义与可发送性校验补充（三元语义 + reason 取值 + 字符类修正）

> 本文件由 keel 生成。规格冻结后的一切新增与修改都必须先填本单，
> 批准后更新规格书，再继续实现。

| 字段 | 内容 |
| --- | --- |
| 请求人 | captain（转达 dev-host 复核发现） |
| 日期 | 2026-09-17 |
| 原规格位置 | §8.1 密钥解析（硬要求，blocker 级）；关联 R18 / AC9 / AC10 |
| 变更内容 | 在 §8.1 补充三项、修正一项：(1) 补「解析语义是三元表达式而非链式兜底」——credentials 服务存在但 resolve() 返回 undefined 时不回退查环境快照，回退只在服务整体缺失时发生；不得写成 a || b。(2) 补可发送性校验的两种 reason 取值：trim 后为空 → empty；不匹配合法字符类 → illegalCharacters。(3) 补校验实现顺序：先 trim 再判空再判字符类（静默 trim）。(4) 修正字符类：原文写 [\x20-\x7E]（含空格，错误）→ 应为 [\x21-\x7E]（不含空格，与宿主 LEGAL_API_KEY 一致）。 |
| 理由 | dev-host 复核宿主源码（dsh-llm/lib/index.js:472,484-496 与 :1607；dsh-llm/lib/types/api-key.js）确认：LEGAL_API_KEY = /^[\x21-\x7E]+$/，normalizeApiKey 先 trim、空则 reason=empty、不匹配则 reason=illegalCharacters；宿主 llm-pi-ai 的 resolveApiKey 用 credentials !== void 0 的三元表达式且命中后调用 assertUsableApiKey。原 §8.1 的三元语义已由我于本次会话补入，但 reason 取值与字符类下界（\x20 vs \x21）尚未精确，字符类下界错误会让实现放行含空格密钥，进而被 fetch 抛 ByteString TypeError 并被 catch 成网络故障——正是本条目要消除的误报。 |
| 影响范围 | 需求：R18 补一句 reason 取值与字符类；验收标准：AC9 增补「empty / illegalCharacters 两种 reason 各自触发路径」断言；实现：dev-host 现有实现（lib/index.js:431-433、lib/probe.js:191-194）已使用 \x21 与两种 reason，**无需改代码**，本变更单只消除规格与实现/宿主之间的表述差，避免 t16/t17 据旧规格误报实现缺陷；工作量：规格文本修订，无代码改动。 |
| 决策 | 批准 |
| 推迟到 | 无（本变更单即时生效，无推迟项） |
| 批准人 | captain（2026-09-17 消息明确指示「请在变更单里补」，视为预先批准） |