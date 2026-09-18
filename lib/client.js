/**
 * dsh-model-health-probe — WebUI 面板（client bundle）
 *
 * 会话视图注册「模型健康检查」页签（conversation.view 槽），手动触发一次真实裸 HTTP
 * 探测，渲染耗时 / HTTP 状态 / token 用量 / 响应内容 / 三层诊断链 / 最近记录。
 *
 * 构建协议：手写 __ModuleLoader__ bundle（与 tsdown 产物同协议），**零构建链**：
 *   依赖仅 react（shell seed）；服务经 ctx.slots 注入。
 *
 * 视觉与交互按 docs/ui-spec.md 实现（§2 token 与数值照抄、§3 组件钩子与尺寸、
 * §4 状态迁移与防重复、§6 无障碍清单）。DOM 契约钩子一律用 data-mh-*，供 t16/t17
 * 按 §7 的 V-L / V-S / V-A / V-T / V-M / V-C 六组判据做渲染级核对。
 *
 * 契约纪律（SPEC R26）：客户端**只渲染不重算**——
 *   - 不自行拼接 URL、不构造请求体（URL 只取自 previewUrl / requestPreview[].url / actualUrl）
 *   - 不生成中文诊断文案（layers[].label/detail、error.title/hint 全部由宿主给，原样渲染）
 *   - 不判定状态（status 由宿主给；本面板只维护 untested / testing 两个本地态）
 *
 * 非目标：**不做任何定时轮询**（仅挂载时取一次 config 与 records，测试后刷新 records）。
 *
 * 主题适配（ui-spec §2.1）：颜色一律走 var(--dsw-alias-*, <主题无关 fallback>)；
 * 状态色用 color-mix(状态色 P%, label-primary) 一个声明自动适配双主题；
 * 字号走 `font:` 简写（--dsw-font-* 是 font 简写，写进 font-size 会被整条丢弃），
 * 且 font-variant-numeric 必须写在 font **之后**。
 */
window.__ModuleLoader__.load({
	id: "dsh-model-health-probe",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		const React = require("react");
		const { useState, useEffect, useCallback, useRef, useMemo } = React;
		const h = React.createElement;

		/**
		 * 放大弹窗用 portal 挂到 document.body：面板根节点在会话滚动容器内
		 * （`[data-mh-root]` 自身 `overflow-y:auto`），弹窗留在里面会被**祖先滚动容器裁切**，
		 * 且 `z-index` 也压不过外层 shell。
		 *
		 * `require` 失败时**不抛**：退回就地渲染（overlay 是 `position:fixed`，
		 * 实测本面板到 body 的祖先链上 transform/filter/contain 全为 none，
		 * 故就地渲染同样能全屏覆盖）。这保证「拿不到 react-dom 也不白屏」。
		 */
		let createPortal = null;
		try {
			const rd = require("react-dom");
			if (rd && typeof rd.createPortal === "function") createPortal = rd.createPortal;
		} catch (e) {
			createPortal = null;
		}

		// ---------- 端点（同源，SPEC §11 / §18.7 / §19.4） ----------
		const CONFIG_URL = "/api/model-health/config";
		const TEST_URL = "/api/model-health/test";
		const RECORDS_URL = "/api/model-health/records";
		const RETRY_START_URL = "/api/model-health/retry/start";
		const RETRY_STATUS_URL = "/api/model-health/retry/status";
		const RETRY_STOP_URL = "/api/model-health/retry/stop";
		const DEFAULT_URL = "/api/model-health/default";

		const STYLE_ID = "dsh-model-health-probe-style";
		const DASH = "\u2014"; // —

		/** 本地态 + 宿主态的统一展示元数据（ui-spec §3.8 / §3.12）。 */
		const ST = {
			untested: { label: "未测试", glyph: "\u25cb", tone: "idle" },
			testing: { label: "测试中", glyph: null, tone: "biz" },
			healthy: { label: "Healthy", glyph: "\u2713", tone: "ok" },
			slow: { label: "Slow", glyph: "!", tone: "warn" },
			failed: { label: "Failed", glyph: "\u2715", tone: "err" }
		};

		/** 三层诊断链顺序固定（SPEC §9.2）。 */
		const LAYER_ORDER = ["api", "model", "strict"];
		const LAYER_GLYPH = { pass: "\u2713", fail: "\u2715", skip: "\u2014" };
		const LAYER_NO = { api: "\u2460", model: "\u2461", strict: "\u2462" };

		/**
		 * 协议说明（第二行「API 类型」需说明文字）。
		 * 注意：**不得**出现 §7.6 V-C1 禁止的路径字面量，故只描述协议不写路径。
		 */
		const API_HINT = {
			"openai-completions": "OpenAI 兼容协议；该 baseURL 通常需自带 /v1 后缀",
			"openai-responses": "OpenAI Responses 协议；该 baseURL 通常需自带 /v1 后缀",
			"anthropic-messages": "Anthropic Messages 协议；该 baseURL 不应带 /v1 后缀"
		};

		/** reasons 的中文标注（仅展示用，不改写宿主判定）。 */
		const REASON_TEXT = { "slow-latency": "超出阈值", "strict-mismatch": "严格校验不符" };

		/** 响应区分段（ui-spec §3.11）。 */
		const TABS = [
			{ id: "model", label: "模型文本" },
			{ id: "raw", label: "原始响应" },
			{ id: "req", label: "请求详情" }
		];

		/** 重试模式（§18.2，互斥必选其一；默认严格）。 */
		const RETRY_MODES = [
			{ id: "strict", label: "严格", title: "严格模式：响应 trim 后须精确等于期望值，且未超慢阈值才算成功" },
			{ id: "connectivity", label: "连通", title: "连通模式：HTTP 2xx 且响应体解析成功即算成功，不比对内容" }
		];

		/** 停止原因 → 中文结论（§18.5 四条）。 */
		const STOP_TEXT = {
			success: "成功",
			"max-attempts": "已达最大次数",
			"max-duration": "已达最长时长",
			"stopped-by-user": "已手动停止"
		};

		// ---------- 纯逻辑（不依赖 React，供 t16/t17 单测直接调用） ----------

		/** 状态键（SPEC 术语表 / ui-spec §4.2）。 */
		function statusKey(routeKey, modelId, stream) {
			return String(routeKey) + "::" + String(modelId) + "::" + (stream ? "stream" : "plain");
		}

		function providerById(config, id) {
			return ((config && config.providers) || []).find((p) => p.id === id) || null;
		}

		function groupById(config, id) {
			return ((config && config.groups) || []).find((g) => g.id === id) || null;
		}

		function modelByKey(group, key) {
			if (group === null || group === undefined) return null;
			return (group.models || []).find((m) => m.modelKey === key) || null;
		}

		/**
		 * 默认选中（SPEC R7）：`providers[0] → 首个分组 → models[0] → routeKeys[0]`。
		 *
		 * 健壮性：若首个供应商的分组缺失或该分组未声明模型（配置畸形 / 刷新后 id 失效），
		 * 继续向后找**第一个真正可用**的 (provider, group, model)；全不可用才返回 null
		 * （面板据此显示空态），避免「首个供应商不可用 → 整面板空白」。
		 */
		function defaultSelection(config) {
			const providers = (config && config.providers) || [];
			const groups = (config && config.groups) || [];
			for (const p of providers) {
				for (const gid of p.groupIds || []) {
					const g = groups.find((x) => x.id === gid);
					if (g === undefined) continue;
					const m = (g.models || [])[0];
					if (m === undefined) continue;
					const routeKeys = m.routeKeys || [];
					return {
						providerId: p.id,
						groupId: g.id,
						modelKey: m.modelKey,
						routeKey: routeKeys[0] === undefined ? null : routeKeys[0]
					};
				}
			}
			return null;
		}

		/**
		 * 第四行「路由」是否渲染：**分组作用域**（SPEC §7.4 / R6）——
		 * 只看所选分组自身的路由条数，与选了哪个模型无关。
		 * 分组只有 1 条路由时该路由自动成为目标，**整行不渲染**（不是 display:none）。
		 */
		function row4Visible(group) {
			return group !== null && group !== undefined && Number(group.routeCount) > 1;
		}

		/**
		 * 第四行列出的候选路由：按所选模型收窄为 models[m].routeKeys。
		 * 注意：候选数为 1 时**仍然渲染**（不隐藏），只有 row4Visible() 为 false 才隐藏。
		 */
		function row4Candidates(group, model) {
			if (group === null || group === undefined || model === null || model === undefined) return [];
			const keys = model.routeKeys || [];
			const routes = group.routes || [];
			return keys.map(
				(k) => routes.find((r) => r.routeKey === k) || { routeKey: k, displayName: k, credential: null }
			);
		}

		/** 所选模型是否只被 1 条路由声明（用于给用户解释，不影响第四行是否渲染）。 */
		function singleRouteModel(group, model) {
			return (
				group !== null &&
				group !== undefined &&
				model !== null &&
				model !== undefined &&
				(model.routeKeys || []).length === 1
			);
		}

		/**
		 * 选择互斥联动（SPEC R7）：切上行即重算下行。
		 * 优先落在该供应商下**第一个声明了模型的**分组；若全部分组都无模型，
		 * 则停在首个分组上（第三行显示「该分组未声明模型」并禁用发送）。
		 */
		function selectProvider(config, providerId) {
			const p = providerById(config, providerId);
			if (p === null) return defaultSelection(config);
			let firstGroup = null;
			for (const gid of p.groupIds || []) {
				const g = groupById(config, gid);
				if (g === null) continue;
				if (firstGroup === null) firstGroup = g;
				const m = (g.models || [])[0];
				if (m === undefined) continue;
				return {
					providerId: p.id,
					groupId: g.id,
					modelKey: m.modelKey,
					routeKey: (m.routeKeys || [])[0] === undefined ? null : m.routeKeys[0]
				};
			}
			if (firstGroup === null) return { providerId: p.id, groupId: null, modelKey: null, routeKey: null };
			return { providerId: p.id, groupId: firstGroup.id, modelKey: null, routeKey: null };
		}

		function selectGroup(config, providerId, groupId) {
			const g = groupById(config, groupId);
			if (g === null) return selectProvider(config, providerId);
			const m = (g.models || [])[0];
			if (m === undefined) return { providerId, groupId: g.id, modelKey: null, routeKey: null };
			return {
				providerId,
				groupId: g.id,
				modelKey: m.modelKey,
				routeKey: (m.routeKeys || [])[0] === undefined ? null : m.routeKeys[0]
			};
		}

		/** 切模型：重算第四行候选；若原路由不在候选中则回落到首个候选。 */
		function selectModel(config, sel, modelKey) {
			if (sel === null) return sel;
			const g = groupById(config, sel.groupId);
			const m = modelByKey(g, modelKey);
			if (m === null) return sel;
			const cands = row4Candidates(g, m);
			const keep = cands.some((r) => r.routeKey === sel.routeKey);
			return {
				providerId: sel.providerId,
				groupId: sel.groupId,
				modelKey: m.modelKey,
				routeKey: keep ? sel.routeKey : (cands[0] === undefined ? null : cands[0].routeKey)
			};
		}

		/**
		 * config 刷新后按**稳定 id** 保持选择（SPEC §7.3 / ui-spec §4.2）：
		 * 原 id 仍存在则保持，否则回落默认并给出提示。
		 */
		function reconcileSelection(prev, config) {
			const fallback = defaultSelection(config);
			if (prev === null || prev === undefined) return { selection: fallback, notice: null };
			if (fallback === null) return { selection: null, notice: null };
			const p = providerById(config, prev.providerId);
			if (p === null) return { selection: fallback, notice: "配置已变化，已回到默认选择" };
			const g = groupById(config, prev.groupId);
			if (g === null || (p.groupIds || []).indexOf(g.id) === -1) {
				return { selection: selectProvider(config, p.id), notice: "配置已变化，已回到默认选择" };
			}
			const m = modelByKey(g, prev.modelKey);
			if (m === null) return { selection: selectGroup(config, p.id, g.id), notice: "配置已变化，已回到默认选择" };
			const cands = row4Candidates(g, m);
			const keep = cands.some((r) => r.routeKey === prev.routeKey);
			return {
				selection: {
					providerId: p.id,
					groupId: g.id,
					modelKey: m.modelKey,
					routeKey: keep ? prev.routeKey : (cands[0] === undefined ? null : cands[0].routeKey)
				},
				notice: keep ? null : "配置已变化，已回到默认选择"
			};
		}

		/** 当前选中的 (provider, group, model, route)；任一缺失返回 null。 */
		function resolveTarget(config, sel) {
			if (config === null || sel === null) return null;
			const p = providerById(config, sel.providerId);
			const g = groupById(config, sel.groupId);
			const m = modelByKey(g, sel.modelKey);
			if (p === null || g === null || m === null) return null;
			const cands = row4Candidates(g, m);
			const route = cands.find((r) => r.routeKey === sel.routeKey) || null;
			return { provider: p, group: g, model: m, route, candidates: cands };
		}

		/**
		 * 请求预览：URL 只取自宿主产物，客户端**不拼接**（SPEC §11.1 / R26）。
		 * 真实发送时只替换 headers 里的占位符，故 actualUrl 恒等于此处的 url（AC4）。
		 */
		function previewFor(group, stream) {
			if (group === null || group === undefined) return { method: "POST", url: null, headers: null };
			const rp = group.requestPreview;
			if (rp === undefined || rp === null) return { method: "POST", url: group.previewUrl || null, headers: null };
			const pv = stream ? rp.stream : rp.nonStream;
			if (pv === undefined || pv === null) return { method: "POST", url: group.previewUrl || null, headers: null };
			return { method: pv.method || "POST", url: pv.url || null, headers: pv.headers || null };
		}

		/** 耗时格式化：< 1000 用 ms，否则用 s（保留 2 位）。 */
		function fmtMs(v) {
			if (v === null || v === undefined || !Number.isFinite(Number(v))) return DASH;
			const n = Number(v);
			if (n < 1000) return n + "ms";
			return (n / 1000).toFixed(2) + "s";
		}

		/** token / 数值格式化：无值显示占位符，不显示 0。 */
		function fmtNum(v) {
			if (v === null || v === undefined || !Number.isFinite(Number(v))) return DASH;
			return String(v);
		}

		function fmtTime(ms) {
			if (!Number.isFinite(Number(ms))) return DASH;
			const d = new Date(Number(ms));
			const p2 = (x) => (x < 10 ? "0" : "") + x;
			return p2(d.getHours()) + ":" + p2(d.getMinutes()) + ":" + p2(d.getSeconds());
		}

		/** 仅供展示的截断（不改语义）。 */
		function clip(s, n) {
			const t = String(s === null || s === undefined ? "" : s);
			return t.length > n ? t.slice(0, n) + "\u2026" : t;
		}

		// ---------- 响应内容视图（面板内联 + 放大弹窗**共用同一份模型**） ----------
		//
		// 为什么要有这一层：内联块与弹窗若各自算一遍，两处必然漂移（一处美化了、一处没美化），
		// 而「漂移」在只看 DOM 文本存在性的检查里是隐形的。故两边都只消费 viewModel()。

		/**
		 * 尝试把文本解析成 JSON 并 2 空格缩进。
		 * 返回 `{ok:true, text, kind}` 或 `{ok:false, reason}`——**绝不抛异常、绝不改原文语义**。
		 *
		 * 注意：`JSON.parse` 接受裸数字/裸字符串（`"123"` → 123），这会把「模型只回了 OK 两个字」
		 * 之外的纯数字响应也判成「可美化」并把引号剥掉。故此处只接受对象与数组——
		 * 它们才是「响应体 / 采样事件」的真实形态，也才是用户说「JSON 格式化」时指的东西。
		 */
		function tryFormatJson(text, indent) {
			const raw = String(text === null || text === undefined ? "" : text);
			if (raw.trim() === "") return { ok: false, reason: "内容为空" };
			let parsed;
			try {
				parsed = JSON.parse(raw);
			} catch (e) {
				return { ok: false, reason: String((e && e.message) || e) };
			}
			if (parsed === null || typeof parsed !== "object") {
				return { ok: false, reason: "不是 JSON 对象或数组" };
			}
			const n = Number.isFinite(Number(indent)) ? Number(indent) : 2;
			return {
				ok: true,
				text: JSON.stringify(parsed, null, n),
				kind: Array.isArray(parsed) ? "array" : "object"
			};
		}

		/**
		 * 单块内容在「原文 / 美化」下的呈现。
		 *
		 * `truncatable` 表示该块可能已被宿主截断（请求体上限 4000 字符、原始响应 8192）。
		 * 截断后的 JSON **必然**解析失败，此时若只说「不是合法 JSON」，用户会去怀疑自己的
		 * 请求体有问题——故必须把「已截断」作为**首要**原因报出来（如实说明，不掩盖）。
		 */
		function viewBlockText(text, pretty, truncatable) {
			const raw = String(text === null || text === undefined ? "" : text);
			const probe = tryFormatJson(raw);
			const canPretty = probe.ok === true;
			if (pretty !== true || !canPretty) {
				let reason = null;
				if (pretty === true && !canPretty) {
					reason = truncatable === true ? "内容已截断，不是完整 JSON" : probe.reason;
				}
				return { text: raw, pretty: false, canPretty: canPretty, reason: reason, jsonReason: probe.reason };
			}
			return { text: probe.text, pretty: true, canPretty: true, reason: null, jsonReason: null };
		}

		/**
		 * 请求详情的**分块**模型（ui-spec §3.11）。
		 *
		 * ★ 用户明确指出：请求详情**不是一个完整 JSON**，是三块独立内容拼在一起，
		 *   对它整体做 JSON 格式化必然失败（且失败后会静默显示原文，用户会以为功能坏了）。
		 *   故这里按块建模：每块**各自**判断能否美化——请求头通常可以，请求体若被截断则不能，
		 *   系统提示词是自然语言、本就不是 JSON。
		 */
		function reqSections(result, systemPrompt) {
			if (result === null || result === undefined) return [];
			const sys = String(
				systemPrompt === undefined || systemPrompt === null || systemPrompt === "" ? DASH : systemPrompt
			);
			const headers = JSON.stringify(result.requestHeaders || {}, null, 1);
			const body =
				result.requestBodyPreview === null || result.requestBodyPreview === undefined
					? ""
					: String(result.requestBodyPreview);
			return [
				{ key: "sys", label: "系统提示", text: sys, truncatable: false },
				{ key: "headers", label: "请求头", text: headers, truncatable: false },
				{ key: "body", label: "请求体", text: body, truncatable: true }
			];
		}

		/**
		 * 当前 tab 的完整视图模型：内联块与弹窗都渲染它（**同一份数据、同一套措辞**，
		 * 避免两处漂移——漂移在只看「DOM 文本存在性」的检查里是隐形的）。
		 *
		 * 返回 `{view,title,blocks,metrics,copyText,canPretty,prettyReason}`：
		 *   - `blocks[]` = `{key,label,text,pretty,canPretty,reason,empty}`；
		 *   - `canPretty` = 当前视图是否**有任何一块**可美化（决定开关是否禁用）；
		 *   - `prettyReason` = 全不可美化时给 `title` 的中文原因。
		 */
		function viewModel(result, view, systemPrompt, pretty) {
			const v = view === "raw" || view === "req" ? view : "model";
			const title = v === "raw" ? "原始响应" : v === "req" ? "请求详情" : "模型文本";
			if (result === null || result === undefined) {
				return {
					view: v,
					title: title,
					blocks: [],
					metrics: textMetrics(""),
					copyText: "",
					canPretty: false,
					prettyReason: "无结果"
				};
			}

			if (v === "req") {
				const secs = reqSections(result, systemPrompt);
				const blocks = secs.map((s) => {
					const b = viewBlockText(s.text, pretty, s.truncatable);
					return {
						key: s.key,
						label: s.label,
						text: b.text,
						pretty: b.pretty,
						canPretty: b.canPretty,
						reason: b.reason,
						empty: String(s.text).trim() === ""
					};
				});
				const anyPretty = blocks.some((b) => b.canPretty === true);
				/* 复制给**原文**：用户复制的是请求详情本身，不是我们美化后的排版 */
				const copyText = secs.map((s) => s.label + "：\n" + s.text).join("\n\n");
				return {
					view: v,
					title: title,
					blocks: blocks,
					metrics: textMetrics(copyText),
					copyText: copyText,
					canPretty: anyPretty,
					prettyReason: anyPretty ? null : "请求详情为分块文本（系统提示 / 请求头 / 请求体），无可格式化块"
				};
			}

			const isRaw = v === "raw";
			const src = isRaw ? result.responseRaw : result.responseText;
			const empty = src === null || src === undefined || src === "";
			const text = empty ? "" : String(src);
			/* 模型文本档**在函数内部**强制不美化，而不是依赖调用方传 false：
			   规格明确「模型文本不是代码」，把这条约束放在唯一的数据出口上，
			   调用方漏传也不会破坏它（否则美化开关一开，模型文本会被当成 JSON 缩进）。 */
			const b = viewBlockText(text, isRaw ? pretty : false, isRaw);
			return {
				view: v,
				title: title,
				blocks: [
					{
						key: v,
						label: null,
						text: b.text,
						pretty: b.pretty,
						canPretty: b.canPretty,
						reason: b.reason,
						empty: text === ""
					}
				],
				metrics: textMetrics(text),
				copyText: text,
				canPretty: b.canPretty,
				prettyReason: b.canPretty ? null : b.reason
			};
		}

		/**
		 * 文本计量（用户要的「次数」是这块内容的规模，不是测试次数）：
		 * 字符数 / 行数 / UTF-8 字节数。字节数按 UTF-8 估算（中文 3 字节），
		 * 面板只用于显示规模，不参与任何判定。
		 */
		function textMetrics(text) {
			const t = String(text === null || text === undefined ? "" : text);
			let bytes = 0;
			for (let i = 0; i < t.length; i += 1) {
				const c = t.charCodeAt(i);
				if (c < 0x80) bytes += 1;
				else if (c < 0x800) bytes += 2;
				else if (c >= 0xd800 && c <= 0xdbff) {
					bytes += 4;
					i += 1; // 代理对：跳过低位
				} else bytes += 3;
			}
			return {
				chars: t.length,
				lines: t === "" ? 0 : t.split("\n").length,
				bytes: bytes
			};
		}

		/** 计量的一行中文描述（内联与弹窗共用，避免两处措辞不一致）。 */
		function metricsText(text) {
			const m = textMetrics(text);
			return m.chars + " 字符 · " + m.lines + " 行 · " + m.bytes + " 字节";
		}

		/** 密钥状态点（ui-spec §3.2）：已配置 / 未配置 / 未知（空心）。 */
		function credentialState(cred) {
			if (cred === null || cred === undefined) {
				return { kind: "unknown", title: "无密钥引用（该路由未声明 apiKeyEnv）" };
			}
			if (cred.configured === true) {
				return { kind: "ok", title: "密钥 " + (cred.ref || DASH) + " 已配置" };
			}
			if (cred.configured === false) {
				return { kind: "bad", title: "未配置密钥 " + (cred.ref || DASH) };
			}
			return { kind: "unknown", title: "密钥配置状态未知（凭据服务不可用）" };
		}

		// ---------- 重试与默认模型的纯逻辑（供 t16/t17 直接单测） ----------

		/**
		 * 面板初值：重试控件（§18.4 默认列）。
		 * 宿主下发 `retryDefaults` 时以它为准，缺失时用本地兜底，保证控件永远有合法初值。
		 */
		function initialRetry(config) {
			const d = (config && config.retryDefaults) || {};
			return {
				mode: d.mode === "connectivity" ? "connectivity" : "strict",
				interval: String(d.intervalMinutes === undefined ? 1 : d.intervalMinutes),
				maxAttempts: String(d.maxAttempts === undefined ? 30 : d.maxAttempts),
				maxDuration: String(d.maxDurationMinutes === undefined ? 30 : d.maxDurationMinutes)
			};
		}

		/**
		 * 一位小数校验（与宿主 retry.js 同一规则，前端只做**预检**以便即时禁用按钮）。
		 *
		 * 用整数化比较而非 `%`——`0.3 % 0.1` 在 IEEE754 下不为 0，用取余会误判合法值。
		 * 判定权仍在宿主（前端不重算业务结论，R26 的精神一致）：此处只决定按钮可用性。
		 */
		function oneDecimal(v) {
			const n = Number(v);
			if (!Number.isFinite(n)) return false;
			return Math.abs(n * 10 - Math.round(n * 10)) < 1e-9;
		}

		/**
		 * 参数校验（§18.4）。返回 `{ok, reason}`；`reason` 是给 `title` 的中文原因。
		 * 与宿主 validateRetryParams 同域：0.1 下限、一位小数、次数非负整数、时长非负。
		 *
		 * 注意：必须先做「非空且是纯数字」检查再转 Number——`Number(" ")` 是 **0**，
		 * 直接把空白串当数字会让 `" "` 通过「次数 = 0（不限）」的校验，于是空输入被
		 * 静默当成「不限次数」，用户以为没填就没事，实际会无限重试。
		 */
		function isNumericText(v) {
			return typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v));
		}

		function validateRetryForm(form) {
			if (!isNumericText(form.interval)) return { ok: false, reason: "间隔必须是数字（分钟）" };
			const interval = Number(form.interval);
			if (interval < 0.1) return { ok: false, reason: "间隔不得小于 0.1 分钟（6 秒）" };
			if (!oneDecimal(interval)) return { ok: false, reason: "间隔最多一位小数（如 0.5、2.5）" };

			if (!isNumericText(form.maxAttempts)) return { ok: false, reason: "最大次数必须是不小于 0 的整数（0 = 不限）" };
			const maxAttempts = Number(form.maxAttempts);
			if (!Number.isInteger(maxAttempts) || maxAttempts < 0) {
				return { ok: false, reason: "最大次数必须是不小于 0 的整数（0 = 不限）" };
			}

			if (!isNumericText(form.maxDuration)) return { ok: false, reason: "最长时长必须是不小于 0 的数字（0 = 不限）" };
			const maxDuration = Number(form.maxDuration);
			if (maxDuration < 0) return { ok: false, reason: "最长时长必须是不小于 0 的数字（0 = 不限）" };
			if (!oneDecimal(maxDuration)) return { ok: false, reason: "最长时长最多一位小数（如 0.5、2.5）" };

			return { ok: true, reason: null };
		}

		/** 两者同为 0 = 不限：须以**可见文本**提示（§18.4 / AC25），不得只放 title。 */
		function retryUnlimited(form) {
			return Number(form.maxAttempts) === 0 && Number(form.maxDuration) === 0;
		}

		/** 会话进行中的结论文案（§18.3 末条：面板须能答「第几次 / 最后一次 / 停止原因」）。 */
		function retrySummary(session) {
			if (session === null || session === undefined || session.active !== true) {
				if (session !== null && session !== undefined && session.stopReason) {
					const label = STOP_TEXT[session.stopReason] || session.stopReason;
					if (session.stopReason === "success") return "第 " + session.attempts + " 次尝试成功（" + label + "）";
					return "已停止：" + label + "（共 " + session.attempts + " 次尝试）";
				}
				return null;
			}
			return "重试中 · 已尝试 " + session.attempts + " 次";
		}

		/**
		 * 当前选中的 (routeKey, modelId) 是否就是宿主默认模型（决定「设为默认」按钮的态）。
		 * 两个字段都要相等——只看 routeKey 会在「同一路由下的另一个模型」上误判为已是默认。
		 */
		function isCurrentDefault(defaultModel, routeKey, modelId) {
			if (defaultModel === null || defaultModel === undefined || defaultModel.available !== true) return false;
			return defaultModel.provider === routeKey && defaultModel.model === modelId;
		}

		/**
		 * 首次加载时的选择（§19.2）：优先落到**用户默认模型**，定位不到再回落 §7.3 默认选择。
		 *
		 * 这是本次新增功能的核心——「每次打开都默认选中我平时用的模型」。
		 * @returns {{selection:object|null, notice:string|null, fromDefault:boolean}}
		 */
		function initialSelection(config) {
			const fallback = defaultSelection(config);
			const dm = config === null || config === undefined ? null : config.defaultModel;
			if (dm !== null && dm !== undefined && dm.available === true && dm.selection !== null && dm.selection !== undefined) {
				return { selection: dm.selection, notice: null, fromDefault: true };
			}
			const notice =
				dm !== null && dm !== undefined && dm.available === true && (dm.selection === null || dm.selection === undefined)
					? "默认模型（" + dm.provider + " / " + dm.model + "）在当前配置中定位不到，已回到默认选择"
					: null;
			return { selection: fallback, notice, fromDefault: false };
		}

		// ---------- 样式（ui-spec §2；语义 token + font 简写 + color-mix） ----------

		function css() {
			return [
				/* ★ token 块与布局块**必须分开写**：放大弹窗用 createPortal 挂到 document.body，
				   它**不在** [data-mh-root] 内——若 token 仍挂在 root 上，弹窗里所有 var(--mh-*)
				   会全部失效（颜色/字号/圆角一起崩），而且这种失效在「只看 DOM 文本存在性」
				   的检查里完全看不见。故 token 选择器必须同时覆盖 overlay。 */
				"[" + "data-mh-root],[data-mh-modal-overlay]{",
				/* 状态色：一个声明双主题自动正确（ui-spec §2.1 规则 3 / §2.3） */
				"  --mh-ok:color-mix(in srgb, var(--dsw-alias-state-success-primary,currentColor) 56%, var(--dsw-alias-label-primary,currentColor));",
				"  --mh-warn:color-mix(in srgb, var(--dsw-alias-state-warn-primary,currentColor) 54%, var(--dsw-alias-label-primary,currentColor));",
				"  --mh-err:color-mix(in srgb, var(--dsw-alias-state-error-primary,currentColor) 78%, var(--dsw-alias-label-primary,currentColor));",
				"  --mh-biz:color-mix(in srgb, var(--dsw-alias-state-business-primary,currentColor) 82%, var(--dsw-alias-label-primary,currentColor));",
				/* 14% 淡底：把目标底写进 color-mix，浅色加白 / 深色加暗自动正确 */
				"  --mh-ok-bg:color-mix(in srgb, var(--dsw-alias-state-success-primary,currentColor) 14%, var(--dsw-alias-bg-layer-1,transparent));",
				"  --mh-warn-bg:color-mix(in srgb, var(--dsw-alias-state-warn-primary,currentColor) 14%, var(--dsw-alias-bg-layer-1,transparent));",
				"  --mh-err-bg:color-mix(in srgb, var(--dsw-alias-state-error-primary,currentColor) 14%, var(--dsw-alias-bg-layer-1,transparent));",
				"  --mh-biz-bg:color-mix(in srgb, var(--dsw-alias-state-business-primary,currentColor) 14%, var(--dsw-alias-bg-layer-1,transparent));",
				/* 字号档：子 token 长写属性三元组（ui-spec §2.4）。
				   刻意不用 font 简写——font 是「重置型」简写，会重置 font-variant-numeric
				   与 font-feature-settings，且无法单独覆盖字重。子 token 只能赋给
				   对应的长写属性（-font-size → font-size，依此类推）。 */
				"  --mh-fs-metric:var(--dsw-font-base-strong-16-font-size,16px);",
				"  --mh-fw-metric:var(--dsw-font-base-strong-16-font-weight,500);",
				"  --mh-lh-metric:var(--dsw-font-base-strong-16-line-height,24px);",
				"  --mh-fs-title:var(--dsw-font-xs-strong-13-font-size,13px);",
				"  --mh-fw-title:var(--dsw-font-xs-strong-13-font-weight,500);",
				"  --mh-lh-title:var(--dsw-font-xs-strong-13-line-height,20px);",
				"  --mh-fs-label:var(--dsw-font-xs-13-font-size,13px);",
				"  --mh-fw-label:var(--dsw-font-xs-13-font-weight,400);",
				"  --mh-lh-label:var(--dsw-font-xs-13-line-height,20px);",
				"  --mh-fs-btn:var(--dsw-font-xxs-strong-12-font-size,12px);",
				"  --mh-fw-btn:var(--dsw-font-xxs-strong-12-font-weight,500);",
				"  --mh-lh-btn:var(--dsw-font-xxs-strong-12-line-height,18px);",
				"  --mh-fs-body:var(--dsw-font-s-14-font-size,14px);",
				"  --mh-fw-body:var(--dsw-font-s-14-font-weight,400);",
				"  --mh-lh-body:var(--dsw-font-s-14-line-height,22px);",
				"  --mh-fs-small:var(--dsw-font-xxs-12-font-size,12px);",
				"  --mh-fw-small:var(--dsw-font-xxs-12-font-weight,400);",
				"  --mh-lh-small:var(--dsw-font-xxs-12-line-height,18px);",
				"  --mh-fs-tiny:var(--dsw-font-xxxs-11-font-size,11px);",
				"  --mh-fw-tiny:var(--dsw-font-xxxs-11-font-weight,400);",
				"  --mh-lh-tiny:var(--dsw-font-xxxs-11-line-height,14px);",
				"  --mh-mono:var(--ds-font-family-code,\"SF Mono\",Consolas,\"Liberation Mono\",Menlo,monospace);",
				"  --mh-text:var(--dsw-alias-label-primary,currentColor);",
				"  --mh-mute:var(--dsw-alias-label-secondary,currentColor);",
				"  --mh-weak:var(--dsw-alias-label-tertiary,currentColor);",
				"  --mh-line:var(--dsw-alias-border-l2,rgba(128,128,128,.35));",
				"  --mh-line3:var(--dsw-alias-border-l3,rgba(128,128,128,.45));",
				"  --mh-card:var(--dsw-alias-bg-layer-1,transparent);",
				"  --mh-sunken:var(--dsw-alias-bg-module-platform,transparent);",
				"  --mh-code:var(--dsw-alias-markdown-code-block,transparent);",
				"  --mh-hover:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.12));",
				"  --mh-active:var(--dsw-alias-interactive-bg-active,rgba(128,128,128,.18));",
				"  --mh-accent:var(--dsw-alias-state-business-primary,currentColor);",
				"  --mh-skeleton:var(--dsw-alias-bg-skeleton,rgba(128,128,128,.12));",
				"  --mh-elev:var(--dsw-elevation-panel,0 0 0 .5px rgba(128,128,128,.25));",
				"}",
				/* 根容器：内边距 / 因果流 / 一屏预算（ui-spec §1.1 / V-L10） */
				"[" + "data-mh-root]{",
				"  display:flex;flex-direction:column;gap:14px;",
				"  padding:16px 20px 24px;",
				/* flex:1 1 0 —— 用户裁定「小屏时允许面板内滚动」的实现。
				   只写 height:100% 在可增长的 flex 父容器下不构成上界（父容器被内容撑高
				   → 溢出上浮到 scrollBody → 页面级滚动），不是用户批准的行为。
				   flex-basis:0 使 root 被约束为槽位高 → 溢出留在面板内部。
				   注意 guard 的配方不可照搬：guard 内部有 flex:1 1 auto 的滚动区吸收空间，
				   而本面板 5 个功能块（rail/preview/test/result/records）全是 flex:none，
				   唯一可收缩的 data-mh-live 是 1px 高的屏读区（实测 flex:0 1 auto / h=1px），
				   吸收不了溢出，故必须靠 root 自身收缩。
				   实测 flex:1 1 auto / flexGrow:1 / max-height:100% 均无效（仍撑高）。 */
				"  height:100%;min-height:0;flex:1 1 0;overflow-y:auto;",
				"  font-size:var(--mh-fs-small);font-weight:var(--mh-fw-small);line-height:var(--mh-lh-small);",
				"  font-variant-numeric:tabular-nums;",
				"  color:var(--mh-text);box-sizing:border-box;width:100%;",
				"}",
				"[data-mh-root] *{box-sizing:border-box;}",
				/* 等宽「代码」文本共用钩子（ui-spec §2.4「代码 / URL / 原始响应」档）。
				   刻意放在具体元素规则**之前**：同为单属性选择器时后写者胜，
				   故各元素自身的更精确规则仍优先，既有渲染不变。 */
				"[data-mh-code]{font-family:var(--mh-mono);font-size:11px;line-height:19px;",
				"  font-variant-numeric:tabular-nums;}",
				/* 徽标内的状态指示点（ui-spec §3.8：徽标内嵌 [data-mh-badge-dot] + 文字） */
				"[data-mh-badge-dot]{display:inline-flex;align-items:center;justify-content:center;flex:0 0 auto;}",
				/* 区块 */
				"[data-mh-rail],[data-mh-preview],[data-mh-test],[data-mh-result],[data-mh-records]{flex:none;min-width:0;}",
				/* ① 选择条 */
				"[data-mh-rail]{display:flex;flex-direction:column;gap:6px;}",
				"[data-mh-row]{display:flex;flex-wrap:wrap;align-items:flex-start;gap:8px;min-height:26px;}",
				"[data-mh-row-label]{flex:0 0 64px;text-align:left;color:var(--mh-mute);",
				"  font-size:var(--mh-fs-tiny);font-weight:var(--mh-fw-tiny);line-height:var(--mh-lh-tiny);padding-top:6px;}",
				"[data-mh-chips]{display:flex;flex-wrap:wrap;gap:6px;flex:1 1 auto;min-width:0;}",
				/* note 与芯片同行：ui-spec §1.3 的 ① 预算 = 4×26（行高）+ 3×6（行间距）= 122px，
				   即每行都是 26px。若 note 用 flex:1 1 100% 独占一行，route 行会变 46px（26+14+6），
				   rail 涨到 142 → 默认态（4 行 + note）下长响应即溢出 12px（AC15 违规）。
				   flex:0 1 auto + min-width:0 让它与芯片同行、必要时可收缩；
				   空间不足时由 [data-mh-row] 的 flex-wrap 换到下一行（优雅降级，不裁剪文字）。 */
				"[data-mh-row-note]{flex:0 1 auto;min-width:0;color:var(--mh-mute);",
				"  font-size:var(--mh-fs-tiny);font-weight:var(--mh-fw-tiny);line-height:var(--mh-lh-tiny);}",
				/* 芯片（ui-spec §3.1） */
				"[data-mh-chip]{display:inline-flex;align-items:center;max-width:100%;height:26px;",
				"  padding:0 10px;border-radius:999px;border:1px solid var(--mh-line);background:transparent;",
				"  color:var(--mh-mute);font-size:var(--mh-fs-small);font-weight:var(--mh-fw-small);line-height:var(--mh-lh-small);",
				"  font-variant-numeric:tabular-nums;font-family:inherit;cursor:pointer;white-space:nowrap;}",
				"[data-mh-chip]:hover:not([aria-disabled='true']){background:var(--mh-hover);}",
				"[data-mh-chip]:active:not([aria-disabled='true']){background:var(--mh-active);}",
				"[data-mh-chip]:focus-visible{outline:2px solid var(--mh-accent);outline-offset:2px;}",
				"[data-mh-chip][aria-checked='true']{background:var(--mh-biz-bg);color:var(--mh-text);",
				"  font-weight:500;box-shadow:inset 0 0 0 1.5px var(--mh-accent);}",
				"[data-mh-chip][aria-disabled='true']{opacity:.45;cursor:not-allowed;}",
				"[data-mh-chip-label]{overflow:hidden;text-overflow:ellipsis;}",
				"[data-mh-chip-badge]{margin-left:5px;color:var(--mh-mute);",
				"  font-size:var(--mh-fs-tiny);font-weight:var(--mh-fw-tiny);line-height:var(--mh-lh-tiny);font-variant-numeric:tabular-nums;}",
				"[data-mh-glyph][aria-hidden='true']{display:inline-block;}",
				"[data-mh-chip-glyph]{margin-right:4px;color:var(--mh-accent);}",
				/* 配置状态点 */
				"[data-mh-dot]{display:inline-block;width:6px;height:6px;border-radius:50%;vertical-align:middle;}",
				"[data-mh-dot='ok']{background:var(--mh-ok);}",
				"[data-mh-dot='bad']{background:var(--mh-err);}",
				"[data-mh-dot='unknown']{border:1.5px solid var(--mh-weak);background:transparent;}",
				"[data-mh-dot='idle']{background:var(--mh-weak);}",
				/* ② 将请求（内凹底） */
				"[data-mh-preview]{background:var(--mh-sunken);border-radius:10px;padding:4px 10px;",
				"  display:flex;flex-direction:column;gap:0;}",
				"[data-mh-preview-line]{display:flex;align-items:center;gap:8px;min-width:0;height:18px;}",
				"[data-mh-preview-method]{font-family:var(--mh-mono);font-size:11px;line-height:19px;",
				"  color:var(--mh-mute);flex:0 0 auto;}",
				"[data-mh-preview-url]{font-family:var(--mh-mono);font-size:11px;line-height:19px;",
				"  color:var(--mh-text);flex:1 1 auto;min-width:0;word-break:break-all;",
				"  display:-webkit-box;-webkit-line-clamp:1;-webkit-box-orient:vertical;overflow:hidden;}",
				"[data-mh-preview-meta]{color:var(--mh-mute);",
				"  font-size:var(--mh-fs-tiny);font-weight:var(--mh-fw-tiny);line-height:var(--mh-lh-tiny);height:18px;",
				"  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}",
				"[data-mh-preview-note]{color:var(--mh-mute);",
				"  font-size:var(--mh-fs-tiny);font-weight:var(--mh-fw-tiny);line-height:var(--mh-lh-tiny);min-height:16px;}",
				"[data-mh-preview-warn]{display:flex;align-items:flex-start;gap:6px;margin-top:4px;",
				"  color:var(--mh-text);font-size:var(--mh-fs-tiny);font-weight:var(--mh-fw-tiny);line-height:var(--mh-lh-tiny);}",
				"[data-mh-warnbar]{flex:0 0 3px;align-self:stretch;min-height:14px;border-radius:2px;background:var(--mh-warn);}",
				"[data-mh-warnbar='err']{background:var(--mh-err);}",
				/* 图标按钮 / 复制 */
				"[data-mh-iconbtn]{flex:0 0 auto;width:24px;height:24px;display:inline-flex;align-items:center;",
				"  justify-content:center;border-radius:6px;border:1px solid transparent;background:transparent;",
				"  color:var(--mh-mute);font-family:inherit;cursor:pointer;padding:0;}",
				"[data-mh-iconbtn]:hover{background:var(--mh-hover);}",
				"[data-mh-iconbtn]:focus-visible{outline:2px solid var(--mh-accent);outline-offset:2px;}",
				/* 放大按钮：与复制按钮同尺寸同排，但 hover 时用 accent 色把它从复制按钮里区分出来
				   （两个图标相邻且都是「方框里一个字形」，不区分会点错）。 */
				"[data-mh-zoom]{color:var(--mh-mute);}",
				"[data-mh-zoom]:hover{color:var(--mh-accent);}",
				/* 弹窗关闭按钮：hover 用 error 色，与相邻的复制/放大按钮区分开 */
				"[data-mh-modal-close]{color:var(--mh-mute);}",
				"[data-mh-modal-close]:hover{color:var(--mh-err);}",
				/* ③ 测试区 */
				/* ③ 测试区：ui-spec §1.3 预算 100px = 8 + 30 + 6 + 28 + 20 + 8。
				   实测 110px（param 实际 30.4 而非 28）→ 超预算 10px，也是 V-L11「单块偏差 ≤ 4」的失败项。
				   行距 6→4、内边距 8→6：106 → 102，偏差 +2 ≤ 4。控件尺寸与可点区域不变。 */
				"[data-mh-test]{display:flex;flex-direction:column;gap:4px;padding:6px 10px;",
				"  border:1px solid var(--mh-line3);border-radius:10px;background:var(--mh-card);}",
				/* 视觉隐藏但保留在可访问性树中（供 aria-labelledby / aria-describedby 引用）。
				   ui-spec §1.3 的 ③ 预算 100px 不含独立标题行，故标题走 sr-only。 */
				"[data-mh-sr]{position:absolute;width:1px;height:1px;padding:0;margin:-1px;",
				"  overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0;}",
				"[data-mh-test-title]{color:var(--mh-text);",
				"  font-size:var(--mh-fs-title);font-weight:var(--mh-fw-title);line-height:var(--mh-lh-title);}",
				/* 测试消息行：label / textarea / 字符计数 同一行 → 行高 = 30px（ui-spec §1.3 ③） */
				"[data-mh-msg-row]{display:flex;align-items:center;gap:8px;min-width:0;}",
				"[data-mh-field]{display:flex;flex-direction:column;gap:2px;min-width:0;}",
				"[data-mh-field-head]{display:flex;align-items:baseline;justify-content:space-between;gap:8px;min-width:0;}",
				"[data-mh-field-label]{flex:0 0 auto;color:var(--mh-mute);white-space:nowrap;",
				"  font-size:var(--mh-fs-tiny);font-weight:var(--mh-fw-tiny);line-height:var(--mh-lh-tiny);}",
				"[data-mh-field-hint]{color:var(--mh-mute);",
				"  font-size:var(--mh-fs-tiny);font-weight:var(--mh-fw-tiny);line-height:var(--mh-lh-tiny);}",
				/* 字符计数（ui-spec §3.5）：tabular-nums，≥2000 转 error 混合色 */
				"[data-mh-count]{flex:0 0 auto;color:var(--mh-mute);font-variant-numeric:tabular-nums;",
				"  font-size:var(--mh-fs-tiny);font-weight:var(--mh-fw-tiny);line-height:var(--mh-lh-tiny);}",
				"[data-mh-count][data-over='1']{color:var(--mh-err);}",
				/* 只读「系统提示」：与其它只读项同行，超长单行截断（title/请求详情给全文）。
				   宽度上限 260→150：新增「设为默认」与重试控件后总宽超出，参数行会换行、
				   把 test 块撑高 → 破坏 AC15 一屏预算。**功能未删减**：全文仍可在 title
				   与「请求详情」页签中查看（§3.11）。 */
				"[data-mh-ro-sys]{display:inline-flex;align-items:baseline;gap:5px;min-width:0;max-width:150px;}",
				"[data-mh-ro-sys] [data-mh-ro-v]{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;}",
				"[data-mh-msg]{flex:1 1 auto;min-width:0;width:auto;height:30px;min-height:30px;max-height:66px;resize:none;",
				"  font-size:var(--mh-fs-body);font-weight:var(--mh-fw-body);line-height:var(--mh-lh-body);color:var(--mh-text);",
				"  background:var(--mh-card);border:1px solid var(--mh-line3);border-radius:10px;",
				"  padding:3px 10px;overflow-y:auto;}",
				"[data-mh-msg]::placeholder{color:var(--mh-mute);opacity:1;}",
				"[data-mh-msg]:focus-visible{outline:2px solid var(--mh-accent);outline-offset:1px;}",
				/* 参数行（§3.6）：一行放下流式开关 + 4 个只读项 + 设为默认 + 重试控件 + 主按钮。
				   gap 12→8：新增控件后总宽超出，8px 间距使参数行在 1280 宽容器下仍不换行
				   （换行会把 test 块撑高 22px+，直接破坏 AC15 一屏预算）。
				   实测依据：tests/client-retry-default.test.mjs 的宽度预算断言 + 渲染级实测。 */
				"[data-mh-param]{display:flex;flex-wrap:wrap;align-items:center;gap:6px 8px;min-height:28px;}",
				"[data-mh-switchwrap]{display:inline-flex;align-items:center;gap:6px;}",
				"[data-mh-switch]{position:relative;flex:0 0 auto;width:36px;height:20px;padding:0;",
				"  border-radius:999px;border:1px solid var(--mh-line3);background:var(--mh-sunken);",
				"  cursor:pointer;}",
				"[data-mh-switch][aria-checked='true']{background:var(--dsw-alias-brand-primary,currentColor);border-color:transparent;}",
				"[data-mh-switch]:focus-visible{outline:2px solid var(--mh-accent);outline-offset:2px;}",
				"[data-mh-switch-knob]{position:absolute;top:1px;left:1px;width:16px;height:16px;border-radius:50%;",
				"  background:var(--dsw-alias-label-primary-foreground,currentColor);",
				"  transition:transform .12s ease;}",
				"[data-mh-switch][aria-checked='true'] [data-mh-switch-knob]{transform:translateX(16px);}",
				"[data-mh-label-inline]{color:var(--mh-mute);",
				"  font-size:var(--mh-fs-small);font-weight:var(--mh-fw-small);line-height:var(--mh-lh-small);}",
				"[data-mh-ro]{display:inline-flex;align-items:baseline;gap:5px;}",
				/* ro-k 必须 nowrap + 不收缩：容器被挤压时，4 个汉字会被压到 23px 宽而
				   **逐字竖排折行**（实测 0.1.4 真实缺陷：参数行被从 28px 撑到 66px）。
				   被截断的应是 ro-v（有 ellipsis），不是标签。 */
				"[data-mh-ro-k]{color:var(--mh-mute);white-space:nowrap;flex:0 0 auto;",
				"  font-size:var(--mh-fs-tiny);font-weight:var(--mh-fw-tiny);line-height:var(--mh-lh-tiny);}",
				"[data-mh-ro-v]{color:var(--mh-mute);font-size:var(--mh-fs-small);font-weight:var(--mh-fw-small);line-height:var(--mh-lh-small);",
				"  font-variant-numeric:tabular-nums;}",
				"[data-mh-send]{flex:0 0 auto;height:28px;padding:0 14px;border-radius:999px;border:1px solid transparent;",
				"  background:var(--dsw-alias-button-primary-fill,currentColor);",
				"  color:var(--dsw-alias-label-primary-foreground,currentColor);",
				"  font-size:var(--mh-fs-btn);font-weight:var(--mh-fw-btn);line-height:var(--mh-lh-btn);cursor:pointer;",
				"  display:inline-flex;align-items:center;gap:6px;margin-left:auto;}",
				"[data-mh-send]:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover,currentColor);}",
				"[data-mh-send]:focus-visible{outline:2px solid var(--mh-accent);outline-offset:2px;}",
				"[data-mh-send]:disabled{opacity:.45;cursor:not-allowed;}",
				"[data-mh-send]:active:not(:disabled){transform:translateY(1px);}",
				"[data-mh-test-slot]{min-height:20px;display:flex;align-items:center;}",
				"[data-mh-test-error]{color:var(--mh-err);",
				"  font-size:var(--mh-fs-tiny);font-weight:var(--mh-fw-tiny);line-height:var(--mh-lh-tiny);}",
				/* ---------- 重试控件（§18；与只读项同行 → 不新增行高，守住 AC15 预算） ---------- */
				"[data-mh-retrywrap]{display:inline-flex;align-items:center;gap:5px;flex:0 0 auto;}",
				"[data-mh-retryseg]{display:inline-flex;align-items:center;gap:2px;padding:1px;",
				"  border-radius:999px;border:1px solid var(--mh-line3);background:var(--mh-sunken);}",
				"[data-mh-retrymode]{height:18px;padding:0 8px;border-radius:999px;border:1px solid transparent;",
				"  background:transparent;color:var(--mh-mute);font-family:inherit;cursor:pointer;",
				"  font-size:var(--mh-fs-tiny);font-weight:var(--mh-fw-tiny);line-height:var(--mh-lh-tiny);}",
				"[data-mh-retrymode]:hover{background:var(--mh-hover);}",
				"[data-mh-retrymode]:focus-visible{outline:2px solid var(--mh-accent);outline-offset:1px;}",
				"[data-mh-retrymode][aria-checked='true']{background:var(--mh-biz-bg);color:var(--mh-text);",
				"  box-shadow:inset 0 0 0 1px var(--mh-accent);}",
				"[data-mh-retrymode]:disabled{opacity:.45;cursor:not-allowed;}",
				/* 数字输入：命中区放大到 22px 高（原生上下箭头过小的既有反馈） */
				"[data-mh-retrynum]{display:inline-flex;align-items:center;gap:3px;flex:0 0 auto;}",
				"[data-mh-retrynum] label{color:var(--mh-mute);",
				"  font-size:var(--mh-fs-tiny);font-weight:var(--mh-fw-tiny);line-height:var(--mh-lh-tiny);white-space:nowrap;}",
				"[data-mh-retryinput]{width:52px;height:22px;padding:0 6px;border-radius:6px;",
				"  border:1px solid var(--mh-line3);background:var(--mh-card);color:var(--mh-text);",
				"  font-family:inherit;font-size:var(--mh-fs-small);font-weight:var(--mh-fw-small);",
				"  line-height:var(--mh-lh-small);font-variant-numeric:tabular-nums;}",
				"[data-mh-retryinput]:focus-visible{outline:2px solid var(--mh-accent);outline-offset:1px;}",
				"[data-mh-retryinput][aria-invalid='true']{border-color:var(--mh-err);}",
				"[data-mh-retryinput]:disabled{opacity:.55;cursor:not-allowed;}",
				"[data-mh-retrygo]{flex:0 0 auto;height:22px;padding:0 10px;border-radius:999px;",
				"  border:1px solid var(--mh-line3);background:transparent;color:var(--mh-text);",
				"  font-family:inherit;font-size:var(--mh-fs-tiny);font-weight:var(--mh-fw-tiny);",
				"  line-height:var(--mh-lh-tiny);cursor:pointer;display:inline-flex;align-items:center;gap:4px;}",
				"[data-mh-retrygo]:hover:not(:disabled){background:var(--mh-hover);}",
				"[data-mh-retrygo]:focus-visible{outline:2px solid var(--mh-accent);outline-offset:1px;}",
				"[data-mh-retrygo]:disabled{opacity:.45;cursor:not-allowed;}",
				"[data-mh-retrygo][data-kind='stop']{border-color:var(--mh-err);color:var(--mh-err);}",
				/* 会话状态与「不限」提示：同一行内、可换行，不额外占块 */
				"[data-mh-retrystatus]{color:var(--mh-mute);flex:0 1 auto;min-width:0;overflow:hidden;",
				"  text-overflow:ellipsis;white-space:nowrap;",
				"  font-size:var(--mh-fs-tiny);font-weight:var(--mh-fw-tiny);line-height:var(--mh-lh-tiny);}",
				"[data-mh-retrystatus][data-tone='ok']{color:var(--mh-ok);}",
				"[data-mh-retrystatus][data-tone='warn']{color:var(--mh-warn);}",
				"[data-mh-retrywarn]{color:var(--mh-warn);flex:1 1 auto;min-width:0;",
				"  font-size:var(--mh-fs-tiny);font-weight:var(--mh-fw-tiny);line-height:var(--mh-lh-tiny);}",
				/* ---------- 「设为默认」按钮（§19.5） ---------- */
				"[data-mh-defbtn]{flex:0 0 auto;height:22px;padding:0 9px;border-radius:999px;",
				"  border:1px solid var(--mh-line3);background:transparent;color:var(--mh-mute);",
				"  font-family:inherit;font-size:var(--mh-fs-tiny);font-weight:var(--mh-fw-tiny);",
				"  line-height:var(--mh-lh-tiny);cursor:pointer;display:inline-flex;align-items:center;gap:4px;",
				"  white-space:nowrap;}",
				"[data-mh-defbtn]:hover:not(:disabled){background:var(--mh-hover);color:var(--mh-text);}",
				"[data-mh-defbtn]:focus-visible{outline:2px solid var(--mh-accent);outline-offset:1px;}",
				"[data-mh-defbtn]:disabled{opacity:.55;cursor:not-allowed;}",
				"[data-mh-defbtn][data-current='1']{color:var(--mh-ok);border-color:var(--mh-ok);cursor:default;}",
				/* 默认模型设置结果（成功/失败一句话，复用 test-slot 的常驻 20px 槽位） */
				"[data-mh-defnotice]{color:var(--mh-mute);",
				"  font-size:var(--mh-fs-tiny);font-weight:var(--mh-fw-tiny);line-height:var(--mh-lh-tiny);",
				"  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%;}",
				/* 结果区（唯一抬升面） */
				/* ④ 结果区：ui-spec §1.3 预算 210px = 12 + 40 + 12 + 58 + 12 + 76（padding 6 上下）。
				   实测 Failed 态 229.6（错误块 52）→ 收错误块到 38 后仍 215.6，再收块间距 12→8 → 211.6。
				   偏差 +1.6 ≤ 4（V-L11）。 */
				"[data-mh-result]{display:flex;flex-direction:column;gap:8px;padding:6px;",
				"  border:1px solid var(--mh-line3);border-radius:10px;background:var(--mh-card);",
				"  box-shadow:var(--mh-elev);}",
				"[data-mh-result-head]{display:flex;align-items:center;gap:12px;flex-wrap:wrap;min-height:40px;}",
				"[data-mh-badge]{display:inline-flex;align-items:center;gap:6px;height:24px;padding:0 10px;",
				"  border-radius:999px;font-size:var(--mh-fs-title);font-weight:var(--mh-fw-title);line-height:var(--mh-lh-title);}",
				"[data-mh-badge][data-tone='ok']{background:var(--mh-ok-bg);" +
				"  color:color-mix(in srgb, var(--dsw-alias-state-success-primary,currentColor) 56%, var(--dsw-alias-label-primary,currentColor));}",
				"[data-mh-badge][data-tone='warn']{background:var(--mh-warn-bg);" +
				"  color:color-mix(in srgb, var(--dsw-alias-state-warn-primary,currentColor) 54%, var(--dsw-alias-label-primary,currentColor));}",
				"[data-mh-badge][data-tone='err']{background:var(--mh-err-bg);" +
				"  color:color-mix(in srgb, var(--dsw-alias-state-error-primary,currentColor) 78%, var(--dsw-alias-label-primary,currentColor));}",
				"[data-mh-badge][data-tone='biz']{background:var(--mh-biz-bg);" +
				"  color:color-mix(in srgb, var(--dsw-alias-state-business-primary,currentColor) 82%, var(--dsw-alias-label-primary,currentColor));}",
				"[data-mh-badge][data-tone='idle']{background:var(--mh-sunken);color:var(--mh-mute);}",
				"[data-mh-elapsed]{color:var(--mh-mute);",
				"  font-size:var(--mh-fs-label);font-weight:var(--mh-fw-label);line-height:var(--mh-lh-label);font-variant-numeric:tabular-nums;}",
				"[data-mh-reason]{display:inline-flex;align-items:center;height:20px;padding:0 8px;border-radius:999px;",
				"  background:var(--mh-warn-bg);color:var(--mh-warn);",
				"  font-size:var(--mh-fs-tiny);font-weight:var(--mh-fw-tiny);line-height:var(--mh-lh-tiny);}",
				"[data-mh-metrics]{display:flex;gap:12px;flex-wrap:nowrap;min-width:0;flex:1 1 auto;}",
				"[data-mh-metric]{flex:1 1 0;min-width:0;display:flex;flex-direction:column;gap:0;}",
				"[data-mh-metric-label]{color:var(--mh-mute);",
				"  font-size:var(--mh-fs-tiny);font-weight:var(--mh-fw-tiny);line-height:var(--mh-lh-tiny);",
				"  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}",
				"[data-mh-metric-value]{color:var(--mh-text);",
				"  font-size:var(--mh-fs-metric);font-weight:var(--mh-fw-metric);line-height:var(--mh-lh-metric);",
				"  font-variant-numeric:tabular-nums;",
				"  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}",
				"[data-mh-metric-value][data-tone='ok']{color:var(--mh-ok);}",
				"[data-mh-metric-value][data-tone='err']{color:var(--mh-err);}",
				"[data-mh-metric-value][data-mute='1']{opacity:.55;}",
				/* 三层诊断链（横排 + ›） */
				"[data-mh-chain]{display:flex;align-items:stretch;gap:8px;}",
				"[data-mh-layer]{flex:1 1 0;min-width:0;height:58px;border-radius:8px;background:var(--mh-card);",
				"  border:1px solid var(--mh-line3);padding:6px 8px 6px 11px;display:flex;flex-direction:column;gap:2px;}",
				"[data-mh-layer][data-s='pass']{box-shadow:inset 3px 0 0 var(--mh-ok);}",
				"[data-mh-layer][data-s='fail']{box-shadow:inset 3px 0 0 var(--mh-err),inset 0 0 0 1px var(--mh-err);}",
				"[data-mh-layer][data-s='skip']{border-style:dashed;box-shadow:inset 3px 0 0 var(--mh-weak);}",
				"[data-mh-layer-head]{display:flex;align-items:center;gap:6px;height:16px;}",
				"[data-mh-layer-no]{flex:0 0 auto;width:16px;height:16px;border-radius:4px;display:inline-flex;",
				"  align-items:center;justify-content:center;background:var(--mh-sunken);color:var(--mh-mute);",
				"  font-size:var(--mh-fs-tiny);font-weight:var(--mh-fw-tiny);line-height:var(--mh-lh-tiny);}",
				"[data-mh-layer][data-s='pass'] [data-mh-layer-no]{background:var(--mh-ok-bg);color:var(--mh-ok);}",
				"[data-mh-layer][data-s='fail'] [data-mh-layer-no]{background:var(--mh-err-bg);color:var(--mh-err);}",
				"[data-mh-layer-glyph]{flex:0 0 auto;}",
				"[data-mh-layer][data-s='pass'] [data-mh-layer-glyph]{color:var(--mh-ok);}",
				"[data-mh-layer][data-s='fail'] [data-mh-layer-glyph]{color:var(--mh-err);}",
				"[data-mh-layer][data-s='skip'] [data-mh-layer-glyph]{color:var(--mh-weak);}",
				"[data-mh-layer-label]{color:var(--mh-text);",
				"  font-size:var(--mh-fs-btn);font-weight:var(--mh-fw-btn);line-height:var(--mh-lh-btn);",
				"  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}",
				"[data-mh-layer-detail]{color:var(--mh-mute);",
				"  font-size:var(--mh-fs-tiny);font-weight:var(--mh-fw-tiny);line-height:var(--mh-lh-tiny);",
				"  display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;}",
				"[data-mh-connector]{flex:0 0 auto;align-self:center;color:var(--mh-weak);",
				"  font-size:var(--mh-fs-tiny);font-weight:var(--mh-fw-tiny);line-height:var(--mh-lh-tiny);}",
				/* 错误块：ui-spec §982 规定 title → hint → code 三行。
				   但实测（真实 Failed 态，4 行选择器 + note）三行占 52px，把结果区推到 229.6（预算 210），
				   整面板 706 > 684 溢出 22px —— 而 Failed 正是本功能最该看清的状态（AC15）。
				   修法：**保持三要素与阅读顺序不变**，改为两行 —— 第 1 行 title 独占（13px 粗体，最高优先级），
				   第 2 行 hint + code 同行（baseline 对齐，code 用等宽小字）。
				   文字一字不减、不裁剪、不省略（hint 过长时自然换行）。52px → 38px。 */
				"[data-mh-error]{display:flex;gap:8px;align-items:flex-start;}",
				"[data-mh-errorbar]{flex:0 0 3px;align-self:stretch;min-height:32px;border-radius:2px;background:var(--mh-err);}",
				/* 内层容器：flex-wrap + column-gap，让 title 独占一行、hint 与 code 同行。
				   注意不要加 row-gap —— 实测 row-gap:2px 会让 4 行 + Failed 的最坏态余量从 4px 掉到 2px。 */
				"[data-mh-error] > div{display:flex;flex-wrap:wrap;align-items:baseline;column-gap:8px;}",
				"[data-mh-error-title]{flex:0 0 100%;color:var(--mh-text);",
				"  font-size:var(--mh-fs-title);font-weight:var(--mh-fw-title);line-height:var(--mh-lh-title);}",
				"[data-mh-error-hint]{color:var(--mh-mute);",
				"  font-size:var(--mh-fs-small);font-weight:var(--mh-fw-small);line-height:var(--mh-lh-small);}",
				"[data-mh-error-code]{color:var(--mh-mute);",
				"  font-size:var(--mh-fs-tiny);font-weight:var(--mh-fw-tiny);line-height:var(--mh-lh-tiny);font-family:var(--mh-mono);}",
				/* 响应区 */
				"[data-mh-response]{display:flex;flex-direction:column;gap:4px;}",
				"[data-mh-response-head]{display:flex;align-items:center;gap:8px;min-height:24px;flex-wrap:wrap;}",
				"[data-mh-response-title]{color:var(--mh-text);",
				"  font-size:var(--mh-fs-title);font-weight:var(--mh-fw-title);line-height:var(--mh-lh-title);}",
				"[data-mh-tablist]{display:inline-flex;gap:2px;padding:1px;border-radius:999px;background:var(--mh-sunken);}",
				"[data-mh-tab]{height:22px;padding:0 10px;border-radius:999px;border:1px solid transparent;",
				"  background:transparent;color:var(--mh-mute);font-family:inherit;cursor:pointer;",
				"  font-size:var(--mh-fs-tiny);font-weight:var(--mh-fw-tiny);line-height:var(--mh-lh-tiny);}",
				"[data-mh-tab][aria-selected='true']{background:var(--mh-biz-bg);color:var(--mh-text);",
				"  box-shadow:inset 0 0 0 1px var(--mh-accent);}",
				"[data-mh-tab]:focus-visible{outline:2px solid var(--mh-accent);outline-offset:1px;}",
				"[data-mh-aux]{color:var(--mh-mute);",
				"  font-size:var(--mh-fs-tiny);font-weight:var(--mh-fw-tiny);line-height:var(--mh-lh-tiny);font-variant-numeric:tabular-nums;",
				"  margin-left:auto;}",
				"[data-mh-tabpanel]{border-radius:8px;padding:2px 8px;overflow:auto;max-height:48px;",
				"  background:var(--mh-code);}",
				"[data-mh-tabpanel][data-view='model']{background:transparent;}",
				"[data-mh-tabpanel][data-view='model']{color:var(--mh-text);",
				"  font-size:var(--mh-fs-body);font-weight:var(--mh-fw-body);line-height:var(--mh-lh-body);}",
				"[data-mh-tabpanel][data-view='raw']{",
				"  color:var(--mh-text);font-family:var(--mh-mono);font-size:11px;line-height:19px;",
				"  white-space:pre-wrap;word-break:break-all;}",
				/* 请求详情：容器**不**设 pre-wrap/等宽（分块各自设），否则分块头也会被当代码排版。
				   内联块高 48px 装不下三块 → 允许它自己更高，但**不改变**其它两个 tab 的预算。 */
				"[data-mh-tabpanel][data-view='req']{color:var(--mh-text);}",
				"[data-mh-trunc]{color:var(--mh-warn);",
				"  font-size:var(--mh-fs-tiny);font-weight:var(--mh-fw-tiny);line-height:var(--mh-lh-tiny);}",
				"[data-mh-empty-text]{color:var(--mh-mute);font-style:italic;border-style:dashed;border-width:1px;",
				"  border-color:var(--mh-line3);border-radius:8px;padding:2px 8px;",
				"  font-size:var(--mh-fs-tiny);font-weight:var(--mh-fw-tiny);line-height:var(--mh-lh-tiny);}",
				/* ---------- 响应区分块（请求详情不是一整块 JSON，故按块渲染） ---------- */
				"[data-mh-section]{display:flex;flex-direction:column;gap:2px;min-width:0;}",
				"[data-mh-section] + [data-mh-section]{margin-top:4px;}",
				"[data-mh-section-head]{display:flex;align-items:center;gap:6px;min-height:14px;",
				"  color:var(--mh-mute);font-size:var(--mh-fs-tiny);font-weight:var(--mh-fw-tiny);",
				"  line-height:var(--mh-lh-tiny);font-variant-numeric:tabular-nums;}",
				"[data-mh-section-k]{flex:0 0 auto;white-space:nowrap;}",
				"[data-mh-section-meta]{flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;",
				"  white-space:nowrap;color:var(--mh-weak);}",
				"[data-mh-section-text]{color:var(--mh-text);font-family:var(--mh-mono);",
				"  font-size:11px;line-height:19px;white-space:pre-wrap;word-break:break-all;margin:0;}",
				"[data-mh-section][data-empty='1'] [data-mh-section-text]{color:var(--mh-mute);font-style:italic;}",
				/* 弹窗里的分块头：更大一档字号，仍复用同一批钩子 */
				"[data-mh-modal-body] [data-mh-section-head]{font-size:var(--mh-fs-small);line-height:var(--mh-lh-small);}",
				"[data-mh-modal-body] [data-mh-section-text]{font-size:12.5px;line-height:21px;}",
				/* ---------- 放大弹窗（portal 到 body，故 token 由 overlay 自身带） ---------- */
				/* ★ box-sizing 必须在 overlay 子树里重新声明：`[data-mh-root] *{box-sizing:border-box}`
				   覆盖不到 portal 出去的内容，默认 content-box 会让 padding 加到 width 上——
				   实测 `width:80vw` 渲染成 **82.2vw**（1403px/1707px），与用户要求的「占屏 80%」不符。 */
				"[data-mh-modal-overlay],[data-mh-modal-overlay] *{box-sizing:border-box;}",
				"[data-mh-modal-overlay]{position:fixed;inset:0;z-index:1200;display:flex;",
				"  align-items:center;justify-content:center;padding:24px;",
				"  background:var(--dsw-alias-bg-mask-1,rgba(0,0,0,.42));",
				"  font-size:var(--mh-fs-small);font-weight:var(--mh-fw-small);line-height:var(--mh-lh-small);",
				"  font-variant-numeric:tabular-nums;color:var(--mh-text);",
				"  animation:mh-fade .12s ease-out;}",
				"[data-mh-modal]{display:flex;flex-direction:column;gap:8px;",
				"  width:80vw;height:80vh;max-width:100%;max-height:100%;padding:14px 18px 16px;",
				"  border:1px solid var(--mh-line3);border-radius:14px;background:var(--mh-card);",
				"  box-shadow:0 18px 60px rgba(0,0,0,.28);overflow:hidden;}",
				"[data-mh-modal-head]{display:flex;align-items:center;gap:10px;flex:0 0 auto;min-height:28px;flex-wrap:wrap;}",
				"[data-mh-modal-title]{color:var(--mh-text);flex:0 0 auto;",
				"  font-size:var(--mh-fs-title);font-weight:var(--mh-fw-title);line-height:var(--mh-lh-title);}",
				"[data-mh-modal-sub]{color:var(--mh-mute);flex:0 1 auto;min-width:0;overflow:hidden;",
				"  text-overflow:ellipsis;white-space:nowrap;",
				"  font-size:var(--mh-fs-tiny);font-weight:var(--mh-fw-tiny);line-height:var(--mh-lh-tiny);}",
				"[data-mh-modal-meta]{color:var(--mh-mute);margin-left:auto;flex:0 0 auto;",
				"  font-size:var(--mh-fs-tiny);font-weight:var(--mh-fw-tiny);line-height:var(--mh-lh-tiny);",
				"  font-variant-numeric:tabular-nums;}",
				"[data-mh-modal-tools]{display:inline-flex;align-items:center;gap:6px;flex:0 0 auto;}",
				/* 美化开关：命中区 24px 高（不小于图标按钮，避免「原生小箭头」那类反馈重演） */
				"[data-mh-pretty]{flex:0 0 auto;height:24px;padding:0 10px;border-radius:999px;",
				"  border:1px solid var(--mh-line3);background:transparent;color:var(--mh-mute);",
				"  font-family:inherit;font-size:var(--mh-fs-tiny);font-weight:var(--mh-fw-tiny);",
				"  line-height:var(--mh-lh-tiny);cursor:pointer;display:inline-flex;align-items:center;gap:4px;",
				"  white-space:nowrap;}",
				"[data-mh-pretty]:hover:not(:disabled){background:var(--mh-hover);color:var(--mh-text);}",
				"[data-mh-pretty]:focus-visible{outline:2px solid var(--mh-accent);outline-offset:1px;}",
				"[data-mh-pretty][aria-pressed='true']{background:var(--mh-biz-bg);color:var(--mh-text);",
				"  box-shadow:inset 0 0 0 1px var(--mh-accent);}",
				"[data-mh-pretty]:disabled{opacity:.45;cursor:not-allowed;}",
				/* 弹窗正文：唯一可滚动区，撑满剩余高度 */
				"[data-mh-modal-body]{flex:1 1 auto;min-height:0;overflow:auto;overscroll-behavior:contain;",
				"  border-radius:8px;padding:8px 10px;background:var(--mh-code);",
				"  scrollbar-width:thin;}",
				"[data-mh-modal-body][data-view='model']{background:transparent;color:var(--mh-text);",
				"  font-family:inherit;font-size:var(--mh-fs-body);font-weight:var(--mh-fw-body);",
				"  line-height:var(--mh-lh-body);white-space:pre-wrap;word-break:break-word;}",
				"[data-mh-modal-empty]{color:var(--mh-mute);font-style:italic;",
				"  font-size:var(--mh-fs-small);font-weight:var(--mh-fw-small);line-height:var(--mh-lh-small);}",
				"[data-mh-modal-foot]{display:flex;align-items:center;gap:8px;flex:0 0 auto;min-height:24px;}",
				"[data-mh-modal-hint]{color:var(--mh-weak);flex:1 1 auto;min-width:0;",
				"  font-size:var(--mh-fs-tiny);font-weight:var(--mh-fw-tiny);line-height:var(--mh-lh-tiny);}",
				/* 弹窗打开时锁背景滚动（overlay 覆盖全屏，但仍要挡住底层滚动链） */
				"html[data-mh-modal-open='1'],html[data-mh-modal-open='1'] body{overflow:hidden;}",
				/* 历史 banner */
				"[data-mh-history-banner]{display:flex;align-items:center;gap:8px;padding:4px 8px;border-radius:6px;",
				"  background:var(--mh-biz-bg);color:var(--mh-text);",
				"  font-size:var(--mh-fs-tiny);font-weight:var(--mh-fw-tiny);line-height:var(--mh-lh-tiny);}",
				/* 未测试空态 */
				"[data-mh-result-empty]{display:flex;flex-direction:column;align-items:center;gap:4px;padding:14px 0;}",
				"[data-mh-result-empty-main]{color:var(--mh-mute);",
				"  font-size:var(--mh-fs-small);font-weight:var(--mh-fw-small);line-height:var(--mh-lh-small);}",
				"[data-mh-result-empty-sub]{color:var(--mh-mute);",
				"  font-size:var(--mh-fs-tiny);font-weight:var(--mh-fw-tiny);line-height:var(--mh-lh-tiny);}",
				/* 记录条 */
				"[data-mh-records]{border-top:1px solid var(--mh-line);padding-top:8px;overflow-y:auto;",
				"  scrollbar-width:thin;height:88px;flex:0 0 88px;}",
				"[data-mh-records-head]{display:flex;align-items:center;gap:8px;height:18px;",
				"  color:var(--mh-mute);font-size:var(--mh-fs-tiny);font-weight:var(--mh-fw-tiny);line-height:var(--mh-lh-tiny);}",
				"[data-mh-records-actions]{margin-left:auto;display:inline-flex;gap:6px;}",
				"[data-mh-textbtn]{height:24px;padding:0 8px;border-radius:6px;border:1px solid var(--mh-line);",
				"  background:transparent;color:var(--mh-text);font-family:inherit;cursor:pointer;",
				"  font-size:var(--mh-fs-tiny);font-weight:var(--mh-fw-tiny);line-height:var(--mh-lh-tiny);}",
				"[data-mh-textbtn]:hover:not(:disabled){background:var(--mh-hover);}",
				"[data-mh-textbtn]:focus-visible{outline:2px solid var(--mh-accent);outline-offset:2px;}",
				"[data-mh-textbtn]:disabled{opacity:.45;cursor:not-allowed;}",
				"[data-mh-record]{display:grid;grid-template-columns:14px 62px minmax(0,1.4fr) minmax(0,1fr) 64px 44px auto;",
				"  gap:8px;align-items:center;height:28px;padding:0 4px;border-radius:4px;cursor:pointer;",
				"  font-size:var(--mh-fs-small);font-weight:var(--mh-fw-small);line-height:var(--mh-lh-small);}",
				"[data-mh-record]:hover{background:var(--mh-hover);}",
				"[data-mh-record]:focus-visible{outline:2px solid var(--mh-accent);outline-offset:-2px;}",
				"[data-mh-record][aria-disabled='true']{opacity:.55;cursor:not-allowed;}",
				"[data-mh-record-time]{color:var(--mh-mute);",
				"  font-size:var(--mh-fs-tiny);font-weight:var(--mh-fw-tiny);line-height:var(--mh-lh-tiny);font-variant-numeric:tabular-nums;}",
				"[data-mh-record-model]{color:var(--mh-text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}",
				"[data-mh-record-route]{color:var(--mh-mute);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}",
				"[data-mh-record-lat]{color:var(--mh-mute);text-align:right;font-variant-numeric:tabular-nums;}",
				"[data-mh-record-http]{color:var(--mh-mute);text-align:right;font-variant-numeric:tabular-nums;}",
				"[data-mh-record-status]{color:var(--mh-mute);}",
				"[data-mh-record-status][data-tone='ok']{color:var(--mh-ok);}",
				"[data-mh-record-status][data-tone='warn']{color:var(--mh-warn);}",
				"[data-mh-record-status][data-tone='err']{color:var(--mh-err);}",
				"[data-mh-records-empty]{color:var(--mh-mute);padding:6px 0;",
				"  font-size:var(--mh-fs-tiny);font-weight:var(--mh-fw-tiny);line-height:var(--mh-lh-tiny);}",
				/* 骨架 / 空态 */
				"[data-mh-skeleton]{display:flex;flex-direction:column;gap:8px;}",
				"[data-mh-skeleton-row]{height:26px;border-radius:6px;background:var(--mh-skeleton);",
				"  animation:mh-breathe 1.4s ease-in-out infinite;}",
				"[data-mh-skeleton-block]{height:60px;border-radius:10px;background:var(--mh-skeleton);",
				"  animation:mh-breathe 1.4s ease-in-out infinite;}",
				"@keyframes mh-breathe{0%,100%{opacity:1}50%{opacity:.6}}",
				"[data-mh-unavailable]{display:flex;flex-direction:column;align-items:center;gap:8px;",
				"  padding:24px 0;text-align:center;}",
				"[data-mh-unavailable-title]{color:var(--mh-text);",
				"  font-size:var(--mh-fs-title);font-weight:var(--mh-fw-title);line-height:var(--mh-lh-title);}",
				"[data-mh-unavailable-desc]{color:var(--mh-mute);",
				"  font-size:var(--mh-fs-small);font-weight:var(--mh-fw-small);line-height:var(--mh-lh-small);}",
				/* 旋转环 + live region */
				"[data-mh-spinner]{display:inline-block;width:12px;height:12px;border-radius:50%;",
				"  border:2px solid var(--mh-line);border-top-color:var(--mh-accent);",
				"  animation:mh-spin .8s linear infinite;}",
				"@keyframes mh-spin{to{transform:rotate(360deg)}}",
				"[data-mh-live]{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;",
				"  clip:rect(0 0 0 0);white-space:nowrap;border:0;}",
				/* 结果卡入场（仅 opacity/transform，ui-spec §5.1） */
				"[data-mh-result]{animation:mh-fade .12s ease-out;}",
				"@keyframes mh-fade{from{opacity:0;transform:translateY(2px)}to{opacity:1;transform:none}}",
				/* 窄容器回退（ui-spec §1.4） */
				"@media (max-width:719px){",
				"  [data-mh-chain]{flex-direction:column;gap:6px;}",
				"  [data-mh-layer]{height:auto;min-height:58px;}",
				"  [data-mh-row-label]{flex-basis:56px;}",
				"  [data-mh-metrics]{gap:8px;}",
				"  [data-mh-metric]{flex:1 1 44%;}",
				"}",
				"@media (max-width:479px){",
				"  [data-mh-msg-row]{grid-template-columns:1fr;}",
				"  [data-mh-send]{margin-left:0;width:100%;justify-content:center;}",
				"  [data-mh-record]{grid-template-columns:12px 54px minmax(0,1fr) 56px;}",
				"  [data-mh-record-route],[data-mh-record-http]{display:none;}",
				"}",
				/* 减弱动效：全部关闭（V-M1） */
				"@media (prefers-reduced-motion:reduce){",
				"  [data-mh-root] *{animation:none !important;transition-duration:0s !important;}",
				"  [data-mh-spinner]{border-top-color:var(--mh-line);}",
				"}",
				/* color-mix 不可用时的兜底：只损失色彩，不损失可读性（ui-spec §2.1） */
				"@supports not (color: color-mix(in srgb, red 50%, blue)){",
				"  [data-mh-root]{--mh-ok:var(--mh-text);--mh-warn:var(--mh-text);--mh-err:var(--mh-text);",
				"    --mh-biz:var(--mh-text);--mh-ok-bg:transparent;--mh-warn-bg:transparent;",
				"    --mh-err-bg:transparent;--mh-biz-bg:transparent;}",
				"}"
			].join("\n");
		}

		function ensureStyle() {
			if (typeof document === "undefined") return;
			if (document.getElementById(STYLE_ID) !== null) return;
			const el = document.createElement("style");
			el.id = STYLE_ID;
			el.textContent = css();
			(document.head || document.documentElement).appendChild(el);
		}

		// ---------- 小组件 ----------

		/** 装饰字形（ui-spec §6.1 禁止不加 aria-hidden 的装饰字形）。 */
		function Glyph(props) {
			return h(
				"span",
				{
					"data-mh-glyph": "1",
					"aria-hidden": "true",
					className: props.className,
					"data-mh-layer-glyph": props.layerGlyph
				},
				props.children
			);
		}

		function Dot(props) {
			return h("span", { "data-mh-dot": props.kind, title: props.title, "aria-hidden": "true" });
		}

		/**
		 * 选择器一行（radiogroup + roving tabindex，ui-spec §3.3 / §6.1 / §6.3）。
		 * `row` ∈ provider | api | model | route；行 4 不渲染时整行 DOM 不存在。
		 */
		function Row(props) {
			const labelId = "mh-row-label-" + props.row;
			const chips = props.chips;
			const selectedIndex = chips.findIndex((c) => c.selected === true);
			const tabbable = selectedIndex >= 0 ? selectedIndex : 0;

			function onKeyDown(e) {
				if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
					if (chips.length === 0) return;
					e.preventDefault();
					const dir = e.key === "ArrowRight" ? 1 : -1;
					const base = selectedIndex >= 0 ? selectedIndex : 0;
					const next = (base + dir + chips.length) % chips.length;
					if (chips[next].disabled !== true) props.onSelect(chips[next].key);
				}
			}

			return h(
				"div",
				{
					"data-mh-row": props.row,
					role: "radiogroup",
					"aria-labelledby": labelId,
					"aria-orientation": "horizontal",
					onKeyDown: onKeyDown
				},
				h("div", { "data-mh-row-label": "1", id: labelId }, props.label),
				h(
					"div",
					{ "data-mh-chips": "1" },
					chips.map((c, i) =>
						h(
							"button",
							{
								key: c.key,
								type: "button",
								"data-mh-chip": "1",
								role: "radio",
								"aria-checked": c.selected === true ? "true" : "false",
								"aria-disabled": c.disabled === true ? "true" : undefined,
								tabIndex: i === tabbable ? 0 : -1,
								title: c.title,
								onClick: () => {
									if (c.disabled === true) return;
									props.onSelect(c.key);
								}
							},
							c.selected === true
								? h(Glyph, { className: "mh-chip-check", "data-mh-chip-glyph": "1" }, "\u2713")
								: null,
							h("span", { "data-mh-chip-label": "1" }, c.label),
							c.badge === undefined || c.badge === null
								? null
								: h("span", { "data-mh-chip-badge": "1" }, c.badge),
							c.dot === undefined || c.dot === null ? null : h(Dot, { kind: c.dot.kind, title: c.dot.title })
						)
					),
					props.note === undefined || props.note === null
						? null
						: h("div", { "data-mh-row-note": "1" }, props.note)
				)
			);
		}

		/** 图标/文字按钮（复制、展开、清空）。 */
		function TextBtn(props) {
			return h(
				"button",
				{
					type: "button",
					"data-mh-textbtn": props.icon === true ? undefined : "1",
					"data-mh-iconbtn": props.icon === true ? "1" : undefined,
					"aria-label": props.ariaLabel,
					title: props.title,
					disabled: props.disabled === true,
					onClick: props.onClick,
					/* 放大按钮 / 美化开关 / 弹窗关闭：各自带独立钩子供渲染级断言 */
					"data-mh-zoom": props.zoom === true ? "1" : undefined,
					"aria-pressed": props.pressed === undefined ? undefined : props.pressed === true ? "true" : "false",
					"data-mh-pretty": props.pretty === true ? "1" : undefined,
					"data-mh-modal-close": props.modalClose === true ? "1" : undefined
				},
				props.children
			);
		}

		/**
		 * 放大弹窗（用户要求：原始响应 / 请求详情可弹出显示 + JSON 格式化）。
		 *
		 * 无障碍按 ui-spec §4.4 / §6.3：`role="dialog"` + `aria-modal` + `aria-labelledby`；
		 * 打开时焦点进入、`Tab` 在弹窗内循环、`Escape` 关闭、关闭后焦点回到触发按钮、
		 * 打开期间锁背景滚动。Esc 用**捕获阶段 + stopPropagation**，
		 * 否则会同时触发面板既有的「Escape 返回当前结果」处理器（两个动作一起发生）。
		 */
		function Modal(props) {
			const cardRef = useRef(null);
			const titleId = "mh-modal-title";
			const onClose = props.onClose;

			useEffect(() => {
				const prevFocus = typeof document === "undefined" ? null : document.activeElement;
				const prevOverflow = document.body.style.overflow;
				document.body.style.overflow = "hidden";
				document.documentElement.setAttribute("data-mh-modal-open", "1");

				const card = cardRef.current;
				const focusables = () =>
					card
						? Array.prototype.slice.call(
								card.querySelectorAll(
									'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
								)
							)
						: [];
				const first = focusables()[0];
				if (first && typeof first.focus === "function") {
					try {
						first.focus();
					} catch (e) {
						/* 忽略 */
					}
				}

				function onKey(e) {
					if (e.key === "Escape") {
						e.stopPropagation();
						e.preventDefault();
						onClose();
						return;
					}
					if (e.key !== "Tab") return;
					const list = focusables();
					if (list.length === 0) return;
					const firstEl = list[0];
					const lastEl = list[list.length - 1];
					if (e.shiftKey && document.activeElement === firstEl) {
						e.preventDefault();
						lastEl.focus();
					} else if (!e.shiftKey && document.activeElement === lastEl) {
						e.preventDefault();
						firstEl.focus();
					}
				}
				document.addEventListener("keydown", onKey, true);
				return () => {
					document.removeEventListener("keydown", onKey, true);
					document.body.style.overflow = prevOverflow;
					document.documentElement.removeAttribute("data-mh-modal-open");
					try {
						if (prevFocus && typeof prevFocus.focus === "function") prevFocus.focus();
					} catch (e) {
						/* 忽略 */
					}
				};
			}, [onClose]);

			const node = h(
				"div",
				{
					"data-mh-modal-overlay": "1",
					onClick: (e) => {
						/* 点遮罩关闭；点卡片内部不关（卡片自身 stopPropagation） */
						if (e.target === e.currentTarget) onClose();
					}
				},
				h(
					"div",
					{
						ref: cardRef,
						"data-mh-modal": "1",
						role: "dialog",
						"aria-modal": "true",
						"aria-labelledby": titleId,
						onClick: (e) => e.stopPropagation()
					},
					props.children
				)
			);

			if (createPortal !== null && typeof document !== "undefined" && document.body) {
				return createPortal(node, document.body);
			}
			return node;
		}

		// ---------- 面板 ----------

		function ModelHealthPanel() {
			// 配置与选择
			const [config, setConfig] = useState(null);
			const [sel, setSel] = useState(null);
			const [phase, setPhase] = useState("loading"); // loading | ready | error | unavailable
			const [loadErr, setLoadErr] = useState(null);
			const [notice, setNotice] = useState(null);

			// 测试输入（ui-spec §3.5：单个 textarea `mh-msg`；系统提示词只读展示）
			const [stream, setStream] = useState(false);
			const [userPrompt, setUserPrompt] = useState("");
			const touchedRef = useRef({ userPrompt: false });

			// 重试会话（§18）：表单初值来自宿主 retryDefaults，会话状态来自 /retry/status
			const [retryForm, setRetryForm] = useState(() => initialRetry(null));
			const [retrySession, setRetrySession] = useState(null);
			const [retryError, setRetryError] = useState(null);
			const retryActive = retrySession !== null && retrySession.active === true;

			// 默认模型（§19）：宿主当前默认 + 本面板是否已就它预选过
			const [defaultModel, setDefaultModel] = useState(null);
			const [defBusy, setDefBusy] = useState(false);
			const [defNotice, setDefNotice] = useState(null);

			// 测试状态
			const [testing, setTesting] = useState(false);
			const [elapsed, setElapsed] = useState(0);
			const [testError, setTestError] = useState(null);
			const [results, setResults] = useState({}); // statusKey → TestResult
			const [records, setRecords] = useState([]);
			const [history, setHistory] = useState(null); // 历史查看中的 TestResult
			const [view, setView] = useState("model"); // model | raw | req
			/** 放大弹窗：null=关闭；否则为 `{view}`（弹窗与内联同 tab 联动，但可各自切换） */
			const [modal, setModal] = useState(null);
			/** 「美化 / 原文」开关：内联与弹窗**共用**（用户切一次就该处处生效，不该切两次） */
			const [pretty, setPretty] = useState(true);
			const [expanded, setExpanded] = useState(false);
			const [confirmClear, setConfirmClear] = useState(false);
			const [live, setLive] = useState("");
			const [copied, setCopied] = useState(null);

			const startedRef = useRef(0);
			const testingRef = useRef(false);
			testingRef.current = testing;
			const confirmTimerRef = useRef(null);
			/** 用户是否已改过重试控件（改过则配置刷新不覆盖其输入）。 */
			const retryFormTouchedRef = useRef(false);

			const announce = useCallback((msg) => setLive(msg), []);

			/** 挂载时取一次 config + records（**不轮询**）。 */
			const loadConfig = useCallback(() => {
				setPhase("loading");
				return fetch(CONFIG_URL, { headers: { accept: "application/json" } })
					.then((r) => r.json())
					.then((data) => {
						if (data === null || typeof data !== "object" || data.ok !== true) {
							setLoadErr("配置端点返回异常，请重试");
							setPhase("error");
							return;
						}
						if (data.source && data.source.available === false) {
							setConfig(data);
							setPhase("unavailable");
							return;
						}
						const templates = data.templates || {};
						/* ui-spec §3.5：占位符 = templates.userPrompt 默认值，且提示文案为
						   「留空则使用默认模板」→ 故**不预填** value，让占位符可见。 */
						if (touchedRef.current.userPrompt !== true) {
							setUserPrompt("");
						}
						const defaults = data.defaults || {};
						if (typeof defaults.stream === "boolean") setStream(defaults.stream);
						// 重试控件初值（§18.4 默认列；宿主下发优先）
						setRetryForm((prev) => {
							const base = initialRetry(data);
							// 用户已经改过控件时不覆盖（配置刷新不该丢掉正在编辑的参数）
							return retryFormTouchedRef.current === true ? prev : base;
						});
						setDefaultModel(data.defaultModel || null);
						setConfig(data);
						setLoadErr(null);
						setPhase("ready");
						setSel((prev) => {
							// 首次加载（prev 为 null）：优先落到**用户默认模型**（§19.2）；
							// 之后每次配置刷新仍按 §7.3 用稳定 id 保持选择。
							if (prev === null || prev === undefined) {
								const init = initialSelection(data);
								setNotice(init.notice);
								return init.selection;
							}
							const out = reconcileSelection(prev, data);
							setNotice(out.notice);
							return out.selection;
						});
					})
					.catch((e) => {
						setLoadErr(String((e && e.message) || e));
						setPhase("error");
					});
			}, []);

			const loadRecords = useCallback(() => {
				return fetch(RECORDS_URL, { headers: { accept: "application/json" } })
					.then((r) => r.json())
					.then((data) => {
						if (data !== null && typeof data === "object" && Array.isArray(data.records)) {
							setRecords(data.records);
						}
					})
					.catch(() => {});
			}, []);

			useEffect(() => {
				loadConfig();
				loadRecords();
			}, [loadConfig, loadRecords]);

			/** testing 期间的本地已耗时（客户端不判定超时，SPEC §8.2 / R27）。 */
			useEffect(() => {
				if (!testing) return undefined;
				const id = setInterval(() => setElapsed(Date.now() - startedRef.current), 100);
				return () => clearInterval(id);
			}, [testing]);

			/** Escape 关闭历史视图（ui-spec §4.4）。 */
			useEffect(() => {
				function onKey(e) {
					if (e.key === "Escape" && history !== null) setHistory(null);
				}
				if (typeof document === "undefined") return undefined;
				document.addEventListener("keydown", onKey);
				return () => document.removeEventListener("keydown", onKey);
			}, [history]);

			useEffect(
				() => () => {
					if (confirmTimerRef.current !== null) clearTimeout(confirmTimerRef.current);
				},
				[]
			);

			const target = useMemo(() => resolveTarget(config, sel), [config, sel]);
			const group = target === null ? null : target.group;
			const model = target === null ? null : target.model;
			const route = target === null ? null : target.route;
			const cands = target === null ? [] : target.candidates;

			const currentKey =
				route === null || model === null ? null : statusKey(route.routeKey, model.id, stream);
			const liveResult = history !== null ? history : currentKey === null ? null : results[currentKey] || null;

			/**
			 * 切换目标时收掉弹窗：弹窗里挂着上一个目标的响应会让人误读成「这就是当前目标的响应」。
			 * 必须放在 `currentKey` 定义**之后**（依赖数组求值早于 effect 体，但变量在 effect
			 * 闭包里被引用时仍受 TDZ 约束，提前声明会直接抛 ReferenceError）。
			 */
			useEffect(() => {
				setModal(null);
			}, [currentKey]);

			const messagesOk = userPrompt.length <= 2000;
			const canSend = target !== null && route !== null && !testing && messagesOk;

			function resetResult() {
				setHistory(null);
				setTestError(null);
				setView("model");
			}

			function onProvider(id) {
				setSel(selectProvider(config, id));
				setNotice(null);
				resetResult();
			}

			function onGroup(id) {
				setSel(selectGroup(config, sel === null ? null : sel.providerId, id));
				setNotice(null);
				resetResult();
			}

			function onModel(key) {
				setSel(selectModel(config, sel, key));
				setNotice(null);
				resetResult();
			}

			function onRoute(routeKey) {
				setSel({
					providerId: sel.providerId,
					groupId: sel.groupId,
					modelKey: sel.modelKey,
					routeKey: routeKey
				});
				resetResult();
			}

			/** 发送（三层防重复，ui-spec §4.3）。 */
			function send() {
				if (testingRef.current) return;
				if (target === null || route === null || !messagesOk) return;

				setTesting(true);
				setTestError(null);
				setHistory(null);
				startedRef.current = Date.now();
				setElapsed(0);

				const body = {
					routeKey: route.routeKey,
					modelId: model.id,
					stream: stream,
					/* 面板不覆盖系统提示词（ui-spec §3.5 只规定一个可编辑字段）；
					   传 null 让宿主使用 templates.systemPrompt 默认值。 */
					systemPrompt: null,
					userPrompt: userPrompt === "" ? null : userPrompt
				};
				const key = statusKey(route.routeKey, model.id, stream);

				fetch(TEST_URL, {
					method: "POST",
					headers: { "content-type": "application/json", accept: "application/json" },
					body: JSON.stringify(body)
				})
					.then((r) => r.json().then((data) => ({ httpStatus: r.status, data })))
					.then((out) => {
						const data = out.data;
						if (data !== null && typeof data === "object" && data.ok === false && data.error) {
							// 请求本身不合法（SPEC §10.2 第 2 处落点）：就地错误，不覆盖结果
							const e = data.error;
							setTestError((e.title || "请求未被接受") + (e.hint ? "：" + e.hint : ""));
							announce(e.title || "请求未被接受");
						} else if (data !== null && typeof data === "object" && typeof data.status === "string") {
							setResults((prev) => {
								const next = Object.assign({}, prev);
								next[key] = data;
								return next;
							});
							announce((ST[data.status] || ST.untested).label);
						} else {
							setTestError("宿主返回了无法识别的结果（HTTP " + out.httpStatus + "）");
						}
						setTesting(false);
						loadRecords();
					})
					.catch((e) => {
						setTestError("测试请求失败：" + String((e && e.message) || e));
						setTesting(false);
						loadRecords();
					});
			}

			function clearRecords() {
				fetch(RECORDS_URL, {
					method: "POST",
					headers: { "content-type": "application/json", accept: "application/json" },
					body: JSON.stringify({ action: "clear" })
				})
					.then((r) => r.json())
					.then((data) => {
						const n = data !== null && typeof data === "object" ? data.cleared : 0;
						setRecords([]);
						setHistory(null);
						setResults({});
						setConfirmClear(false);
						announce("已清空 " + (n === undefined ? 0 : n) + " 条记录");
					})
					.catch(() => setConfirmClear(false));
			}

			function onClearClick() {
				if (confirmClear) {
					clearRecords();
					return;
				}
				setConfirmClear(true);
				if (confirmTimerRef.current !== null) clearTimeout(confirmTimerRef.current);
				confirmTimerRef.current = setTimeout(() => setConfirmClear(false), 3000);
			}

			function copy(text, label) {
				const done = () => {
					setCopied(label);
					announce("已复制到剪贴板");
					setTimeout(() => setCopied(null), 1500);
				};
				try {
					if (typeof navigator !== "undefined" && navigator.clipboard && navigator.clipboard.writeText) {
						navigator.clipboard.writeText(String(text)).then(done, () => announce("复制失败，请手动选择"));
						return;
					}
				} catch (e) {
					/* 落入下方提示 */
				}
				announce("复制失败，请手动选择");
			}

			/** Ctrl/Cmd + Enter 发送（ui-spec §3.5 / §4.4）。 */
			function onMsgKeyDown(e) {
				if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
					e.preventDefault();
					send();
				}
			}

			// ---------- 重试会话操作（§18） ----------

			/** 拉一次会话状态（启动后与刷新记录时用；**不轮询**）。 */
			const loadRetryStatus = useCallback(() => {
				return fetch(RETRY_STATUS_URL, { headers: { accept: "application/json" } })
					.then((r) => r.json())
					.then((data) => {
						if (data !== null && typeof data === "object" && data.session) setRetrySession(data.session);
					})
					.catch(() => {});
			}, []);

			useEffect(() => {
				loadRetryStatus();
			}, [loadRetryStatus]);

			function updateRetryForm(patch) {
				retryFormTouchedRef.current = true;
				setRetryForm((prev) => Object.assign({}, prev, patch));
			}

			const retryFormCheck = validateRetryForm(retryForm);
			const retryUnlimitedNow = retryUnlimited(retryForm);
			const canStartRetry =
				target !== null && route !== null && !retryActive && !testing && retryFormCheck.ok && messagesOk;

			/** 启动重试会话（§18.1 三条启用条件）。 */
			function startRetry() {
				if (!canStartRetry) return;
				setRetryError(null);
				const body = {
					routeKey: route.routeKey,
					modelId: model.id,
					stream: stream,
					systemPrompt: null,
					userPrompt: userPrompt === "" ? null : userPrompt,
					mode: retryForm.mode,
					intervalMinutes: Number(retryForm.interval),
					maxAttempts: Number(retryForm.maxAttempts),
					maxDurationMinutes: Number(retryForm.maxDuration)
				};
				fetch(RETRY_START_URL, {
					method: "POST",
					headers: { "content-type": "application/json", accept: "application/json" },
					body: JSON.stringify(body)
				})
					.then((r) => r.json().then((data) => ({ httpStatus: r.status, data })))
					.then((out) => {
						const data = out.data;
						if (data !== null && typeof data === "object" && data.ok === true && data.session) {
							setRetrySession(data.session);
							announce("已启动重试会话");
							return;
						}
						const e = data !== null && typeof data === "object" ? data.error : null;
						setRetryError((e && (e.message || e.code)) || "启动重试失败（HTTP " + out.httpStatus + "）");
					})
					.catch((e) => setRetryError("启动重试失败：" + String((e && e.message) || e)));
			}

			/** 手动停止（§18.5 条件 4；宿主会中断在飞请求）。 */
			function stopRetry() {
				setRetryError(null);
				fetch(RETRY_STOP_URL, {
					method: "POST",
					headers: { "content-type": "application/json", accept: "application/json" },
					body: JSON.stringify({})
				})
					.then((r) => r.json().then((data) => ({ httpStatus: r.status, data })))
					.then((out) => {
						const data = out.data;
						if (data !== null && typeof data === "object" && data.ok === true && data.session) {
							setRetrySession(data.session);
							announce("已停止重试会话");
							loadRecords();
							return;
						}
						const e = data !== null && typeof data === "object" ? data.error : null;
						setRetryError((e && (e.message || e.code)) || "停止失败（HTTP " + out.httpStatus + "）");
					})
					.catch((e) => setRetryError("停止失败：" + String((e && e.message) || e)));
			}

			// ---------- 默认模型操作（§19） ----------

			/** 把当前选中的路由+模型设为宿主默认模型。 */
			function setAsDefault() {
				if (target === null || route === null || defBusy) return;
				setDefBusy(true);
				setDefNotice(null);
				fetch(DEFAULT_URL, {
					method: "POST",
					headers: { "content-type": "application/json", accept: "application/json" },
					body: JSON.stringify({ routeKey: route.routeKey, modelId: model.id })
				})
					.then((r) => r.json().then((data) => ({ httpStatus: r.status, data })))
					.then((out) => {
						const data = out.data;
						if (data !== null && typeof data === "object" && data.ok === true && data.defaultModel) {
							setDefaultModel(data.defaultModel);
							setDefNotice("已设为默认模型，下次打开面板将默认选中它");
							announce("已设为默认模型");
							return;
						}
						const e = data !== null && typeof data === "object" ? data.error : null;
						setDefNotice("设置失败：" + ((e && (e.message || e.code)) || "HTTP " + out.httpStatus));
					})
					.catch((e) => setDefNotice("设置失败：" + String((e && e.message) || e)))
					.finally(() => setDefBusy(false));
			}

			// ---------- 加载 / 错误 / 不可用 ----------

			if (phase === "loading") {
				return h(
					"div",
					{ "data-mh-root": "1", role: "region", "aria-label": "模型健康检查", "aria-busy": "true" },
					h(
						"div",
						{ "data-mh-skeleton": "1", "aria-hidden": "true" },
						h("div", { "data-mh-skeleton-row": "1" }),
						h("div", { "data-mh-skeleton-row": "1" }),
						h("div", { "data-mh-skeleton-row": "1" }),
						h("div", { "data-mh-skeleton-block": "1" })
					)
				);
			}

			if (phase === "error") {
				return h(
					"div",
					{ "data-mh-root": "1", role: "region", "aria-label": "模型健康检查" },
					h(
						"div",
						{ "data-mh-unavailable": "1", role: "status" },
						h("div", { "data-mh-unavailable-title": "1" }, "配置读取失败"),
						h("div", { "data-mh-unavailable-desc": "1" }, String(loadErr || "无法读取配置")),
						h(
							"button",
							{ type: "button", "data-mh-send": "1", onClick: loadConfig },
							"重试"
						)
					)
				);
			}

			if (phase === "unavailable" || config === null || sel === null || target === null) {
				return h(
					"div",
					{ "data-mh-root": "1", role: "region", "aria-label": "模型健康检查" },
					h(
						"div",
						{ "data-mh-unavailable": "1", role: "status" },
						h("div", { "data-mh-unavailable-title": "1" }, "未读取到 llm-pi-ai 配置"),
						h(
							"div",
							{ "data-mh-unavailable-desc": "1" },
							"确认 llm-pi-ai 插件已加载、命名空间已注册，或当前配置下没有解析出任何可测目标。"
						),
						h("button", { type: "button", "data-mh-send": "1", onClick: loadConfig }, "重新加载")
					)
				);
			}

			// ---------- 派生数据 ----------

			const provider = target.provider;
			const providers = config.providers || [];
			const groupIds = provider.groupIds || [];
			const groupModels = group.models || [];
			const preview = previewFor(group, stream);
			const credential = route === null ? null : route.credential;
			const credState = credentialState(credential);
			const warnings = [].concat(group.warnings || [], config.warnings || []);
			const thresholds = config.thresholds || {};
			const templates = config.templates || {};
			const showRow4 = row4Visible(group);
			const alreadyDefault = route === null || model === null ? false : isCurrentDefault(defaultModel, route.routeKey, model.id);
			const retryText = retrySummary(retrySession);
			const status = testing ? "testing" : liveResult === null ? "untested" : liveResult.status;
			const meta = ST[status] || ST.untested;
			const reasons = liveResult === null ? [] : liveResult.reasons || [];
			const usage = (liveResult === null ? null : liveResult.usage) || {};
			const overThreshold =
				liveResult !== null &&
				Number.isFinite(Number(liveResult.latencyMs)) &&
				Number.isFinite(Number(thresholds.slowMs)) &&
				Number(liveResult.latencyMs) > Number(thresholds.slowMs);
			const targetSummary =
				(route === null ? DASH : route.displayName || route.routeKey) +
				" · " +
				model.id +
				" · " +
				(group.api || DASH) +
				(stream ? " · 流式" : "");

			const tabs = TABS;

			/* 响应内容的视图模型：内联块与放大弹窗**消费同一份**（防两处漂移）。
			   内联块恒用 pretty=false —— 保持既有 48px 预算内的原文渲染不变（改动只加在弹窗里）；
			   弹窗默认 pretty=true（用户要的就是「弹出后可 JSON 格式化」）。 */
			const vm = viewModel(liveResult, view, templates.systemPrompt, false);
			const modalVm =
				modal === null ? null : viewModel(liveResult, modal.view, templates.systemPrompt, pretty);

			// ---------- 渲染 ----------

			return h(
				"div",
				{ "data-mh-root": "1", role: "region", "aria-label": "模型健康检查" },

				// ===== ① 目标选择条 =====
				h(
					"div",
					{ "data-mh-rail": "1", role: "group", "aria-label": "测试目标选择" },
					h(Row, {
						row: "provider",
						label: "供应商",
						onSelect: onProvider,
						chips: providers.map((p) => ({
							key: p.id,
							label: p.displayLabel || p.baseURLNormalized || p.id,
							title: p.baseURL || p.baseURLNormalized || "",
							badge: p.routeCount,
							selected: p.id === sel.providerId
						}))
					}),
					h(Row, {
						row: "api",
						label: "API 类型",
						onSelect: onGroup,
						note: groupIds.length > 1 ? "该供应商声明了 " + groupIds.length + " 种 API 类型，请分别测试" : null,
						chips: groupIds.map((gid) => {
							const g = groupById(config, gid);
							if (g === null) return null;
							return {
								key: g.id,
								label: g.api || "(未声明 api)",
								title: API_HINT[g.api] || "该协议不在三协议支持范围内，测试将失败",
								badge: g.routeCount,
								selected: g.id === sel.groupId,
								disabled: false
							};
						}).filter(Boolean)
					}),
					h(Row, {
						row: "model",
						label: "模型",
						onSelect: onModel,
						note: groupModels.length === 0 ? "该分组未声明模型" : null,
						chips: groupModels.map((m) => ({
							key: m.modelKey,
							label: m.name || m.id,
							title: m.id,
							badge: (m.routeKeys || []).length,
							selected: m.modelKey === sel.modelKey
						}))
					}),
					// 行 4 仅在 groups[g].routeCount > 1 时渲染；候选按所选模型收窄（候选=1 仍渲染）
					showRow4
						? h(Row, {
								row: "route",
								label: "路由",
								onSelect: onRoute,
								note: singleRouteModel(group, model)
									? "该模型仅在此一条路由上提供（分组有多条路由，故本行仍显示）"
									: null,
								chips: cands.map((r) => {
									const st = credentialState(r.credential);
									return {
										key: r.routeKey,
										label: r.displayName || r.routeKey,
										title:
											(r.credential && r.credential.ref ? r.credential.ref + "：" : "") + st.title,
										badge: null,
										dot: st,
										selected: r.routeKey === sel.routeKey
									};
								})
							})
						: null
				),

				// ===== ② 将请求 =====
				h(
					"div",
					{ "data-mh-preview": "1", role: "group", "aria-label": "将请求" },
					h(
						"div",
						{ "data-mh-preview-line": "1" },
						h("span", { "data-mh-preview-method": "1", "data-mh-code": "1" }, preview.method),
						h("span", { "data-mh-preview-url": "1", "data-mh-code": "1", title: preview.url || "" }, preview.url || DASH),
						h(
							TextBtn,
							{
								icon: true,
								ariaLabel: "复制请求 URL",
								title: copied === "url" ? "已复制" : "复制请求 URL",
								onClick: () => copy(preview.url || "", "url")
							},
							h(Glyph, null, copied === "url" ? "\u2713" : "\u29c9")
						)
					),
					h(
						"div",
						{ "data-mh-preview-meta": "1" },
						"路由 " + (route === null ? DASH : route.displayName || route.routeKey) +
							" · 协议 " + (group.api || DASH) +
							" · 密钥 " + (credential && credential.ref ? credential.ref : "无引用") +
							" " + credState.title
					),
					h(
						"div",
						{ "data-mh-preview-note": "1" },
						h(Glyph, null, "\u24d8"),
						"本探针只发送协议最小头集，不应用路由的 headers / compat / 重试策略"
					),
					warnings.map((w, i) =>
						h(
							"div",
							{ "data-mh-preview-warn": "1", key: "w-" + i, role: "alert" },
							h("span", {
								"data-mh-warnbar": w && (w.code === "MISSING_BASE_URL" || w.code === "UNSUPPORTED_API") ? "err" : "warn"
							}),
							h("span", null, ((w && w.code) || "警告") + "：" + ((w && w.message) || ""))
						)
					),
					notice !== null ? h("div", { "data-mh-preview-note": "1", role: "status" }, notice) : null
				),

				// ===== ③ 测试区 =====
				h(
					"div",
					{ "data-mh-test": "1", role: "group", "aria-labelledby": "mh-test-title" },
					h("span", { id: "mh-test-title", "data-mh-test-title": "1", "data-mh-sr": "1" }, "测试"),
					h(
						"div",
						{ "data-mh-msg-row": "1" },
						h("label", { "data-mh-field-label": "1", htmlFor: "mh-msg" }, "测试消息"),
						h("textarea", {
							id: "mh-msg",
							"data-mh-msg": "1",
							value: userPrompt,
							maxLength: 2000,
							rows: 1,
							placeholder: templates.userPrompt || "",
							"aria-describedby": "mh-msg-hint",
							onKeyDown: onMsgKeyDown,
							onChange: (e) => {
								touchedRef.current.userPrompt = true;
								setUserPrompt(e.target.value);
							}
						}),
						h(
							"span",
							{
								"data-mh-count": "1",
								"aria-hidden": "true",
								"data-over": userPrompt.length >= 2000 ? "1" : "0"
							},
							userPrompt.length + " / 2000"
						),
						/* 提示文案保留在可访问性树中（aria-describedby 目标），视觉隐藏以守住 100px 预算 */
						h(
							"span",
							{ "data-mh-field-hint": "1", id: "mh-msg-hint", "data-mh-sr": "1" },
							"留空则使用默认模板「" + (templates.userPrompt || DASH) + "」；长度上限 2000 字符；Ctrl/Cmd + Enter 发送"
						)
					),
					h(
						"div",
						{ "data-mh-param": "1" },
						h(
							"span",
							{ "data-mh-switchwrap": "1" },
							h("label", { "data-mh-label-inline": "1", htmlFor: "mh-stream" }, "流式"),
							h(
								"button",
								{
									type: "button",
									id: "mh-stream",
									"data-mh-switch": "1",
									role: "switch",
									"aria-checked": stream ? "true" : "false",
									"aria-label": "流式请求",
									onClick: () => setStream(!stream)
								},
								h("span", { "data-mh-switch-knob": "1" })
							)
						),
						// 只读展示（captain 裁定：不得出现可编辑的 Temperature / Max Tokens / Timeout，也不得出现严格校验勾选框）
						// 系统提示词：与 Max Tokens / Timeout 同款只读形态，单行截断（title 给全文），
						// 与其余只读项同行 → 参数行仍为 1 行 28px，不破坏 §1.3 预算。
						// 宽度上限由 260 收窄到 150：全文仍在 title 与「请求详情」页签里可达（功能未删减），
						// 但为下方新增的重试控件腾出横向空间，避免参数行换行破坏 AC15 高度预算。
						h(
							"span",
							{
								"data-mh-ro": "1",
								"data-mh-ro-sys": "1",
								// title 里给出**完整**系统提示词：单行截断后，悬停即可读到全文，
								// 不必切页签。这样收窄宽度上限不损失任何信息可达性。
								title:
									"由插件配置固定，本机不可在面板修改。完整内容：\n" +
									String(templates.systemPrompt === undefined ? DASH : templates.systemPrompt)
							},
							h("span", { "data-mh-ro-k": "1" }, "系统提示"),
							h(
								"span",
								{ "data-mh-ro-v": "1", "aria-disabled": "true" },
								String(
									templates.systemPrompt === undefined || templates.systemPrompt === ""
										? DASH
										: templates.systemPrompt
								)
							)
						),
						h(
							"span",
							{ "data-mh-ro": "1", title: "由插件配置固定，本机不可在面板修改" },
							h("span", { "data-mh-ro-k": "1" }, "Max Tokens"),
							h("span", { "data-mh-ro-v": "1", "aria-disabled": "true" }, fmtNum(templates.maxOutputTokens))
						),
						h(
							"span",
							{ "data-mh-ro": "1", title: "由插件配置固定，本机不可在面板修改" },
							h("span", { "data-mh-ro-k": "1" }, "超时"),
							h("span", { "data-mh-ro-v": "1", "aria-disabled": "true" }, fmtNum(thresholds.hardTimeoutMs) + "ms")
						),
						h(
							"span",
							{ "data-mh-ro": "1", title: "严格校验恒开；响应 trim 后须精确等于该值，否则降级 Slow" },
							h("span", { "data-mh-ro-k": "1" }, "严格校验"),
							h("span", { "data-mh-ro-v": "1", "aria-disabled": "true" }, String(templates.expectText === undefined ? DASH : templates.expectText))
						),

						/* ===== 设为默认模型（§19.5）===== */
						h(
							"button",
							{
								type: "button",
								"data-mh-defbtn": "1",
								"data-current": alreadyDefault ? "1" : "0",
								disabled: alreadyDefault || defBusy || target === null || route === null,
								title: alreadyDefault
									? "当前选中就是默认模型（" + (defaultModel.provider || "") + " / " + (defaultModel.model || "") + "）"
									: "把当前选中的路由 + 模型设为宿主默认模型；下次打开本面板将默认选中它",
								onClick: setAsDefault
							},
							h(Glyph, null, alreadyDefault ? "\u2713" : "\u2606"),
							alreadyDefault ? "已是默认" : defBusy ? "设置中…" : "设为默认"
						),

						/* ===== 自动重试（§18）===== */
						h(
							"span",
							{ "data-mh-retrywrap": "1" },
							h("span", { "data-mh-label-inline": "1" }, "重试"),
							// 两种模式互斥必选其一（§18.2）；默认严格，无「都不选」态
							h(
								"span",
								{ "data-mh-retryseg": "1", role: "radiogroup", "aria-label": "重试成功判定模式" },
								RETRY_MODES.map((m) =>
									h(
										"button",
										{
											key: m.id,
											type: "button",
											"data-mh-retrymode": m.id,
											role: "radio",
											"aria-checked": retryForm.mode === m.id ? "true" : "false",
											tabIndex: retryForm.mode === m.id ? 0 : -1,
											title: m.title,
											disabled: retryActive,
											onClick: () => updateRetryForm({ mode: m.id })
										},
										m.label
									)
								)
							),
							// 三个参数（§18.4）：间隔（分钟，一位小数）、最大次数（0=不限）、最长时长（分钟，0=不限）
							h(
								"span",
								{ "data-mh-retrynum": "1" },
								h("label", { htmlFor: "mh-retry-interval" }, "间隔"),
								h("input", {
									id: "mh-retry-interval",
									"data-mh-retryinput": "1",
									type: "number",
									min: "0.1",
									step: "0.1",
									inputMode: "decimal",
									value: retryForm.interval,
									disabled: retryActive,
									"aria-label": "重试间隔（分钟，最小 0.1，最多一位小数）",
									"aria-invalid": oneDecimal(Number(retryForm.interval)) && Number(retryForm.interval) >= 0.1 ? "false" : "true",
									title: "两次尝试之间的等待时长（分钟）；最小 0.1（6 秒），最多一位小数",
									onChange: (e) => updateRetryForm({ interval: e.target.value })
								})
							),
							h(
								"span",
								{ "data-mh-retrynum": "1" },
								h("label", { htmlFor: "mh-retry-max" }, "次数"),
								h("input", {
									id: "mh-retry-max",
									"data-mh-retryinput": "1",
									type: "number",
									min: "0",
									step: "1",
									value: retryForm.maxAttempts,
									disabled: retryActive,
									"aria-label": "重试最大次数（0 = 不限）",
									"aria-invalid":
										Number.isInteger(Number(retryForm.maxAttempts)) && Number(retryForm.maxAttempts) >= 0 ? "false" : "true",
									title: "达到该次数即停止（0 = 不限）",
									onChange: (e) => updateRetryForm({ maxAttempts: e.target.value })
								})
							),
							h(
								"span",
								{ "data-mh-retrynum": "1" },
								h("label", { htmlFor: "mh-retry-dur" }, "时长"),
								h("input", {
									id: "mh-retry-dur",
									"data-mh-retryinput": "1",
									type: "number",
									min: "0",
									step: "0.1",
									inputMode: "decimal",
									value: retryForm.maxDuration,
									disabled: retryActive,
									"aria-label": "重试最长时长（分钟，0 = 不限）",
									"aria-invalid":
										Number.isFinite(Number(retryForm.maxDuration)) &&
										Number(retryForm.maxDuration) >= 0 &&
										oneDecimal(Number(retryForm.maxDuration))
											? "false"
											: "true",
									title: "从启动起算的总时长上限（分钟，含等待与请求耗时；0 = 不限）",
									onChange: (e) => updateRetryForm({ maxDuration: e.target.value })
								})
							),
							// 启动 / 停止（§18.5 条件 4：停止必须能中断在飞请求，由宿主 abort 实现）
							retryActive
								? h(
										"button",
										{
											type: "button",
											"data-mh-retrygo": "1",
											"data-kind": "stop",
											title: "立即停止重试会话（会中断正在飞行的那次请求）",
											onClick: stopRetry
										},
										h(Glyph, null, "\u25a0"),
										"停止"
									)
								: h(
										"button",
										{
											type: "button",
											"data-mh-retrygo": "1",
											"data-kind": "start",
											disabled: !canStartRetry,
											title: retryActive
												? "已有重试会话进行中"
												: target === null || route === null
													? "请先完成目标选择"
													: !retryFormCheck.ok
														? retryFormCheck.reason
														: "按设定参数反复测试当前目标，直到成功或触发停止条件",
											onClick: startRetry
										},
										h(Glyph, null, "\u21bb"),
										"开始重试"
									),
							// 会话结论（§18.3 末条：总共几次 / 最后一次 / 停止原因）
							retryText === null
								? null
								: h(
										"span",
										{
											"data-mh-retrystatus": "1",
											role: "status",
											"aria-live": "polite",
											"data-tone":
												retrySession !== null && retrySession.active !== true && retrySession.stopReason === "success"
													? "ok"
													: retrySession !== null && retrySession.active !== true
														? "warn"
														: "idle",
											title: retryText
										},
										retryText
									)
						),

						h(
							"button",
							{
								type: "button",
								"data-mh-send": "1",
								disabled: !canSend,
								"aria-busy": testing ? "true" : "false",
								title:
									target === null || route === null
										? "请先完成目标选择"
										: testing
											? "测试进行中，请等待返回"
											: !messagesOk
												? "提示词超过 2000 字符"
												: "发送一次真实请求",
								onClick: send
							},
							testing ? h("span", { "data-mh-spinner": "1" }) : h(Glyph, null, "\u25b6"),
							testing ? "测试中…" : "发送测试"
						)
					),
					// 就地错误槽位常驻 20px（ui-spec §3.13）；预挂 live region 以满足 V-A1 的 alert 角色
					h(
						"div",
						{ "data-mh-test-slot": "1", role: "alert" },
						testError === null
							? null
							: h(
									"span",
									{ "data-mh-test-error": "1" },
									h(Glyph, null, "\u24d8"),
									testError
								),
						// §18.4：次数与时长同时为 0 时必须**可见文本**提示（不得只放 title）。
						// 放在这个**既有常驻 20px 槽位**里，而不是参数行里——参数行放不下时
						// 会 flex-wrap 换行、把 test 块撑高，破坏 AC15 一屏预算。
						retryUnlimitedNow
							? h(
									"span",
									{ "data-mh-retrywarn": "1" },
									h(Glyph, null, "\u26a0"),
									"次数与时长均不限，将一直重试直到成功或你手动停止"
								)
							: null,
						// 重试会话的启动/停止失败（§18.6 的 409 等）与默认模型设置结果（§19.5）
						retryError !== null
							? h("span", { "data-mh-retry-err": "1", "data-mh-test-error": "1" }, h(Glyph, null, "\u24d8"), retryError)
							: null,
						defNotice !== null
							? h("span", { "data-mh-defnotice": "1", role: "status" }, defNotice)
							: null
					)
				),

				// ===== ④ 结果区（唯一抬升面） =====
				h(
					"div",
					{
						"data-mh-result": "1",
						role: "region",
						"aria-label": "测试结果",
						"aria-busy": testing ? "true" : "false"
					},
					h(
						"div",
						{ "data-mh-result-head": "1" },
						h(
							"span",
							{ "data-mh-badge": "1", "data-tone": meta.tone, role: "status", "aria-live": "polite", "aria-atomic": "true" },
							h(
								"span",
								{ "data-mh-badge-dot": "1", "aria-hidden": "true" },
								status === "testing"
									? h("span", { "data-mh-spinner": "1" })
									: h(Glyph, null, meta.glyph)
							),
							meta.label
						),
						testing
							? h(
									"span",
									{ "data-mh-elapsed": "1", "aria-hidden": "true" },
									Math.max(elapsed, 0) + "ms"
								)
							: null,
						liveResult !== null && reasons.length > 0
							? reasons.map((r, i) =>
									h(
										"span",
										{ "data-mh-reason": "1", key: "r-" + i },
										(r === "slow-latency"
											? REASON_TEXT[r] + " " + fmtNum(thresholds.slowMs) + "ms"
											: REASON_TEXT[r] || String(r))
									)
								)
							: null,
						// 指标行与徽标同处一行（ui-spec §3.8 / §1.3 预算 ④：40px）
						liveResult === null
							? null
							: h(
									"div",
									{ "data-mh-metrics": "1" },
									h(
										"div",
										{ "data-mh-metric": "1" },
										h("div", { "data-mh-metric-label": "1" }, "耗时"),
										h(
											"div",
											{ "data-mh-metric-value": "1", title: overThreshold ? "超过 slow 阈值" : undefined },
											fmtMs(liveResult.latencyMs),
											overThreshold ? h(Glyph, null, " \u25b2") : null
										)
									),
									h(
										"div",
										{ "data-mh-metric": "1" },
										h("div", { "data-mh-metric-label": "1" }, "HTTP"),
										h(
											"div",
											{
												"data-mh-metric-value": "1",
												"data-tone":
													liveResult.httpStatus === null || liveResult.httpStatus === undefined
														? undefined
														: liveResult.httpStatus >= 200 && liveResult.httpStatus < 300
															? "ok"
															: "err"
											},
											liveResult.httpStatus === null || liveResult.httpStatus === undefined
												? DASH
												: String(liveResult.httpStatus) + (liveResult.httpStatusText ? " " + liveResult.httpStatusText : "")
										)
									),
									h(
										"div",
										{ "data-mh-metric": "1" },
										h("div", { "data-mh-metric-label": "1" }, "tokens"),
										h(
											"div",
											{ "data-mh-metric-value": "1" },
											fmtNum(usage.promptTokens) + " \u2192 " + fmtNum(usage.completionTokens) + " = " + fmtNum(usage.totalTokens),
											usage.totalComputed === true
												? h(Glyph, { title: "上游未提供 total，由 input + output 计算" }, "*")
												: null
										)
									),
									h(
										"div",
										{ "data-mh-metric": "1" },
										h("div", { "data-mh-metric-label": "1" }, "TTFT"),
										h(
											"div",
											{
												"data-mh-metric-value": "1",
												"data-mute": liveResult.ttftMs === null || liveResult.ttftMs === undefined ? "1" : undefined,
												title: liveResult.ttftMs === null || liveResult.ttftMs === undefined ? "非流式请求无首增量耗时" : undefined
											},
											liveResult.ttftMs === null || liveResult.ttftMs === undefined ? DASH : fmtMs(liveResult.ttftMs)
										)
									)
								)
					),

					history !== null
						? h(
								"div",
								{ "data-mh-history-banner": "1" },
								"历史记录 · " + fmtTime(history.startedAt),
								h(
									TextBtn,
									{ ariaLabel: "返回当前结果", onClick: () => setHistory(null) },
									"返回当前"
								)
							)
						: null,

					liveResult === null
						? h(
								"div",
								{ "data-mh-result-empty": "1", role: "status", "aria-live": "polite" },
								h(
									"div",
									{ "data-mh-result-empty-main": "1" },
									testing ? "测试进行中…" : "尚未测试当前目标"
								),
								h("div", { "data-mh-result-empty-sub": "1" }, targetSummary)
							)
						: h(
								"div",
								null,
								// 错误块（宿主给的中文文案，原样渲染）
								liveResult.error !== null && liveResult.error !== undefined
									? h(
											"div",
											{ "data-mh-error": "1", role: "alert", "aria-atomic": "true" },
											h("span", { "data-mh-errorbar": "1" }),
											h(
												"div",
												null,
												h("div", { "data-mh-error-title": "1" }, liveResult.error.title || "请求失败"),
												liveResult.error.hint
													? h("div", { "data-mh-error-hint": "1" }, liveResult.error.hint)
													: null,
												liveResult.error.code
													? h("div", { "data-mh-error-code": "1", "data-mh-code": "1" }, liveResult.error.code)
													: null
											)
										)
									: null,

								// 三层诊断链（固定三键对象，顺序 api → model → strict）
								h(
									"div",
									{ "data-mh-chain": "1", role: "list" },
									LAYER_ORDER.map((k, i) => {
										const layer = liveResult.layers === undefined || liveResult.layers === null ? null : liveResult.layers[k];
										const s = layer === null || layer === undefined ? "skip" : layer.status || "skip";
										const label = layer === null || layer === undefined ? "" : layer.label || "";
										const detail = layer === null || layer === undefined ? "" : layer.detail || "";
										return [
											i > 0
												? h(Glyph, { key: "c-" + k, className: "mh-connector", "data-mh-connector": "1" }, "\u203a")
												: null,
											h(
												"div",
												{
													key: k,
													"data-mh-layer": k,
													"data-s": s,
													role: "listitem",
													"aria-label": "第 " + (i + 1) + " 层 " + label + "：" + s + "。" + detail
												},
												h(
													"div",
													{ "data-mh-layer-head": "1" },
													h("span", { "data-mh-layer-no": "1", "aria-hidden": "true" }, LAYER_NO[k]),
													h(
														"span",
														{ "data-mh-layer-glyph": "1", "data-mh-glyph": "1", "aria-hidden": "true" },
														LAYER_GLYPH[s] || "\u2014"
													),
													h("span", { "data-mh-layer-label": "1" }, label)
												),
												h("div", { "data-mh-layer-detail": "1", title: detail }, detail)
											)
										];
									})
								),

								// 响应区（分段控件）
								h(
									"div",
									{ "data-mh-response": "1" },
									h(
										"div",
										{ "data-mh-response-head": "1" },
										h("span", { "data-mh-response-title": "1" }, "响应内容"),
										h(
											"div",
											{ "data-mh-tablist": "1", role: "tablist", "aria-label": "响应视图" },
											tabs.map((t) =>
												h(
													"button",
													{
														key: t.id,
														type: "button",
														id: "mh-tab-" + t.id,
														"data-mh-tab": "1",
														role: "tab",
														"aria-selected": view === t.id ? "true" : "false",
														"aria-controls": "mh-tabpanel-" + t.id,
														tabIndex: view === t.id ? 0 : -1,
														onClick: () => setView(t.id),
														onKeyDown: (e) => {
															if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
															e.preventDefault();
															const idx = tabs.findIndex((x) => x.id === view);
															const dir = e.key === "ArrowRight" ? 1 : -1;
															setView(tabs[(idx + dir + tabs.length) % tabs.length].id);
														}
													},
													t.label
												)
											)
										),
										h(
											"span",
											{ "data-mh-aux": "1" },
											"usage 来源 " + (liveResult.usageSource || DASH) +
												" · " + vm.metrics.chars + " 字符"
										),
										/* 放大：只在原始响应 / 请求详情两个 tab 出现（模型文本不是代码，
										   弹窗对它没有额外价值，且会让头部变挤） */
										view === "model"
											? null
											: h(
													TextBtn,
													{
														icon: true,
														zoom: true,
														ariaLabel: "放大查看" + vm.title,
														title: "放大查看（可格式化 JSON）",
														onClick: () => setModal({ view: view })
													},
													h(Glyph, null, "\u26f6")
												),
										h(
											TextBtn,
											{
												icon: true,
												ariaLabel:
													view === "raw" ? "复制原始响应" : view === "req" ? "复制请求详情" : "复制响应内容",
												title: copied === "resp" ? "已复制" : "复制",
												onClick: () => copy(vm.copyText, "resp")
											},
											h(Glyph, null, copied === "resp" ? "\u2713" : "\u29c9")
										)
									),
									h(
										"div",
										Object.assign(
											{
												"data-mh-tabpanel": "1",
												"data-view": view,
												id: "mh-tabpanel-" + view,
												role: "tabpanel",
												"aria-labelledby": "mh-tab-" + view
											},
											/* 原始响应属 §2.4「代码」档（等宽 + tabular-nums）；
											   模型文本档不加——规格明确「模型文本不是代码」；
											   请求详情由分块各自带等宽，容器不加。 */
											view === "model" ? null : view === "req" ? null : { "data-mh-code": "1" }
										),
										vm.blocks.map((b) =>
											h(
												"div",
												{
													key: b.key,
													"data-mh-section": b.key,
													"data-empty": b.empty === true ? "1" : undefined
												},
												b.label === null
													? null
													: h(
															"div",
															{ "data-mh-section-head": "1" },
															h("span", { "data-mh-section-k": "1" }, b.label),
															h(
																"span",
																{
																	"data-mh-section-meta": "1",
																	title: b.reason === null ? undefined : b.reason
																},
																metricsText(b.text) + (b.reason === null ? "" : " · 未格式化")
															)
														),
												h(
													"pre",
													{ "data-mh-section-text": "1", title: b.reason === null ? undefined : b.reason },
													b.empty ? "（空）" : b.text
												)
											)
										)
									),
									liveResult.truncated === true
										? h("div", { "data-mh-trunc": "1" }, "内容已截断（原始长度超过展示上限）")
										: null
								)
							)
				),

				// ===== ⑤ 最近测试记录 =====
				h(
					"div",
					{ "data-mh-records": "1", role: "region", "aria-label": "最近测试记录" },
					h(
						"div",
						{ "data-mh-records-head": "1" },
						"最近测试 " + records.length + " 条",
						h(
							"span",
							{ "data-mh-records-actions": "1" },
							h(
								TextBtn,
								{
									ariaLabel: expanded ? "收起记录列表" : "展开记录列表",
									disabled: records.length === 0,
									onClick: () => setExpanded(!expanded)
								},
								expanded ? "收起" : "展开"
							),
							confirmClear
								? h(
										TextBtn,
										{ ariaLabel: "确认清空记录", onClick: onClearClick },
										"确认清空？"
									)
								: h(TextBtn, { ariaLabel: "清空记录", disabled: records.length === 0, onClick: onClearClick }, "清空"),
							confirmClear
								? h(
										TextBtn,
										{ ariaLabel: "取消清空", onClick: () => setConfirmClear(false) },
										"取消"
									)
								: null
						)
					),
					records.length === 0
						? h(
								"div",
								{ "data-mh-records-empty": "1" },
								"还没有测试记录。选择目标后点「发送测试」"
							)
						: h(
								"div",
								{ style: expanded ? { maxHeight: "216px", overflowY: "auto" } : null },
								records.map((r) => {
									const rm = ST[r.status] || ST.untested;
									const tgt = r.target || {};
									return h(
										"div",
										{
											key: r.id,
											"data-mh-record": "1",
											role: "button",
											tabIndex: 0,
											"aria-disabled": testing ? "true" : undefined,
											"aria-label":
												fmtTime(r.startedAt) + " " + (tgt.modelId || DASH) + " " + (tgt.routeKey || DASH) +
												" " + rm.label + " " + fmtMs(r.latencyMs),
											onClick: () => {
												if (testing) return;
												setHistory(r);
												setView("model");
											},
											onKeyDown: (e) => {
												if (e.key !== "Enter" && e.key !== " ") return;
												e.preventDefault();
												if (testing) return;
												setHistory(r);
												setView("model");
											}
										},
										h(Dot, { kind: rm.tone === "ok" ? "ok" : rm.tone === "warn" ? "idle" : rm.tone === "err" ? "bad" : "idle", title: rm.label }),
										h("span", { "data-mh-record-time": "1" }, fmtTime(r.startedAt)),
										h("span", { "data-mh-record-model": "1", title: tgt.modelId || "" }, tgt.modelId || DASH),
										h("span", { "data-mh-record-route": "1", title: tgt.routeKey || "" }, tgt.displayName || tgt.routeKey || DASH),
										h("span", { "data-mh-record-lat": "1" }, fmtMs(r.latencyMs)),
										h(
											"span",
											{ "data-mh-record-http": "1" },
											r.httpStatus === null || r.httpStatus === undefined ? DASH : String(r.httpStatus)
										),
										h("span", { "data-mh-record-status": "1", "data-tone": rm.tone }, rm.label)
									);
								})
							)
				),

				// ===== ⑥ 放大弹窗（portal 到 body；只在用户点放大时渲染） =====
				modal !== null && modalVm !== null
					? h(
							Modal,
							{ onClose: () => setModal(null) },
							h(
								"div",
								{ "data-mh-modal-head": "1" },
								h("span", { "data-mh-modal-title": "1", id: "mh-modal-title" }, modalVm.title),
								h("span", { "data-mh-modal-sub": "1", title: targetSummary }, targetSummary),
								h(
									"span",
									{ "data-mh-modal-meta": "1" },
									/* 头部计量描述的是**复制/原文**的规模，块头计量描述的是**当前显示**的规模：
									   美化开启时两者会不同（原文 1 行 → 格式化后 15 行）。此处显式标注「原文」，
									   否则用户会以为数字算错了。 */
									"原文 " + metricsText(modalVm.copyText) +
										" · usage 来源 " + (liveResult.usageSource || DASH)
								),
								h(
									"span",
									{ "data-mh-modal-tools": "1" },
									h(
										"button",
										{
											type: "button",
											"data-mh-pretty": "1",
											"aria-pressed": pretty ? "true" : "false",
											disabled: modalVm.canPretty !== true,
											title:
												modalVm.canPretty === true
													? pretty
														? "当前为格式化（缩进 2 空格）；点击切回原文"
														: "当前为原文；点击格式化为缩进 2 空格的 JSON"
													: String(modalVm.prettyReason || "该内容不是 JSON，无法格式化"),
											onClick: () => setPretty(!pretty)
										},
										h(Glyph, null, pretty ? "\u2a3f" : "\u2261"),
										pretty ? "美化" : "原文"
									),
									h(
										TextBtn,
										{
											icon: true,
											ariaLabel: "复制" + modalVm.title,
											title: copied === "modal" ? "已复制" : "复制（原文）",
											onClick: () => copy(modalVm.copyText, "modal")
										},
										h(Glyph, null, copied === "modal" ? "\u2713" : "\u29c9")
									),
									h(
										TextBtn,
										{ icon: true, modalClose: true, ariaLabel: "关闭放大视图", title: "关闭（Esc）", onClick: () => setModal(null) },
										h(Glyph, null, "\u2715")
									)
								)
							),
							h(
								"div",
								{
									"data-mh-modal-body": "1",
									"data-view": modalVm.view,
									"data-mh-code": modalVm.view === "model" ? undefined : "1"
								},
								modalVm.blocks.length === 0 || (modalVm.view !== "req" && modalVm.blocks[0].empty === true)
									? h("span", { "data-mh-modal-empty": "1" }, "（空响应）")
									: modalVm.blocks.map((b) =>
											h(
												"div",
												{
													key: b.key,
													"data-mh-section": b.key,
													"data-empty": b.empty === true ? "1" : undefined
												},
												b.label === null
													? null
													: h(
															"div",
															{ "data-mh-section-head": "1" },
															h("span", { "data-mh-section-k": "1" }, b.label),
															h(
																"span",
																{
																	"data-mh-section-meta": "1",
																	title: b.reason === null ? undefined : b.reason
																},
																metricsText(b.text) + (b.reason === null ? "" : " · 未格式化")
															)
														),
												h(
													"pre",
													{
														"data-mh-section-text": "1",
														title: b.reason === null ? undefined : b.reason
													},
													b.empty ? "（空）" : b.text
												)
											)
										)
							),
							h(
								"div",
								{ "data-mh-modal-foot": "1" },
								h(
									"span",
									{ "data-mh-modal-hint": "1" },
									modalVm.canPretty === true
										? "JSON 可格式化：请求详情为分块文本，各块独立判断能否美化"
										: String(modalVm.prettyReason || "该内容不是 JSON，按原文展示")
								),
								liveResult.truncated === true
									? h("span", { "data-mh-trunc": "1" }, "内容已截断（原始长度超过展示上限）")
									: null
							)
						)
					: null,

				// 瞬时反馈 live region（ui-spec §6.4）
				h("span", { "data-mh-live": "1", role: "status", "aria-live": "polite" }, live)
			);
		}

		// ---------- 客户端插件模块 ----------
		exports.inject = ["slots"];
		exports.apply = (ctx) => {
			try {
				ensureStyle();
				if (!ctx.slots || typeof ctx.slots.inject !== "function") {
					console.warn("[model-health] client: 无 slots 服务，跳过面板注册");
					return;
				}
				ctx.slots.inject("conversation.view", () =>
					ctx.slots.register(
						{
							name: "conversation.view",
							id: "model-health-view",
							order: 320,
							label: () => "模型健康检查"
						},
						ModelHealthPanel
					)
				);
			} catch (e) {
				console.error("[model-health] client: 面板注册失败", e);
			}
		};

		/**
		 * 纯逻辑出口（不依赖 React）：供 t16 / t17 做单元级核对，
		 * 尤其是第四行「分组作用域」判据与四行联动——只靠 DOM 断言覆盖不全。
		 */
		exports.__logic = {
			statusKey,
			defaultSelection,
			row4Visible,
			row4Candidates,
			singleRouteModel,
			selectProvider,
			selectGroup,
			selectModel,
			reconcileSelection,
			resolveTarget,
			previewFor,
			credentialState,
			fmtMs,
			fmtNum,
			LAYER_ORDER,
			// §18 重试控件
			initialRetry,
			validateRetryForm,
			retryUnlimited,
			retrySummary,
			oneDecimal,
			// §19 默认模型
			isCurrentDefault,
			initialSelection,
			// 响应内容视图（内联 + 放大弹窗共用）
			tryFormatJson,
			viewBlockText,
			reqSections,
			viewModel,
			textMetrics,
			metricsText,
			RETRY_MODES,
			STOP_TEXT
		};

		return module.exports;
	}
});
