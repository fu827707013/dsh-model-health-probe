/**
 * 三协议裸 HTTP 探针（SPEC §6、§8、§9、§10）。
 *
 * 本文件是插件的核心：请求构造、真实发送、响应解析、错误归一化、三层诊断链。
 * 全部规则逐行核对过官方 SDK 与 @earendil-works/pi-ai 源码，核对坐标见 SPEC §6.7。
 *
 * 关键事实（不可凭直觉改写）：
 *   - URL 拼接三协议共用同一行（openai 与 @anthropic-ai/sdk 逐字相同）；
 *   - openai 系 baseURL 必须自带 /v1，anthropic 系不能带 /v1（SDK 自己加）；
 *   - 三协议流式终止符各不相同：[DONE] / response.completed / message_stop；
 *   - anthropic 流式 usage 分两处，必须跨事件累积，否则丢 input_tokens；
 *   - openai 流式必须发 stream_options.include_usage，否则拿不到 usage；
 *   - SSE 必须按字节缓冲 + TextDecoder({stream:true}) 增量解码，否则中文被切碎。
 */

/** 本插件支持的三种协议（SPEC §2.2 第 9 条：其余一律 UNSUPPORTED_API）。 */
export const SUPPORTED_APIS = new Set([
  "openai-completions",
  "openai-responses",
  "anthropic-messages"
]);

/** 协议 → 请求路径。 */
export const API_PATHS = {
  "openai-completions": "/chat/completions",
  "openai-responses": "/responses",
  "anthropic-messages": "/v1/messages"
};

export const ANTHROPIC_VERSION = "2023-06-01";

/**
 * 预览态鉴权头占位符（真实发送时替换为解析出的密钥）。
 *
 * 注意：它是**密钥值**的占位符，不是整个头值的占位符。带 `Bearer ` 前缀的协议
 * 必须写成 `Bearer ${占位符}`，否则预览头与真实头在字面上不等——
 * 预览显示 `<发送时解析>` 而真实发送 `Bearer sk-xxx`，用户无法核对前缀，
 * 也破坏「预览与真实请求同源」契约（SPEC §11.1）。
 */
export const AUTH_PLACEHOLDER = "<发送时解析>";

export const DEFAULT_MAX_RESPONSE_BYTES = 4 * 1024 * 1024;

/** 展示截断上限（SPEC §10.3）。 */
const RAW_LIMIT = 8192;
const BODY_PREVIEW_LIMIT = 4000;
const ERROR_RAW_LIMIT = 1000;

/**
 * URL 拼接：与两个官方 SDK 逐字相同的唯一实现（SPEC §6.1）。
 *
 * `new URL(baseURL + (baseURL.endsWith('/') && path.startsWith('/') ? path.slice(1) : path))`
 *
 * 有意不做任何智能修正：不补 /v1、不裁 /v1、不合并双斜杠。
 * 本机 aimax66（anthropic 且 baseURL 自带 /v1）会如实拼成 `/v1/v1/messages`。
 *
 * @param {string} baseURL - 用户配置的原始基址
 * @param {string} path - 协议路径
 * @returns {string} 最终 URL 字符串
 * @throws {Error} baseURL 不是合法 URL 时抛出（调用方转 MISSING_BASE_URL / BAD_REQUEST）
 */
export function joinUrl(baseURL, path) {
  const b = String(baseURL ?? "");
  return new URL(b + (b.endsWith("/") && path.startsWith("/") ? path.slice(1) : path)).toString();
}

/** 测试消息模板默认值（SPEC §6.4）。 */
export const DEFAULT_TEMPLATES = {
  systemPrompt: "你是连通性探针。只输出 OK 两个大写字母，不要输出任何其他字符、标点或解释。",
  userPrompt: "输出 OK",
  maxOutputTokens: 64,
  expectText: "OK"
};

/** 解析生效的模板（插件配置可覆盖默认值）。 */
export function resolveTemplates(cfg) {
  const t = cfg?.templates ?? {};
  const pick = (v, fallback) => (typeof v === "string" && v !== "" ? v : fallback);
  const maxOut = Number.isFinite(t.maxOutputTokens) ? t.maxOutputTokens : DEFAULT_TEMPLATES.maxOutputTokens;
  return {
    systemPrompt: pick(t.systemPrompt, DEFAULT_TEMPLATES.systemPrompt),
    userPrompt: pick(t.userPrompt, DEFAULT_TEMPLATES.userPrompt),
    maxOutputTokens: maxOut,
    expectText: pick(t.expectText, DEFAULT_TEMPLATES.expectText)
  };
}

/**
 * 构造请求（SPEC §6.2 头、§6.3 体）。
 *
 * 预览与真实发送**共用本函数**，这是「预览 URL 与真实请求同源」契约（AC4）的实现基础：
 * 不传 apiKey 时鉴权头渲染为占位符，传入时替换为真实值，其余部分逐字节相同。
 *
 * @returns {{method: string, url: string, headers: Record<string,string>, body: object}}
 */
export function buildRequest({ baseURL, api, modelId, stream, cfg, apiKey, systemPrompt, userPrompt }) {
  const t = resolveTemplates(cfg);
  const path = API_PATHS[api];
  if (path === undefined) {
    throw new Error(`unsupported api: ${String(api)}`);
  }
  const url = joinUrl(baseURL, path);
  const sys = typeof systemPrompt === "string" && systemPrompt !== "" ? systemPrompt : t.systemPrompt;
  const usr = typeof userPrompt === "string" && userPrompt !== "" ? userPrompt : t.userPrompt;
  const maxOut = t.maxOutputTokens;

  const headers = {
    "content-type": "application/json",
    accept: stream ? "text/event-stream" : "application/json"
  };

  let body;
  if (api === "openai-completions") {
    headers.authorization = apiKey === undefined ? `Bearer ${AUTH_PLACEHOLDER}` : `Bearer ${apiKey}`;
    body = {
      model: modelId,
      messages: [
        { role: "system", content: sys },
        { role: "user", content: usr }
      ],
      max_tokens: maxOut,
      stream: stream === true
    };
    if (stream === true) {
      // 不发这个，流式响应里根本不会有 usage（SPEC §6.6）
      body.stream_options = { include_usage: true };
    }
  } else if (api === "openai-responses") {
    headers.authorization = apiKey === undefined ? `Bearer ${AUTH_PLACEHOLDER}` : `Bearer ${apiKey}`;
    body = {
      model: modelId,
      instructions: sys,
      input: [{ role: "user", content: [{ type: "input_text", text: usr }] }],
      max_output_tokens: maxOut,
      store: false,
      stream: stream === true
    };
  } else {
    // anthropic-messages
    headers["x-api-key"] = apiKey === undefined ? AUTH_PLACEHOLDER : apiKey;
    headers["anthropic-version"] = ANTHROPIC_VERSION;
    body = {
      model: modelId,
      max_tokens: maxOut, // 必填，缺失上游直接 400
      system: sys, // 顶层字符串，不在 messages 里
      messages: [{ role: "user", content: usr }],
      stream: stream === true
    };
  }

  return { method: "POST", url, headers, body };
}

/** 预览态请求：鉴权头用占位符，供面板「将请求」区渲染。 */
export function previewRequest(args) {
  const req = buildRequest({ ...args, apiKey: undefined });
  return { method: req.method, url: req.url, headers: req.headers, body: req.body };
}

/** 分组级警告（SPEC §7.5，非阻断）。 */
export function buildWarnings({ api, baseURLNormalized, rawBaseURL }) {
  const out = [];
  if (rawBaseURL === null || rawBaseURL === undefined || String(rawBaseURL).trim() === "") {
    out.push({ code: "MISSING_BASE_URL", message: "该路由未配置 Base URL，测试将失败" });
    return out;
  }
  if (!SUPPORTED_APIS.has(api)) {
    out.push({
      code: "UNSUPPORTED_API",
      message: `该路由声明的协议「${String(api)}」不在支持范围（仅 openai-completions / openai-responses / anthropic-messages），测试将失败`
    });
    return out;
  }
  if (api === "anthropic-messages" && baseURLNormalized.endsWith("/v1")) {
    out.push({
      code: "ANTHROPIC_BASEURL_HAS_V1",
      message: "该 Base URL 以 /v1 结尾，anthropic 系会拼成 /v1/v1/messages；anthropic 系 baseURL 不应带 /v1"
    });
  }
  if ((api === "openai-completions" || api === "openai-responses") && !baseURLNormalized.endsWith("/v1")) {
    out.push({
      code: "OPENAI_BASEURL_MISSING_V1",
      message: "openai 系 Base URL 通常自带 /v1；若上游返回 404，请核对此项"
    });
  }
  return out;
}

/** 密钥可发送性校验：只允许 HTTP 头能承载的可打印 ASCII（SPEC §8.1）。 */
export function normalizeApiKey(raw) {
  if (typeof raw !== "string") return { ok: false, reason: "empty" };
  const value = raw.trim();
  if (value.length === 0) return { ok: false, reason: "empty" };
  if (!/^[\x21-\x7E]+$/.test(value)) return { ok: false, reason: "illegalCharacters" };
  return { ok: true, value };
}

/** 凭据引用名合法性（POSIX 标识符）。 */
export function isCredentialRefName(name) {
  return typeof name === "string" && /^[A-Za-z_][A-Za-z0-9_]*$/.test(name);
}

/** 空 usage 骨架（字段恒存在，无值用 null）。 */
export function emptyUsage() {
  return {
    promptTokens: null,
    completionTokens: null,
    totalTokens: null,
    cacheReadTokens: null,
    cacheWriteTokens: null,
    totalComputed: false
  };
}

/**
 * 错误映射表（SPEC §10.1）：code → 中文 title + 下一步 hint。
 * title 是结论，hint 是动作，均由宿主生成，客户端原样渲染。
 */
const ERROR_TABLE = {
  DNS_FAILED: {
    title: "域名解析失败，请求未发出",
    hint: "核对 Base URL 的主机名拼写；确认本机 DNS 与外网可达"
  },
  CONNECTION_REFUSED: {
    title: "目标端口拒绝连接",
    hint: "确认服务端在运行、端口与协议（http / https）与配置一致"
  },
  CONNECTION_RESET: {
    title: "连接被对端中断",
    hint: "链路或中间网关中断；稍后重试一次以区分偶发与常态"
  },
  TLS_ERROR: {
    title: "TLS 握手失败（证书或协议版本）",
    hint: "检查证书是否过期、是否自签；确认 Base URL 用的是 https"
  },
  TIMEOUT: {
    title: "请求超过设定时限未完成",
    hint: "提高超时或换非流式；确认上游未限流"
  },
  HTTP_401: {
    title: "鉴权失败：密钥被拒绝",
    hint: "核对密钥是否有效、是否过期；确认密钥与协议匹配（anthropic 的 key 不能用于 openai 端点，反之同理）"
  },
  HTTP_403: {
    title: "无权访问该资源",
    hint: "密钥缺少该模型或该路径的权限、被风控、或需要 IP 白名单"
  },
  HTTP_404: {
    title: "路径不存在：URL 拼错或路径后缀不符",
    hint: "核对 Base URL 后缀：openai 系必须自带 /v1（缺少时会请求 /chat/completions 而 404）；anthropic 系不能带 /v1（多带时会请求 /v1/v1/messages）"
  },
  HTTP_405: {
    title: "该地址不接受 POST",
    hint: "Base URL 指向了非 API 路径（网页地址或文档地址）"
  },
  HTTP_408: {
    title: "上游报告请求超时",
    hint: "稍后重试；确认网关侧超时配置"
  },
  HTTP_413: {
    title: "请求体过大被拒",
    hint: "本插件请求体极小；该错误说明 Base URL 指向了其他服务"
  },
  HTTP_429: {
    title: "触发上游限流",
    hint: "稍后重试；检查该密钥的配额与并发占用"
  },
  HTTP_5XX: {
    title: "上游服务端错误",
    hint: "网关故障或模型不可用；稍后重试，持续失败则联系供应商"
  },
  HTTP_ERROR: {
    title: "上游返回非预期状态",
    hint: "查看原始响应体定位原因"
  },
  BAD_RESPONSE_JSON: {
    title: "响应不是 JSON，疑似被网关拦截",
    hint: "查看原始响应体；确认该地址提供的是所选协议"
  },
  MISSING_RESPONSE_FIELD: {
    title: "响应结构不符合该协议",
    hint: "核对所选 API 类型与上游实际协议是否一致"
  },
  EMPTY_RESPONSE: {
    title: "请求成功但模型没有返回文本",
    hint: "上游返回了空内容或被内容策略拦截；查看原始响应体"
  },
  STREAM_NO_TERMINAL: {
    title: "流被提前关闭",
    hint: "网关不支持流式或中途断开；改用非流式核对"
  },
  STREAM_PARSE_ERROR: {
    title: "流式帧无法解析",
    hint: "查看原始事件摘要；确认上游返回的是标准 SSE"
  },
  RESPONSE_TOO_LARGE: {
    title: "响应体超过大小上限",
    hint: "该地址返回的内容疑似网页或文件，而非模型响应"
  },
  MISSING_CREDENTIAL: {
    title: "该供应商未配置密钥",
    hint: "在模型设置页填写该引用名指向的密钥，或在环境变量中提供"
  },
  INVALID_CREDENTIAL: {
    title: "密钥含 HTTP 头无法承载的字符",
    hint: "只粘贴密钥原文，不要带引号、空格或换行"
  },
  UNSUPPORTED_API: {
    title: "该路由的协议不在支持范围",
    hint: "本插件只测 openai-completions / openai-responses / anthropic-messages 三种协议"
  },
  MISSING_BASE_URL: {
    title: "该路由未配置 Base URL",
    hint: "在模型设置页补齐 Base URL"
  },
  TEST_IN_FLIGHT: {
    title: "该目标正在测试中",
    hint: "等待当前测试返回"
  },
  SETTINGS_UNAVAILABLE: {
    title: "未读取到 llm-pi-ai 配置",
    hint: "确认 llm-pi-ai 插件已加载、命名空间已注册；点「重新加载」"
  },
  BAD_REQUEST: { title: "请求参数不合法", hint: "核对请求体字段名与类型" },
  UNKNOWN_ROUTE: { title: "未找到该路由", hint: "核对 routeKey 是否存在于当前配置" },
  UNKNOWN_MODEL: { title: "该路由未声明此模型", hint: "核对 modelId 是否在该路由的 models 中" }
};

/** 取某 code 的中文 title / hint（未知 code 回落为通用文案）。 */
export function describeError(code) {
  const hit = ERROR_TABLE[code];
  if (hit !== undefined) return hit;
  return { title: "测试失败", hint: "查看原始错误信息定位原因" };
}

/** 按 HTTP 状态码映射 code。 */
export function httpCodeOf(status) {
  if (status === 401) return "HTTP_401";
  if (status === 403) return "HTTP_403";
  if (status === 404) return "HTTP_404";
  if (status === 405) return "HTTP_405";
  if (status === 408) return "HTTP_408";
  if (status === 413) return "HTTP_413";
  if (status === 429) return "HTTP_429";
  if (status >= 500) return "HTTP_5XX";
  return "HTTP_ERROR";
}

/** 网络层异常 → code。 */
export function classifyNetworkError(err) {
  const code = err?.code ?? err?.cause?.code;
  const name = err?.name;
  if (name === "AbortError" || code === "ABORT_ERR" || code === "ABORTED") return "TIMEOUT";
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") return "DNS_FAILED";
  if (code === "ECONNREFUSED") return "CONNECTION_REFUSED";
  if (code === "ECONNRESET" || code === "EPIPE") return "CONNECTION_RESET";
  if (
    typeof code === "string" &&
    (code.startsWith("ERR_TLS") ||
      code === "CERT_HAS_EXPIRED" ||
      code === "DEPTH_ZERO_SELF_SIGNED_CERT" ||
      code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE" ||
      code === "SELF_SIGNED_CERT_IN_CHAIN")
  ) {
    return "TLS_ERROR";
  }
  return "CONNECTION_RESET";
}

/** 脱敏：把密钥值从任意文本中抹掉（SPEC §8.4 零泄漏硬要求）。 */
export function redactText(text, secret) {
  if (typeof text !== "string") return text;
  if (typeof secret !== "string" || secret === "") return text;
  return text.split(secret).join("***");
}

/** 构造一个脱敏后的 error 对象。 */
export function makeError(code, { httpStatus = null, raw = null, detail = null } = {}) {
  const { title, hint } = describeError(code);
  return {
    code,
    title,
    hint: detail !== null && detail !== undefined ? detail : hint,
    httpStatus,
    raw: typeof raw === "string" ? raw.slice(0, ERROR_RAW_LIMIT) : null
  };
}

/** 三层诊断链骨架（SPEC §9.2）：固定三键，顺序 api → model → strict。 */
export function emptyLayers() {
  return {
    api: { status: "skip", label: "API 请求", detail: "上游层未通过，本层未执行", code: null },
    model: { status: "skip", label: "模型响应", detail: "上游层未通过，本层未执行", code: null },
    strict: { status: "skip", label: "严格校验", detail: "上游层未通过，本层未执行", code: null }
  };
}

/**
 * 增量 SSE 解析器（SPEC §6.6）。
 *
 * 按字节缓冲 + TextDecoder({stream:true}) 增量解码：多字节 UTF-8 序列跨 chunk 断开时
 * 不会被切碎。**禁止**对每个 Uint8Array 直接 toString()。
 */
export class SseParser {
  constructor() {
    this.decoder = new TextDecoder("utf-8");
    this.buffer = "";
    this.eventType = null;
    this.dataLines = [];
    this.queue = [];
    this.count = 0;
    this.types = [];
  }

  /** 喂入一段字节，返回本次新产生的事件数组。 */
  push(bytes) {
    this.buffer += this.decoder.decode(bytes, { stream: true });
    this.#drainLines();
    return this.#takeQueue();
  }

  /** 流结束：冲刷解码器与残留行，返回剩余事件。 */
  flush() {
    this.buffer += this.decoder.decode();
    this.#drainLines();
    if (this.buffer !== "") {
      this.#handleLine(this.buffer);
      this.buffer = "";
    }
    this.#dispatch();
    return this.#takeQueue();
  }

  #drainLines() {
    for (;;) {
      const idx = this.buffer.indexOf("\n");
      if (idx === -1) break;
      let line = this.buffer.slice(0, idx);
      this.buffer = this.buffer.slice(idx + 1);
      if (line.endsWith("\r")) line = line.slice(0, -1);
      this.#handleLine(line);
    }
  }

  #handleLine(line) {
    if (line === "") {
      this.#dispatch();
      return;
    }
    if (line.startsWith(":")) return; // SSE 注释行
    const colon = line.indexOf(":");
    let field;
    let value;
    if (colon === -1) {
      field = line;
      value = "";
    } else {
      field = line.slice(0, colon);
      value = line.slice(colon + 1);
      if (value.startsWith(" ")) value = value.slice(1); // 规范：剥掉一个前导空格
    }
    if (field === "event") this.eventType = value;
    else if (field === "data") this.dataLines.push(value);
  }

  #dispatch() {
    if (this.dataLines.length === 0 && this.eventType === null) return;
    const data = this.dataLines.join("\n");
    const evt = { event: this.eventType, data };
    this.eventType = null;
    this.dataLines = [];
    if (evt.event === null && data === "") return;
    this.queue.push(evt);
    this.count += 1;
    const key = evt.event === null ? "(data)" : evt.event;
    if (!this.types.includes(key)) this.types.push(key);
  }

  #takeQueue() {
    const out = this.queue;
    this.queue = [];
    return out;
  }
}

/** 从响应体解析出的中间结果。 */
function parseNonStreamBody(api, json) {
  const out = { text: "", finishReason: null, usage: emptyUsage(), usageSource: "none", fieldOk: false };

  if (api === "openai-completions") {
    const choice = json?.choices?.[0];
    if (choice === undefined) return out;
    out.fieldOk = true;
    const content = choice?.message?.content;
    out.text = typeof content === "string" ? content : "";
    out.finishReason = choice?.finish_reason ?? null;
    const u = json?.usage;
    if (u && typeof u === "object") {
      out.usage.promptTokens = Number.isFinite(u.prompt_tokens) ? u.prompt_tokens : null;
      out.usage.completionTokens = Number.isFinite(u.completion_tokens) ? u.completion_tokens : null;
      out.usage.totalTokens = Number.isFinite(u.total_tokens) ? u.total_tokens : null;
      const details = u.prompt_tokens_details ?? {};
      out.usage.cacheReadTokens =
        Number.isFinite(details?.cached_tokens)
          ? details.cached_tokens
          : Number.isFinite(u.prompt_cache_hit_tokens)
            ? u.prompt_cache_hit_tokens
            : Number.isFinite(u.cached_tokens)
              ? u.cached_tokens
              : null;
      out.usage.cacheWriteTokens = Number.isFinite(details?.cache_write_tokens)
        ? details.cache_write_tokens
        : null;
      out.usageSource = "body";
    }
    return out;
  }

  if (api === "openai-responses") {
    // 注意：顶层 output_text 是 openai SDK 客户端补的便利字段，裸 HTTP 收不到。
    // 必须自己遍历 output[].content[] 取 type === "output_text" 的 text。
    const output = json?.output;
    if (!Array.isArray(output)) return out;
    out.fieldOk = true;
    const parts = [];
    for (const item of output) {
      if (item?.type !== "message") continue;
      const content = item?.content;
      if (!Array.isArray(content)) continue;
      for (const c of content) {
        if (c?.type === "output_text" && typeof c.text === "string") parts.push(c.text);
      }
    }
    out.text = parts.join("");
    out.finishReason = typeof json?.status === "string" ? json.status : null;
    const u = json?.usage;
    if (u && typeof u === "object") {
      out.usage.promptTokens = Number.isFinite(u.input_tokens) ? u.input_tokens : null;
      out.usage.completionTokens = Number.isFinite(u.output_tokens) ? u.output_tokens : null;
      out.usage.totalTokens = Number.isFinite(u.total_tokens) ? u.total_tokens : null;
      out.usage.cacheReadTokens = Number.isFinite(u?.input_tokens_details?.cached_tokens)
        ? u.input_tokens_details.cached_tokens
        : null;
      out.usageSource = "body";
    }
    return out;
  }

  // anthropic-messages
  const content = json?.content;
  if (!Array.isArray(content)) return out;
  out.fieldOk = true;
  const parts = [];
  for (const c of content) {
    if (c?.type === "text" && typeof c.text === "string") parts.push(c.text);
  }
  out.text = parts.join("");
  out.finishReason = typeof json?.stop_reason === "string" ? json.stop_reason : null;
  const u = json?.usage;
  if (u && typeof u === "object") {
    const input = Number.isFinite(u.input_tokens) ? u.input_tokens : null;
    const output2 = Number.isFinite(u.output_tokens) ? u.output_tokens : null;
    out.usage.promptTokens = input;
    out.usage.completionTokens = output2;
    // 上游不提供 total_tokens，由 input + output 计算
    if (input !== null && output2 !== null) {
      out.usage.totalTokens = input + output2;
      out.usage.totalComputed = true;
    }
    out.usage.cacheReadTokens = Number.isFinite(u.cache_read_input_tokens) ? u.cache_read_input_tokens : null;
    out.usage.cacheWriteTokens = Number.isFinite(u.cache_creation_input_tokens)
      ? u.cache_creation_input_tokens
      : null;
    out.usageSource = "body";
  }
  return out;
}

/**
 * 处理一个流式事件，就地累积文本 / usage / 终止标记。
 * 三种协议的帧形状与终止符各不相同，这里按 api 分派。
 */
function consumeStreamEvent(api, evt, acc, nowMs, startedAt) {
  let payload = null;
  const raw = evt.data;
  if (typeof raw === "string" && raw !== "" && raw !== "[DONE]") {
    try {
      payload = JSON.parse(raw);
    } catch {
      acc.parseErrors += 1;
      return;
    }
  }

  if (api === "openai-completions") {
    if (raw === "[DONE]") {
      acc.terminal = true;
      return;
    }
    if (payload === null) return;
    const delta = payload?.choices?.[0]?.delta?.content;
    if (typeof delta === "string" && delta !== "") {
      acc.text += delta;
      if (acc.ttftMs === null) acc.ttftMs = nowMs - startedAt;
    }
    if (payload?.usage && typeof payload.usage === "object") {
      const u = payload.usage;
      acc.usage.promptTokens = Number.isFinite(u.prompt_tokens) ? u.prompt_tokens : null;
      acc.usage.completionTokens = Number.isFinite(u.completion_tokens) ? u.completion_tokens : null;
      acc.usage.totalTokens = Number.isFinite(u.total_tokens) ? u.total_tokens : null;
      const details = u.prompt_tokens_details ?? {};
      acc.usage.cacheReadTokens = Number.isFinite(details?.cached_tokens)
        ? details.cached_tokens
        : Number.isFinite(u.prompt_cache_hit_tokens)
          ? u.prompt_cache_hit_tokens
          : null;
      acc.usageSource = "openai-final-chunk";
    }
    const fr = payload?.choices?.[0]?.finish_reason;
    if (typeof fr === "string") acc.finishReason = fr;
    return;
  }

  if (api === "openai-responses") {
    if (payload === null) return;
    const type = payload.type ?? evt.event;
    if (type === "response.output_text.delta" || type === "response.refusal.delta") {
      const delta = payload.delta;
      if (typeof delta === "string" && delta !== "") {
        acc.text += delta;
        if (acc.ttftMs === null) acc.ttftMs = nowMs - startedAt;
      }
      return;
    }
    if (type === "response.completed" || type === "response.incomplete") {
      acc.terminal = true;
      const resp = payload.response ?? {};
      // 缺文本时用最终 response 兜底（有些网关只在 completed 里给全文）
      if (acc.text === "") {
        const parsed = parseNonStreamBody("openai-responses", resp);
        if (parsed.text !== "") acc.text = parsed.text;
      }
      const u = resp?.usage;
      if (u && typeof u === "object") {
        acc.usage.promptTokens = Number.isFinite(u.input_tokens) ? u.input_tokens : null;
        acc.usage.completionTokens = Number.isFinite(u.output_tokens) ? u.output_tokens : null;
        acc.usage.totalTokens = Number.isFinite(u.total_tokens) ? u.total_tokens : null;
        acc.usage.cacheReadTokens = Number.isFinite(u?.input_tokens_details?.cached_tokens)
          ? u.input_tokens_details.cached_tokens
          : null;
        acc.usageSource = "responses-completed";
      }
      if (typeof resp?.status === "string") acc.finishReason = resp.status;
      if (type === "response.incomplete") acc.incomplete = true;
      return;
    }
    if (type === "response.failed") {
      acc.terminal = true;
      acc.failed = true;
      const resp = payload.response ?? {};
      const e = resp?.error;
      acc.failedMessage = e ? `${e.code ?? "unknown"}: ${e.message ?? "no message"}` : "response.failed";
      return;
    }
    if (type === "error") {
      acc.terminal = true;
      acc.failed = true;
      acc.failedMessage = `Error Code ${payload.code ?? "?"}: ${payload.message ?? "Unknown error"}`;
    }
    return;
  }

  // anthropic-messages：event: 与 data: 成对
  const type = payload?.type ?? evt.event;
  if (type === "message_start") {
    // input_tokens 只在这里出现
    const u = payload?.message?.usage;
    if (u && typeof u === "object") {
      if (Number.isFinite(u.input_tokens)) acc.usage.promptTokens = u.input_tokens;
      if (Number.isFinite(u.output_tokens)) acc.usage.completionTokens = u.output_tokens;
      acc.usage.cacheReadTokens = Number.isFinite(u.cache_read_input_tokens)
        ? u.cache_read_input_tokens
        : null;
      acc.usage.cacheWriteTokens = Number.isFinite(u.cache_creation_input_tokens)
        ? u.cache_creation_input_tokens
        : null;
      acc.sawUsage = true;
    }
    if (typeof payload?.message?.stop_reason === "string") acc.finishReason = payload.message.stop_reason;
    return;
  }
  if (type === "content_block_delta") {
    const d = payload?.delta;
    if (d?.type === "text_delta" && typeof d.text === "string" && d.text !== "") {
      acc.text += d.text;
      if (acc.ttftMs === null) acc.ttftMs = nowMs - startedAt;
    }
    return;
  }
  if (type === "message_delta") {
    // output_tokens 在这里；必须跨事件累积，不能覆盖掉 message_start 的 input_tokens
    const u = payload?.usage;
    if (u && typeof u === "object") {
      if (Number.isFinite(u.input_tokens)) acc.usage.promptTokens = u.input_tokens;
      if (Number.isFinite(u.output_tokens)) acc.usage.completionTokens = u.output_tokens;
      if (Number.isFinite(u.cache_read_input_tokens)) acc.usage.cacheReadTokens = u.cache_read_input_tokens;
      acc.sawUsage = true;
    }
    const d = payload?.delta;
    if (typeof d?.stop_reason === "string") acc.finishReason = d.stop_reason;
    return;
  }
  if (type === "message_stop") {
    acc.terminal = true;
  }
}

/** 有界读取响应体（SPEC §8.3）：先看 content-length，再按累计字节强制。 */
async function readBounded(response, maxBytes) {
  const declared = Number(response.headers.get("content-length") ?? NaN);
  if (Number.isFinite(declared) && declared > maxBytes) {
    try {
      await response.body?.cancel();
    } catch {
      /* 尽力而为 */
    }
    return { tooLarge: true, bytes: new Uint8Array(0) };
  }
  if (response.body === null) return { tooLarge: false, bytes: new Uint8Array(0) };
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        try {
          await reader.cancel();
        } catch {
          /* 尽力而为 */
        }
        return { tooLarge: true, bytes: new Uint8Array(0) };
      }
      chunks.push(value);
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      /* 尽力而为 */
    }
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  return { tooLarge: false, bytes: out };
}

/**
 * 执行一次真实探测（SPEC §8、§9）。
 *
 * 任何异常都转成结构化 TestResult，绝不向上抛——端点不允许 500。
 *
 * @returns {Promise<object>} TestResult（不含 id，由调用方补）
 */
export async function executeProbe({
  routeKey,
  displayName,
  baseURL,
  baseURLNormalized,
  api,
  modelId,
  stream,
  routeCount,
  credentialRef,
  apiKey,
  credentialError,
  cfg,
  systemPrompt,
  userPrompt,
  fetchImpl,
  externalSignal
}) {
  const startedAt = Date.now();
  const t = resolveTemplates(cfg);
  const maxResponseBytes = Number.isFinite(cfg?.maxResponseBytes)
    ? cfg.maxResponseBytes
    : DEFAULT_MAX_RESPONSE_BYTES;
  const hardTimeoutMs = Number.isFinite(cfg?.hardTimeoutMs) ? cfg.hardTimeoutMs : 60000;
  const slowMs = Number.isFinite(cfg?.slowMs) ? cfg.slowMs : 15000;
  const doFetch = fetchImpl ?? globalThis.fetch;

  // 脱敏基准值：settle() 可能在密钥校验之前被调用（如 UNSUPPORTED_API 提前返回），
  // 因此这里提前取原始入参，避免引用尚在 TDZ 的 usableKey。
  const redactSecret = typeof apiKey === "string" ? apiKey.trim() : "";

  const layers = emptyLayers();
  const result = {
    pluginVersion: cfg?.pluginVersion ?? "0.1.0",
    startedAt,
    finishedAt: startedAt,
    latencyMs: 0,
    ttftMs: null,
    status: "failed",
    reasons: [],
    target: {
      routeKey,
      displayName: displayName ?? routeKey,
      baseURL: baseURL ?? null,
      baseURLNormalized: baseURLNormalized ?? null,
      api: api ?? null,
      modelId,
      stream: stream === true,
      routeCount: Number.isFinite(routeCount) ? routeCount : null,
      credentialRef: credentialRef ?? null
    },
    actualUrl: null,
    httpStatus: null,
    httpStatusText: null,
    requestHeaders: null,
    requestBodyPreview: null,
    responseText: "",
    responseRaw: null,
    truncated: false,
    finishReason: null,
    usage: emptyUsage(),
    usageSource: "none",
    sseEventCount: null,
    sseEventTypes: null,
    layers,
    error: null
  };

  const finish = () => {
    result.finishedAt = Date.now();
    result.latencyMs = result.finishedAt - startedAt;
  };

  /** 统一收尾：判定状态并脱敏。 */
  const settle = () => {
    finish();
    result.requestHeaders = redactHeaders(result.requestHeaders, redactSecret);
    if (typeof result.responseRaw === "string") {
      result.responseRaw = redactText(result.responseRaw, redactSecret);
    }
    if (result.error !== null && typeof result.error.raw === "string") {
      result.error.raw = redactText(result.error.raw, redactSecret);
    }
    if (result.error !== null && typeof result.error.hint === "string") {
      result.error.hint = redactText(result.error.hint, redactSecret);
    }
    result.responseText = redactText(result.responseText, redactSecret);
    // 诊断链的 detail 由宿主生成，其中可能内嵌响应文本（严格校验失败时会回显模型输出），
    // 而模型输出可能回显密钥（网关把 key 写进正文）——必须一并脱敏，
    // 否则脱敏只做了 responseText，layers 里仍留着明文（实测漏点）。
    for (const layer of Object.values(layers)) {
      if (layer && typeof layer.detail === "string") {
        layer.detail = redactText(layer.detail, redactSecret);
      }
    }

    const apiFailed = layers.api.status === "fail";
    const modelFailed = layers.model.status === "fail";
    const strictFailed = layers.strict.status === "fail";
    const tooSlow = result.latencyMs > slowMs;

    if (apiFailed || modelFailed) {
      result.status = "failed";
      result.reasons = [];
    } else if (strictFailed || tooSlow) {
      result.status = "slow";
      if (tooSlow) result.reasons.push("slow-latency");
      if (strictFailed) result.reasons.push("strict-mismatch");
    } else {
      result.status = "healthy";
      result.reasons = [];
    }
    return result;
  };

  /** API 层失败：下游两层保持 skip。 */
  const failApi = (code, { httpStatus = null, raw = null, detail = null } = {}) => {
    const shown = detail ?? describeError(code).title;
    layers.api = {
      status: "fail",
      label: "API 请求",
      detail: shown,
      code
    };
    // detail 同时作为 error.hint：它比通用 hint 更具体（例如点名 apiKeyEnv 引用名）。
    result.error = makeError(code, { httpStatus, raw, detail });
    result.httpStatus = httpStatus ?? result.httpStatus;
    return settle();
  };

  // ---------- 前置校验：不发无效请求（SPEC §8.1） ----------
  if (!SUPPORTED_APIS.has(api)) {
    return failApi("UNSUPPORTED_API", {
      detail: `该路由声明的协议「${String(api)}」不在支持范围（仅三种协议可测）`
    });
  }
  if (baseURLNormalized === null || baseURLNormalized === undefined || baseURLNormalized === "") {
    return failApi("MISSING_BASE_URL", { detail: "该路由未配置 Base URL，请求未发出" });
  }
  if (credentialError !== null && credentialError !== undefined) {
    return failApi(credentialError.code, { detail: credentialError.detail });
  }
  if (typeof apiKey !== "string" || apiKey === "") {
    return failApi("MISSING_CREDENTIAL", {
      detail: credentialRef
        ? `该供应商未配置密钥（${credentialRef}）`
        : "该路由未声明 apiKeyEnv，无法解析密钥"
    });
  }
  // 可发送性校验：不合法就别发——否则 fetch 抛 ByteString TypeError，会被误报成网络错误。
  const keyCheck = normalizeApiKey(apiKey);
  if (!keyCheck.ok) {
    return failApi("INVALID_CREDENTIAL", {
      detail:
        keyCheck.reason === "empty"
          ? credentialRef
            ? `密钥（${credentialRef}）为空`
            : "密钥为空"
          : credentialRef
            ? `密钥（${credentialRef}）含 HTTP 头无法承载的字符，请只粘贴密钥原文`
            : "密钥含 HTTP 头无法承载的字符，请只粘贴密钥原文"
    });
  }
  const usableKey = keyCheck.value;

  // ---------- 构造请求（与预览同源） ----------
  let req;
  try {
    req = buildRequest({ baseURL: baseURLNormalized, api, modelId, stream: stream === true, cfg, apiKey: usableKey, systemPrompt, userPrompt });
  } catch (error) {
    return failApi("MISSING_BASE_URL", { raw: String(error?.message ?? error) });
  }
  result.actualUrl = req.url;
  result.requestHeaders = { ...req.headers };
  result.requestBodyPreview = JSON.stringify(req.body).slice(0, BODY_PREVIEW_LIMIT);

  // ---------- 发送 ----------
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), hardTimeoutMs);
  // 外部中止（重试会话的手动停止，SPEC §18.5 条件 4）：与总超时走**同一条**
  // AbortController 中止路径，故在飞请求会被真实中断，而不是等它自然结束。
  // 已中止的信号必须在挂监听前先检查，否则挂完就永远不会触发。
  if (externalSignal !== undefined && externalSignal !== null) {
    if (externalSignal.aborted === true) controller.abort();
    else externalSignal.addEventListener("abort", () => controller.abort(), { once: true });
  }
  let response;
  try {
    response = await doFetch(req.url, {
      method: req.method,
      headers: req.headers,
      body: JSON.stringify(req.body),
      signal: controller.signal
    });
  } catch (error) {
    clearTimeout(timer);
    const code = classifyNetworkError(error);
    return failApi(code, {
      raw: String(error?.message ?? error),
      detail:
        code === "TIMEOUT"
          ? `请求超过 ${hardTimeoutMs} 毫秒未完成（已中断）`
          : describeError(code).title
    });
  }

  result.httpStatus = response.status;
  result.httpStatusText = response.statusText ?? null;

  if (!response.ok) {
    let raw = null;
    try {
      const read = await readBounded(response, maxResponseBytes);
      if (!read.tooLarge) raw = new TextDecoder("utf-8").decode(read.bytes);
    } catch {
      /* 错误体读不到就算了，状态码本身已足够定位 */
    }
    clearTimeout(timer);
    if (result.requestHeaders) result.requestHeaders = redactHeaders(result.requestHeaders, redactSecret);
    const code = httpCodeOf(response.status);
    return failApi(code, {
      httpStatus: response.status,
      raw,
      detail: `HTTP ${response.status}，未进入模型响应阶段`
    });
  }

  // ---------- 解析 ----------
  try {
    if (stream === true) {
      const acc = {
        text: "",
        usage: emptyUsage(),
        usageSource: "none",
        finishReason: null,
        ttftMs: null,
        terminal: false,
        failed: false,
        failedMessage: null,
        incomplete: false,
        parseErrors: 0,
        sawUsage: false
      };
      const parser = new SseParser();
      const maxBytes = maxResponseBytes;
      const declared = Number(response.headers.get("content-length") ?? NaN);
      if (Number.isFinite(declared) && declared > maxBytes) {
        try {
          await response.body?.cancel();
        } catch {
          /* 尽力而为 */
        }
        clearTimeout(timer);
        return failApi("RESPONSE_TOO_LARGE", {
          httpStatus: response.status,
          detail: `响应体超过 ${maxBytes} 字节上限，已中断`
        });
      }
      const reader = response.body?.getReader();
      let total = 0;
      let tooLarge = false;
      const samples = [];
      if (reader !== undefined) {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          total += value.byteLength;
          if (total > maxBytes) {
            tooLarge = true;
            try {
              await reader.cancel();
            } catch {
              /* 尽力而为 */
            }
            break;
          }
          const events = parser.push(value);
          for (const evt of events) {
            if (samples.length < 60) samples.push({ event: evt.event, data: String(evt.data).slice(0, 200) });
            consumeStreamEvent(api, evt, acc, Date.now(), startedAt);
          }
        }
      }
      if (!tooLarge) {
        const tail = parser.flush();
        for (const evt of tail) {
          if (samples.length < 60) samples.push({ event: evt.event, data: String(evt.data).slice(0, 200) });
          consumeStreamEvent(api, evt, acc, Date.now(), startedAt);
        }
      }
      clearTimeout(timer);

      result.ttftMs = acc.ttftMs;
      result.usage = acc.usage;
      result.usageSource = acc.usageSource;
      result.sseEventCount = parser.count;
      result.sseEventTypes = parser.types.length > 0 ? parser.types : null;
      result.finishReason = acc.finishReason;
      result.responseText = acc.text;
      result.responseRaw = JSON.stringify(samples).slice(0, RAW_LIMIT);
      result.truncated = JSON.stringify(samples).length > RAW_LIMIT;

      if (tooLarge) {
        return failApi("RESPONSE_TOO_LARGE", {
          httpStatus: response.status,
          detail: `响应体超过 ${maxBytes} 字节上限，已中断`
        });
      }

      // anthropic 的 total_tokens 由 input + output 计算
      if (api === "anthropic-messages" && acc.sawUsage) {
        if (result.usage.promptTokens !== null && result.usage.completionTokens !== null) {
          result.usage.totalTokens = result.usage.promptTokens + result.usage.completionTokens;
          result.usage.totalComputed = true;
        }
        result.usageSource = "anthropic-accumulated";
      }

      layers.api = {
        status: "pass",
        label: "API 请求",
        detail: `已收到 HTTP ${response.status}，SSE 事件 ${parser.count} 个`,
        code: null
      };

      if (acc.failed) {
        layers.model = {
          status: "fail",
          label: "模型响应",
          detail: `流式响应报告失败：${acc.failedMessage ?? "未知原因"}`,
          code: "STREAM_PARSE_ERROR"
        };
        result.error = makeError("STREAM_PARSE_ERROR", { httpStatus: response.status, raw: acc.failedMessage });
        return settle();
      }
      if (!acc.terminal) {
        layers.model = {
          status: "fail",
          label: "模型响应",
          detail: "流式结束但未收到协议规定的终止标记，连接疑似被提前关闭",
          code: "STREAM_NO_TERMINAL"
        };
        result.error = makeError("STREAM_NO_TERMINAL", { httpStatus: response.status });
        return settle();
      }
      if (acc.parseErrors > 0 && acc.text === "") {
        layers.model = {
          status: "fail",
          label: "模型响应",
          detail: `有 ${acc.parseErrors} 个流式帧无法解析，且未提取到文本`,
          code: "STREAM_PARSE_ERROR"
        };
        result.error = makeError("STREAM_PARSE_ERROR", { httpStatus: response.status });
        return settle();
      }
      if (acc.text === "") {
        layers.model = {
          status: "fail",
          label: "模型响应",
          detail: "流式结束但未提取到任何文本内容",
          code: "EMPTY_RESPONSE"
        };
        result.error = makeError("EMPTY_RESPONSE", { httpStatus: response.status });
        return settle();
      }
      layers.model = {
        status: "pass",
        label: "模型响应",
        detail: `提取到模型文本（${acc.text.length} 个字符），结束原因 ${acc.finishReason ?? "未知"}`,
        code: null
      };
    } else {
      const read = await readBounded(response, maxResponseBytes);
      clearTimeout(timer);
      if (read.tooLarge) {
        return failApi("RESPONSE_TOO_LARGE", {
          httpStatus: response.status,
          detail: `响应体超过 ${maxResponseBytes} 字节上限，未读取正文`
        });
      }
      const text = new TextDecoder("utf-8").decode(read.bytes);
      result.responseRaw = text.slice(0, RAW_LIMIT);
      result.truncated = text.length > RAW_LIMIT;

      let json;
      try {
        json = JSON.parse(text);
      } catch {
        layers.api = {
          status: "pass",
          label: "API 请求",
          detail: `已收到 HTTP ${response.status}，响应体 ${read.bytes.byteLength} 字节`,
          code: null
        };
        layers.model = {
          status: "fail",
          label: "模型响应",
          detail: "响应体不是合法 JSON，疑似被网关拦截或返回了网页",
          code: "BAD_RESPONSE_JSON"
        };
        result.error = makeError("BAD_RESPONSE_JSON", { httpStatus: response.status, raw: text });
        return settle();
      }

      layers.api = {
        status: "pass",
        label: "API 请求",
        detail: `已收到 HTTP ${response.status}，响应体 ${read.bytes.byteLength} 字节`,
        code: null
      };

      const parsed = parseNonStreamBody(api, json);
      result.responseText = parsed.text;
      result.finishReason = parsed.finishReason;
      result.usage = parsed.usage;
      result.usageSource = parsed.usageSource;

      if (!parsed.fieldOk) {
        layers.model = {
          status: "fail",
          label: "模型响应",
          detail: "响应结构不符合所选协议，未找到预期的文本字段",
          code: "MISSING_RESPONSE_FIELD"
        };
        result.error = makeError("MISSING_RESPONSE_FIELD", { httpStatus: response.status });
        return settle();
      }
      if (parsed.text === "") {
        layers.model = {
          status: "fail",
          label: "模型响应",
          detail: "请求成功但提取到的文本为空",
          code: "EMPTY_RESPONSE"
        };
        result.error = makeError("EMPTY_RESPONSE", { httpStatus: response.status });
        return settle();
      }
      layers.model = {
        status: "pass",
        label: "模型响应",
        detail: `提取到模型文本（${parsed.text.length} 个字符），结束原因 ${parsed.finishReason ?? "未知"}`,
        code: null
      };
    }
  } catch (error) {
    clearTimeout(timer);
    const code = classifyNetworkError(error);
    return failApi(code, { httpStatus: result.httpStatus, raw: String(error?.message ?? error) });
  }

  // ---------- 第三层：严格校验（SPEC §6.4、§9.3） ----------
  const expect = t.expectText;
  if (result.responseText.trim() === expect) {
    layers.strict = {
      status: "pass",
      label: "严格校验",
      detail: `响应文本与期望值「${expect}」完全一致`,
      code: null
    };
  } else {
    layers.strict = {
      status: "fail",
      label: "严格校验",
      detail: `响应文本为「${result.responseText.slice(0, 60)}」，与期望值「${expect}」不完全一致`,
      code: "STRICT_MISMATCH"
    };
    result.error = null; // 严格校验失败是 Slow 不是 Failed，不产生 error 对象
  }

  return settle();
}

/** 请求头脱敏：鉴权头值固定渲染为 ***（SPEC §8.4）。 */
export function redactHeaders(headers, apiKey) {
  if (headers === null || headers === undefined) return headers;
  const out = {};
  for (const [k, v] of Object.entries(headers)) {
    const lower = k.toLowerCase();
    if (lower === "authorization") {
      out[k] = "Bearer ***";
    } else if (lower === "x-api-key") {
      out[k] = "***";
    } else {
      out[k] = typeof apiKey === "string" && apiKey !== "" ? redactText(String(v), apiKey) : v;
    }
  }
  return out;
}
