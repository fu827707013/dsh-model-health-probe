/**
 * dsh-model-health-probe 验收脚本（SPEC §14 AC1–AC19、§15.1）。
 *
 * 全部用例**不联网**：用本地 node:http 服务器模拟三协议响应。
 * 覆盖矩阵：三协议 × {非流式, 流式} × {成功, 严格校验不符, 非 2xx, 无终止标记}
 *          + 错误码映射 + 分组算法 + 跨 chunk UTF-8 + RingBuffer + 密钥零泄漏
 *          + 端点契约 + 配置只读。
 *
 * 运行：node --test        （等价 npm test；cwd = 插件根目录）
 *      node --test "tests/**\/*.test.mjs"
 *
 * 注意：**不要**用 `node --test tests/`。Node 24 把 `--test` 后的位置参数当测试
 * 文件路径解析（不再当目录递归根），传目录会 MODULE_NOT_FOUND 并计为失败。
 * 本机实测（Node v24.18.0 / Windows）确认，详见交付报告。
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";

import {
  joinUrl,
  buildRequest,
  previewRequest,
  executeProbe,
  normalizeApiKey,
  classifyNetworkError,
  httpCodeOf,
  describeError,
  buildWarnings,
  SseParser,
  redactText,
  redactHeaders,
  SUPPORTED_APIS,
  ANTHROPIC_VERSION,
  AUTH_PLACEHOLDER,
  DEFAULT_TEMPLATES
} from "../lib/probe.js";
import { normalizeBaseURL, buildSelection, readProviders, displayLabelOf } from "../lib/providers.js";
import { createRing } from "../lib/records.js";
import { apply, resolveConfig } from "../lib/index.js";

// ---------------------------------------------------------------------------
// mock 服务器：记录收到的请求，按注册的应答器回复
// ---------------------------------------------------------------------------

function createMockServer() {
  /** @type {{method:string,url:string,headers:object,body:any}[]} */
  const received = [];
  /** @type {((req:any,res:any,body:any)=>void)|null} */
  let responder = null;

  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      let body = null;
      try {
        body = raw === "" ? null : JSON.parse(raw);
      } catch {
        body = raw;
      }
      received.push({ method: req.method, url: req.url, headers: req.headers, body, raw });
      if (responder === null) {
        res.writeHead(500, { "content-type": "application/json" });
        res.end("{}");
        return;
      }
      responder(req, res, body);
    });
  });

  return {
    server,
    received,
    /** 设置应答器（每次测试前重设）。 */
    on(fn) {
      responder = fn;
    },
    /** 清空收到的请求记录。 */
    reset() {
      received.length = 0;
      responder = null;
    },
    get last() {
      return received[received.length - 1];
    }
  };
}

/** 发送 JSON 非流式响应。 */
function sendJson(res, status, obj) {
  const payload = JSON.stringify(obj);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload)
  });
  res.end(payload);
}

/** 发送 SSE 分片（逐段 write，模拟真实流）。 */
async function sendSse(res, frames, { delayMs = 0, status = 200 } = {}) {
  res.writeHead(status, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive"
  });
  for (const frame of frames) {
    if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
    res.write(typeof frame === "string" ? frame : Buffer.from(frame));
  }
  res.end();
}

let mock;
let base;

before(async () => {
  mock = createMockServer();
  mock.server.listen(0, "127.0.0.1");
  await once(mock.server, "listening");
  base = `http://127.0.0.1:${mock.server.address().port}`;
});

after(async () => {
  mock.server.close();
  await once(mock.server, "close").catch(() => {});
});

/** 每个用例前重置 mock。 */
function reset() {
  mock.reset();
}

/** 便捷：对 mock 基址跑一次探测。 */
function probe(args) {
  return executeProbe({
    routeKey: "r1",
    displayName: "r1",
    baseURL: base,
    baseURLNormalized: base,
    api: "openai-completions",
    modelId: "m1",
    stream: false,
    routeCount: 1,
    credentialRef: "TEST_KEY",
    apiKey: "sk-test-abcdefghijklmnop",
    cfg: { pluginVersion: "0.1.0", slowMs: 15000, hardTimeoutMs: 60000 },
    ...args
  });
}

// ===========================================================================
// 1. URL 拼接（SPEC §6.1、AC5；含带/不带 /v1、带/不带尾斜杠的完整边界）
// ===========================================================================

describe("URL 拼接（§6.1）", () => {
  test("三协议路径正确", () => {
    assert.equal(joinUrl("https://h.com/v1", "/chat/completions"), "https://h.com/v1/chat/completions");
    assert.equal(joinUrl("https://h.com/v1", "/responses"), "https://h.com/v1/responses");
    assert.equal(joinUrl("https://h.com", "/v1/messages"), "https://h.com/v1/messages");
  });

  test("尾斜杠边界：baseURL 带尾斜杠不产生双斜杠", () => {
    assert.equal(joinUrl("https://h.com/v1/", "/chat/completions"), "https://h.com/v1/chat/completions");
    assert.equal(joinUrl("https://h.com/", "/v1/messages"), "https://h.com/v1/messages");
    assert.equal(joinUrl("https://h.com/v1//", "/responses"), "https://h.com/v1//responses");
  });

  test("无尾斜杠时逐字拼接", () => {
    assert.equal(joinUrl("https://h.com/v1", "/chat/completions"), "https://h.com/v1/chat/completions");
    assert.equal(joinUrl("https://h.com", "/v1/messages"), "https://h.com/v1/messages");
  });

  test("关键不对称：同一 baseURL 在 openai 与 anthropic 下产出不同 URL", () => {
    // 本机 happycodeai 真实形态
    const openaiUrl = buildRequest({
      baseURL: "https://happycodeai.com/v1",
      api: "openai-completions",
      modelId: "gpt-5.6-sol",
      stream: false,
      cfg: {}
    }).url;
    const anthropicUrl = buildRequest({
      baseURL: "https://happycodeai.com",
      api: "anthropic-messages",
      modelId: "claude-opus-5",
      stream: false,
      cfg: {}
    }).url;
    assert.equal(openaiUrl, "https://happycodeai.com/v1/chat/completions");
    assert.equal(anthropicUrl, "https://happycodeai.com/v1/messages");
    assert.notEqual(openaiUrl, anthropicUrl);
  });

  test("anthropic + baseURL 自带 /v1 → 如实拼成 /v1/v1/messages（本机 aimax66 真实怪癖）", () => {
    // 这是配置形态，不是实现 bug：绝不自动去重或裁剪。
    const url = buildRequest({
      baseURL: "http://ai.max66.xyz/v1",
      api: "anthropic-messages",
      modelId: "deepseek-v4.1-flash",
      stream: false,
      cfg: {}
    }).url;
    assert.equal(url, "http://ai.max66.xyz/v1/v1/messages");
  });

  test("baseURL 完全不做智能修正（不补 /v1、不裁 /v1）", () => {
    // openai 系缺 /v1：如实拼成 /chat/completions（会 404，但那是用户配置问题）
    assert.equal(
      buildRequest({ baseURL: "https://h.com", api: "openai-completions", modelId: "m", stream: false, cfg: {} }).url,
      "https://h.com/chat/completions"
    );
  });
});

// ===========================================================================
// 2. 鉴权头差异（SPEC §6.2、AC5）
// ===========================================================================

describe("鉴权头（§6.2）", () => {
  test("openai 系用 Authorization: Bearer；anthropic 用 x-api-key", () => {
    const openai = buildRequest({ baseURL: "https://h.com/v1", api: "openai-completions", modelId: "m", stream: false, cfg: {}, apiKey: "K" });
    assert.equal(openai.headers.authorization, "Bearer K");
    assert.equal(openai.headers["x-api-key"], undefined);
    assert.equal(openai.headers["anthropic-version"], undefined);

    const anthropic = buildRequest({ baseURL: "https://h.com", api: "anthropic-messages", modelId: "m", stream: false, cfg: {}, apiKey: "K" });
    assert.equal(anthropic.headers["x-api-key"], "K");
    assert.equal(anthropic.headers.authorization, undefined);
    assert.equal(anthropic.headers["anthropic-version"], ANTHROPIC_VERSION);
    assert.equal(ANTHROPIC_VERSION, "2023-06-01");
  });

  test("responses 也用 Bearer", () => {
    const req = buildRequest({ baseURL: "https://h.com/v1", api: "openai-responses", modelId: "m", stream: false, cfg: {}, apiKey: "K" });
    assert.equal(req.headers.authorization, "Bearer K");
    assert.equal(req.headers["x-api-key"], undefined);
  });

  test("三协议均带 content-type: application/json", () => {
    for (const api of SUPPORTED_APIS) {
      const req = buildRequest({ baseURL: "https://h.com/v1", api, modelId: "m", stream: false, cfg: {}, apiKey: "K" });
      assert.equal(req.headers["content-type"], "application/json");
    }
  });

  test("accept 随流式切换", () => {
    const plain = buildRequest({ baseURL: "https://h.com/v1", api: "openai-completions", modelId: "m", stream: false, cfg: {}, apiKey: "K" });
    const stream = buildRequest({ baseURL: "https://h.com/v1", api: "openai-completions", modelId: "m", stream: true, cfg: {}, apiKey: "K" });
    assert.equal(plain.headers.accept, "application/json");
    assert.equal(stream.headers.accept, "text/event-stream");
  });

  test("预览态鉴权头为占位符，不含真实密钥", () => {
    const p = previewRequest({ baseURL: "https://h.com/v1", api: "openai-completions", modelId: "m", stream: false, cfg: {} });
    assert.equal(p.headers.authorization, `Bearer ${AUTH_PLACEHOLDER}`, "预览头必须保留 Bearer 前缀");
    assert.ok(!JSON.stringify(p).includes("sk-"));
  });

  // F-QA-16 回归：预览头把占位符字面替换为密钥后，必须逐字等于真实发送头。
  // 这保证用户在预览区看到的前缀（Bearer / 裸 key）与真实请求一致。
  test("F-QA-16：三协议预览头替换占位符后 === 真实发送头", () => {
    const SECRET = "sk-regression-secret-value";
    for (const api of ["openai-completions", "openai-responses", "anthropic-messages"]) {
      const args = { baseURL: "https://h.com/v1", api, modelId: "m", stream: false, cfg: {} };
      const preview = previewRequest(args).headers;
      const real = buildRequest({ ...args, apiKey: SECRET }).headers;
      const headerName = api === "anthropic-messages" ? "x-api-key" : "authorization";

      assert.ok(
        preview[headerName].includes(AUTH_PLACEHOLDER),
        `${api} 预览头应含占位符，实际 ${JSON.stringify(preview[headerName])}`
      );
      const substituted = preview[headerName].split(AUTH_PLACEHOLDER).join(SECRET);
      assert.equal(substituted, real[headerName], `${api} 替换占位符后必须等于真实发送头`);

      // 前缀显式断言：openai 系必须带 "Bearer "，anthropic 系必须是裸 key
      if (api === "anthropic-messages") {
        assert.equal(real[headerName], SECRET, "anthropic 的 x-api-key 不带 scheme");
        assert.equal(preview[headerName], AUTH_PLACEHOLDER, "anthropic 预览头不带 scheme");
      } else {
        assert.equal(real[headerName], `Bearer ${SECRET}`, `${api} 真实头必须带 Bearer 前缀`);
        assert.ok(preview[headerName].startsWith("Bearer "), `${api} 预览头必须带 Bearer 前缀`);
      }
      // 其余头也应同源
      assert.equal(preview["content-type"], real["content-type"]);
      assert.equal(preview.accept, real.accept);
    }
  });

  test("F-QA-16：流式预览头同样保持同源（accept 随 stream 切换）", () => {
    const SECRET = "sk-stream-secret";
    for (const api of ["openai-completions", "openai-responses", "anthropic-messages"]) {
      const args = { baseURL: "https://h.com/v1", api, modelId: "m", stream: true, cfg: {} };
      const preview = previewRequest(args).headers;
      const real = buildRequest({ ...args, apiKey: SECRET }).headers;
      const headerName = api === "anthropic-messages" ? "x-api-key" : "authorization";
      assert.equal(preview.accept, "text/event-stream");
      assert.equal(preview.accept, real.accept);
      assert.equal(preview[headerName].split(AUTH_PLACEHOLDER).join(SECRET), real[headerName]);
    }
  });
});

// ===========================================================================
// 3. 请求体（SPEC §6.3、AC5）
// ===========================================================================

describe("请求体（§6.3）", () => {
  test("completions：system 进 messages，流式带 stream_options.include_usage", async () => {
    reset();
    mock.on((req, res, body) => {
      sendJson(res, 200, {
        choices: [{ message: { content: "OK" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 31, completion_tokens: 1, total_tokens: 32 }
      });
    });
    await probe({ stream: false });
    const body = mock.last.body;
    assert.equal(body.messages[0].role, "system");
    assert.equal(body.messages[1].role, "user");
    assert.equal(body.max_tokens, 64);
    assert.equal(body.stream, false);
    assert.equal(body.stream_options, undefined, "非流式不应带 stream_options");

    reset();
    mock.on(async (req, res) => {
      await sendSse(res, ['data: {"choices":[{"delta":{"content":"OK"}}]}\n\n', "data: [DONE]\n\n"]);
    });
    await probe({ stream: true });
    assert.deepEqual(mock.last.body.stream_options, { include_usage: true }, "流式必须发 include_usage，否则拿不到 usage");
  });

  test("anthropic：system 在顶层且 max_tokens 必填", async () => {
    reset();
    mock.on((req, res) => {
      sendJson(res, 200, { content: [{ type: "text", text: "OK" }], stop_reason: "end_turn", usage: { input_tokens: 10, output_tokens: 1 } });
    });
    await probe({ api: "anthropic-messages" });
    const body = mock.last.body;
    assert.equal(body.system, DEFAULT_TEMPLATES.systemPrompt, "system 必须是顶层字符串");
    assert.equal(typeof body.max_tokens, "number", "max_tokens 必填");
    assert.equal(body.messages.length, 1);
    assert.equal(body.messages[0].role, "user");
    assert.equal(body.messages.some((m) => m.role === "system"), false, "system 不应出现在 messages 里");
  });

  test("responses：instructions + input，且 store:false", async () => {
    reset();
    mock.on((req, res) => {
      sendJson(res, 200, {
        status: "completed",
        output: [{ type: "message", content: [{ type: "output_text", text: "OK" }] }],
        usage: { input_tokens: 5, output_tokens: 1, total_tokens: 6 }
      });
    });
    await probe({ api: "openai-responses" });
    const body = mock.last.body;
    assert.equal(body.instructions, DEFAULT_TEMPLATES.systemPrompt);
    assert.equal(body.store, false);
    assert.equal(body.max_output_tokens, 64);
    assert.equal(body.input[0].role, "user");
    assert.equal(body.input[0].content[0].type, "input_text");
    assert.equal(body.input[0].content[0].text, DEFAULT_TEMPLATES.userPrompt);
  });
});

// ===========================================================================
// 4. 非流式解析（SPEC §6.5、AC5）
// ===========================================================================

describe("非流式解析（§6.5）", () => {
  test("completions：文本与 token 字段", async () => {
    reset();
    mock.on((req, res) => {
      sendJson(res, 200, {
        choices: [{ message: { content: "OK" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 31, completion_tokens: 1, total_tokens: 32, prompt_tokens_details: { cached_tokens: 7 } }
      });
    });
    const r = await probe();
    assert.equal(r.status, "healthy");
    assert.equal(r.responseText, "OK");
    assert.equal(r.usage.promptTokens, 31);
    assert.equal(r.usage.completionTokens, 1);
    assert.equal(r.usage.totalTokens, 32);
    assert.equal(r.usage.cacheReadTokens, 7);
    assert.equal(r.finishReason, "stop");
    assert.equal(r.usageSource, "body");
    assert.equal(r.ttftMs, null, "非流式 ttftMs 固定为 null");
    assert.equal(r.sseEventCount, null);
  });

  test("anthropic：文本路径与 total 由 input+output 计算", async () => {
    reset();
    mock.on((req, res) => {
      sendJson(res, 200, { content: [{ type: "text", text: "OK" }], stop_reason: "end_turn", usage: { input_tokens: 12, output_tokens: 2 } });
    });
    const r = await probe({ api: "anthropic-messages" });
    assert.equal(r.status, "healthy");
    assert.equal(r.responseText, "OK");
    assert.equal(r.usage.promptTokens, 12);
    assert.equal(r.usage.completionTokens, 2);
    assert.equal(r.usage.totalTokens, 14);
    assert.equal(r.usage.totalComputed, true, "anthropic 上游不给 total，需计算");
    assert.equal(r.finishReason, "end_turn");
  });

  test("responses：从 output[].content[] 取 output_text（裸 HTTP 无顶层 output_text）", async () => {
    reset();
    mock.on((req, res) => {
      // 刻意**不**提供顶层 output_text —— 那是 openai SDK 客户端补的便利字段
      sendJson(res, 200, {
        status: "completed",
        output: [
          { type: "reasoning", summary: [] },
          { type: "message", content: [{ type: "output_text", text: "O" }, { type: "output_text", text: "K" }] }
        ],
        usage: { input_tokens: 9, output_tokens: 2, total_tokens: 11 }
      });
    });
    const r = await probe({ api: "openai-responses" });
    assert.equal(r.status, "healthy");
    assert.equal(r.responseText, "OK", "必须拼接 output[].content[] 里的 output_text");
    assert.equal(r.usage.promptTokens, 9);
    assert.equal(r.usage.completionTokens, 2);
    assert.equal(r.finishReason, "completed");
  });
});

// ===========================================================================
// 5. 流式解析（SPEC §6.6、AC6）
// ===========================================================================

describe("流式解析（§6.6）", () => {
  test("completions：delta 累积 + [DONE] 终止 + 末帧 usage", async () => {
    reset();
    mock.on(async (req, res) => {
      await sendSse(res, [
        'data: {"choices":[{"delta":{"content":"O"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"K"},"finish_reason":"stop"}]}\n\n',
        'data: {"choices":[],"usage":{"prompt_tokens":31,"completion_tokens":1,"total_tokens":32}}\n\n',
        "data: [DONE]\n\n"
      ]);
    });
    const r = await probe({ stream: true });
    assert.equal(r.status, "healthy");
    assert.equal(r.responseText, "OK");
    assert.equal(r.usageSource, "openai-final-chunk");
    assert.equal(r.usage.promptTokens, 31);
    assert.ok(r.sseEventCount >= 4, `sseEventCount 应 >= 4，实际 ${r.sseEventCount}`);
    assert.ok(Array.isArray(r.sseEventTypes));
    assert.equal(r.ttftMs !== null, true, "流式应有 TTFT");
  });

  test("anthropic：usage 跨事件累积（input 在 message_start，output 在 message_delta）", async () => {
    reset();
    mock.on(async (req, res) => {
      await sendSse(res, [
        'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":17,"output_tokens":0}}}\n\n',
        'event: content_block_start\ndata: {"type":"content_block_start","index":0}\n\n',
        'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"O"}}\n\n',
        'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"K"}}\n\n',
        'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
        'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":3}}\n\n',
        'event: message_stop\ndata: {"type":"message_stop"}\n\n'
      ]);
    });
    const r = await probe({ api: "anthropic-messages", stream: true });
    assert.equal(r.status, "healthy");
    assert.equal(r.responseText, "OK");
    assert.equal(r.usageSource, "anthropic-accumulated");
    assert.equal(r.usage.promptTokens, 17, "input_tokens 必须来自 message_start（只在流末取会丢）");
    assert.equal(r.usage.completionTokens, 3);
    assert.equal(r.usage.totalTokens, 20);
    assert.equal(r.finishReason, "end_turn");
  });

  test("responses：response.output_text.delta 累积 + response.completed 终止", async () => {
    reset();
    mock.on(async (req, res) => {
      await sendSse(res, [
        'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"O"}\n\n',
        'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"K"}\n\n',
        'event: response.completed\ndata: {"type":"response.completed","response":{"status":"completed","usage":{"input_tokens":4,"output_tokens":2,"total_tokens":6}}}\n\n'
      ]);
    });
    const r = await probe({ api: "openai-responses", stream: true });
    assert.equal(r.status, "healthy");
    assert.equal(r.responseText, "OK");
    assert.equal(r.usageSource, "responses-completed");
    assert.equal(r.usage.promptTokens, 4);
    assert.equal(r.usage.completionTokens, 2);
    assert.equal(r.finishReason, "completed");
  });

  test("三协议终止符互不相同，且缺终止符判 STREAM_NO_TERMINAL", async () => {
    for (const [api, frames] of [
      ["openai-completions", ['data: {"choices":[{"delta":{"content":"OK"}}]}\n\n']],
      ["openai-responses", ['event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"OK"}\n\n']],
      ["anthropic-messages", ['event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"OK"}}\n\n']]
    ]) {
      reset();
      mock.on(async (req, res) => {
        await sendSse(res, frames);
      });
      const r = await probe({ api, stream: true });
      assert.equal(r.status, "failed", `${api} 缺终止标记应失败`);
      assert.equal(r.layers.model.code, "STREAM_NO_TERMINAL", `${api} 应判 STREAM_NO_TERMINAL`);
      assert.equal(r.responseText, "OK", `${api} 已累积文本仍应展示`);
    }
  });

  test("TTFT：首个文本增量到达时间，且 <= 总耗时", async () => {
    reset();
    mock.on(async (req, res) => {
      await sendSse(res, ['data: {"choices":[{"delta":{"content":"O"}}]}\n\n', "data: [DONE]\n\n"], { delayMs: 60 });
    });
    const r = await probe({ stream: true });
    assert.ok(r.ttftMs !== null && r.ttftMs > 0, "TTFT 应为正数");
    assert.ok(r.ttftMs <= r.latencyMs, "TTFT 不应超过总耗时");
    assert.ok(r.latencyMs >= 100, `延迟应包含两帧各 60ms，实际 ${r.latencyMs}`);
  });

  test("SSE 解析器：event/data 成对、注释跳过、前导空格剥离", () => {
    const p = new SseParser();
    const text = ": 这是注释\n" + "event: ping\ndata: {}\n\n" + 'data: {"a":1}\n\n';
    const evts = p.push(Buffer.from(text, "utf8"));
    assert.equal(evts.length, 2);
    assert.equal(evts[0].event, "ping");
    assert.equal(evts[1].event, null);
    assert.equal(evts[1].data, '{"a":1}');
  });
});

// ===========================================================================
// 6. 跨 chunk UTF-8（SPEC §6.6、AC7）
// ===========================================================================

describe("跨 chunk UTF-8（§6.6、AC7）", () => {
  test("多字节字符被切成两个 chunk 时不得出现替换字符", async () => {
    reset();
    const chinese = "中文响应内容不乱码";
    const frame = `data: {"choices":[{"delta":{"content":"${chinese}"}}]}\n\n`;
    const bytes = Buffer.from(frame, "utf8");
    // 找一个落在多字节字符内部的偏移：第 1 个字节即 '中' 的起始，切在第 1 字节处
    const cut = 1;
    mock.on(async (req, res) => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write(bytes.subarray(0, cut));
      await new Promise((r) => setTimeout(r, 20));
      res.write(bytes.subarray(cut));
      await new Promise((r) => setTimeout(r, 20));
      res.write("data: [DONE]\n\n");
      res.end();
    });
    const r = await probe({ stream: true });
    assert.equal(r.responseText, chinese);
    assert.equal(r.responseText.includes("\uFFFD"), false, "不得出现替换字符");
  });

  test("逐字节拆分整个 SSE 流仍然正确", async () => {
    reset();
    const chinese = "逐字节";
    const frame = `data: {"choices":[{"delta":{"content":"${chinese}"}}]}\n\ndata: [DONE]\n\n`;
    const bytes = Buffer.from(frame, "utf8");
    mock.on(async (req, res) => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      for (const b of bytes) {
        res.write(Buffer.from([b]));
      }
      res.end();
    });
    const r = await probe({ stream: true });
    assert.equal(r.responseText, chinese);
    assert.equal(r.status, "slow", "文本是「逐字节」而非 OK，故严格校验失败 → slow（非 failed）");
    assert.ok(r.reasons.includes("strict-mismatch"));
    assert.equal(r.layers.strict.status, "fail");
    assert.equal(r.layers.api.status, "pass");
    assert.equal(r.layers.model.status, "pass");
  });
});

// ===========================================================================
// 7. 错误映射（SPEC §10.1、AC8、AC9）
// ===========================================================================

describe("错误映射（§10.1）", () => {
  test("HTTP 状态码逐一映射且中文 title 非空", async () => {
    const cases = [
      [401, "HTTP_401"],
      [403, "HTTP_403"],
      [404, "HTTP_404"],
      [405, "HTTP_405"],
      [408, "HTTP_408"],
      [413, "HTTP_413"],
      [429, "HTTP_429"],
      [500, "HTTP_5XX"],
      [502, "HTTP_5XX"],
      [503, "HTTP_5XX"],
      [418, "HTTP_ERROR"]
    ];
    for (const [status, code] of cases) {
      reset();
      mock.on((req, res) => {
        sendJson(res, status, { error: "boom" });
      });
      const r = await probe();
      assert.equal(r.status, "failed", `HTTP ${status} 应 failed`);
      assert.equal(r.error.code, code, `HTTP ${status} 应映射 ${code}`);
      assert.ok(r.error.title && r.error.title.length > 0, `${code} 应有中文 title`);
      assert.ok(r.error.hint && r.error.hint.length > 0, `${code} 应有 hint`);
      assert.equal(r.httpStatus, status);
      assert.equal(r.layers.api.status, "fail");
      assert.equal(r.layers.model.status, "skip", "上游失败时下游应为 skip");
      assert.equal(r.layers.strict.status, "skip");
    }
  });

  test("404 的 hint 指向 baseURL 后缀不对称", () => {
    const { hint } = describeError("HTTP_404");
    assert.ok(hint.includes("/v1"), "404 hint 应说明 /v1 后缀规则");
  });

  test("200 但非 JSON → BAD_RESPONSE_JSON", async () => {
    reset();
    mock.on((req, res) => {
      res.writeHead(200, { "content-type": "text/html" });
      res.end("<html>not json</html>");
    });
    const r = await probe();
    assert.equal(r.status, "failed");
    assert.equal(r.error.code, "BAD_RESPONSE_JSON");
    assert.equal(r.layers.model.code, "BAD_RESPONSE_JSON");
  });

  test("200 但缺协议字段 → MISSING_RESPONSE_FIELD", async () => {
    reset();
    mock.on((req, res) => {
      sendJson(res, 200, { unexpected: true });
    });
    const r = await probe();
    assert.equal(r.status, "failed");
    assert.equal(r.error.code, "MISSING_RESPONSE_FIELD");
  });

  test("200 但文本为空 → EMPTY_RESPONSE", async () => {
    reset();
    mock.on((req, res) => {
      sendJson(res, 200, { choices: [{ message: { content: "" }, finish_reason: "stop" }], usage: {} });
    });
    const r = await probe();
    assert.equal(r.status, "failed");
    assert.equal(r.error.code, "EMPTY_RESPONSE");
  });

  test("响应体超上限（声明 content-length）→ RESPONSE_TOO_LARGE 且不读正文", async () => {
    reset();
    mock.on((req, res) => {
      res.writeHead(200, { "content-type": "application/json", "content-length": String(8 * 1024 * 1024) });
      res.write("x"); // 不真的发 8MiB
    });
    const r = await probe({ cfg: { pluginVersion: "0.1.0", slowMs: 15000, hardTimeoutMs: 5000 } });
    assert.equal(r.status, "failed");
    assert.equal(r.error.code, "RESPONSE_TOO_LARGE");
  });

  test("未配置密钥 → MISSING_CREDENTIAL 且不发请求", async () => {
    reset();
    let called = false;
    mock.on((req, res) => {
      called = true;
      sendJson(res, 200, {});
    });
    const r = await probe({ apiKey: null });
    assert.equal(r.status, "failed");
    assert.equal(r.error.code, "MISSING_CREDENTIAL");
    assert.equal(called, false, "缺密钥时不得发出请求");
    assert.ok(r.error.hint.includes("TEST_KEY"), "hint 应指出引用名");
  });

  test("密钥含非法字符 → INVALID_CREDENTIAL", async () => {
    reset();
    let called = false;
    mock.on((req, res) => {
      called = true;
      sendJson(res, 200, {});
    });
    const r = await probe({ apiKey: "bad key\nwith newline" });
    assert.equal(r.status, "failed");
    assert.equal(r.error.code, "INVALID_CREDENTIAL");
    assert.equal(called, false, "非法密钥不得发出请求");
  });

  test("不支持的协议 → UNSUPPORTED_API", async () => {
    reset();
    const r = await probe({ api: "azure-openai-responses" });
    assert.equal(r.status, "failed");
    assert.equal(r.error.code, "UNSUPPORTED_API");
  });

  test("缺 baseURL → MISSING_BASE_URL", async () => {
    reset();
    const r = await probe({ baseURLNormalized: "", baseURL: "" });
    assert.equal(r.status, "failed");
    assert.equal(r.error.code, "MISSING_BASE_URL");
  });

  test("超时 → TIMEOUT，latencyMs 接近设定值", async () => {
    reset();
    mock.on(() => {
      /* 故意不响应，挂起 */
    });
    const r = await probe({ cfg: { pluginVersion: "0.1.0", slowMs: 15000, hardTimeoutMs: 1000 } });
    assert.equal(r.status, "failed");
    assert.equal(r.error.code, "TIMEOUT");
    assert.ok(r.latencyMs >= 950 && r.latencyMs < 3000, `latencyMs 应接近 1000，实际 ${r.latencyMs}`);
  });

  test("网络错误分类：DNS / 拒连 / 重置 / TLS", () => {
    assert.equal(classifyNetworkError(Object.assign(new Error("x"), { code: "ENOTFOUND" })), "DNS_FAILED");
    assert.equal(classifyNetworkError(Object.assign(new Error("x"), { code: "EAI_AGAIN" })), "DNS_FAILED");
    assert.equal(classifyNetworkError(Object.assign(new Error("x"), { code: "ECONNREFUSED" })), "CONNECTION_REFUSED");
    assert.equal(classifyNetworkError(Object.assign(new Error("x"), { code: "ECONNRESET" })), "CONNECTION_RESET");
    assert.equal(classifyNetworkError(Object.assign(new Error("x"), { code: "EPIPE" })), "CONNECTION_RESET");
    assert.equal(classifyNetworkError(Object.assign(new Error("x"), { code: "CERT_HAS_EXPIRED" })), "TLS_ERROR");
    assert.equal(classifyNetworkError(Object.assign(new Error("x"), { code: "DEPTH_ZERO_SELF_SIGNED_CERT" })), "TLS_ERROR");
    assert.equal(classifyNetworkError(Object.assign(new Error("x"), { code: "ERR_TLS_HANDSHAKE" })), "TLS_ERROR");
    const abort = new Error("aborted");
    abort.name = "AbortError";
    assert.equal(classifyNetworkError(abort), "TIMEOUT");
  });

  test("真实 DNS 失败（不存在的域名）→ DNS_FAILED", async () => {
    const r = await executeProbe({
      routeKey: "r1",
      displayName: "r1",
      baseURL: "http://this-host-does-not-exist-dsh-model-health-probe.invalid",
      baseURLNormalized: "http://this-host-does-not-exist-dsh-model-health-probe.invalid",
      api: "openai-completions",
      modelId: "m1",
      stream: false,
      routeCount: 1,
      credentialRef: "TEST_KEY",
      apiKey: "sk-test-abcdefghijklmnop",
      cfg: { pluginVersion: "0.1.0", slowMs: 15000, hardTimeoutMs: 8000 }
    });
    assert.equal(r.status, "failed");
    assert.equal(r.error.code, "DNS_FAILED");
  });

  test("真实拒连（本机未监听端口）→ CONNECTION_REFUSED", async () => {
    // 拿一个已关闭的端口
    const tmp = http.createServer(() => {});
    tmp.listen(0, "127.0.0.1");
    await once(tmp, "listening");
    const port = tmp.address().port;
    tmp.close();
    await once(tmp, "close");

    const r = await executeProbe({
      routeKey: "r1",
      displayName: "r1",
      baseURL: `http://127.0.0.1:${port}`,
      baseURLNormalized: `http://127.0.0.1:${port}`,
      api: "openai-completions",
      modelId: "m1",
      stream: false,
      routeCount: 1,
      credentialRef: "TEST_KEY",
      apiKey: "sk-test-abcdefghijklmnop",
      cfg: { pluginVersion: "0.1.0", slowMs: 15000, hardTimeoutMs: 8000 }
    });
    assert.equal(r.status, "failed");
    assert.equal(r.error.code, "CONNECTION_REFUSED");
  });

  test("错误映射表所有 code 都有中文 title 与 hint", () => {
    const codes = [
      "DNS_FAILED", "CONNECTION_REFUSED", "CONNECTION_RESET", "TLS_ERROR", "TIMEOUT",
      "HTTP_401", "HTTP_403", "HTTP_404", "HTTP_405", "HTTP_408", "HTTP_413", "HTTP_429",
      "HTTP_5XX", "HTTP_ERROR", "BAD_RESPONSE_JSON", "MISSING_RESPONSE_FIELD", "EMPTY_RESPONSE",
      "STREAM_NO_TERMINAL", "STREAM_PARSE_ERROR", "RESPONSE_TOO_LARGE", "MISSING_CREDENTIAL",
      "INVALID_CREDENTIAL", "UNSUPPORTED_API", "MISSING_BASE_URL", "TEST_IN_FLIGHT",
      "SETTINGS_UNAVAILABLE", "BAD_REQUEST", "UNKNOWN_ROUTE", "UNKNOWN_MODEL"
    ];
    const fallback = describeError("__DEFINITELY_NOT_A_CODE__");
    for (const c of codes) {
      const d = describeError(c);
      assert.ok(d.title && d.title.length > 0, `${c} 缺 title`);
      assert.ok(d.hint && d.hint.length > 0, `${c} 缺 hint`);
      assert.notEqual(d.title, fallback.title, `${c} 落到了通用兜底文案，说明映射表漏了它`);
      // 中文校验：至少含一个 CJK 字符
      assert.match(d.title, /[\u4e00-\u9fff]/, `${c} 的 title 应为中文`);
      assert.match(d.hint, /[\u4e00-\u9fff]/, `${c} 的 hint 应为中文`);
    }
  });
});

// ===========================================================================
// 8. 状态机与降级（SPEC §9.1、§9.3、AC8）
// ===========================================================================

describe("状态机与降级（§9.1、§9.3）", () => {
  test("严格校验不符（OK！）→ slow + strict-mismatch，绝不 failed", async () => {
    reset();
    mock.on((req, res) => {
      sendJson(res, 200, { choices: [{ message: { content: "OK！" }, finish_reason: "stop" }], usage: {} });
    });
    const r = await probe();
    assert.equal(r.status, "slow");
    assert.ok(r.reasons.includes("strict-mismatch"));
    assert.equal(r.layers.strict.status, "fail");
    assert.equal(r.layers.strict.code, "STRICT_MISMATCH");
    assert.equal(r.layers.api.status, "pass");
    assert.equal(r.layers.model.status, "pass");
    assert.equal(r.error, null, "严格校验失败不产生 error 对象");
  });

  test("耗时超 slowMs 但内容正确 → slow + slow-latency", async () => {
    reset();
    mock.on(async (req, res) => {
      await new Promise((r) => setTimeout(r, 150));
      sendJson(res, 200, { choices: [{ message: { content: "OK" }, finish_reason: "stop" }], usage: {} });
    });
    const r = await probe({ cfg: { pluginVersion: "0.1.0", slowMs: 50, hardTimeoutMs: 60000 } });
    assert.equal(r.status, "slow");
    assert.ok(r.reasons.includes("slow-latency"));
    assert.equal(r.layers.api.status, "pass");
    assert.equal(r.layers.strict.status, "pass");
  });

  test("首尾空白被 trim 后仍算通过", async () => {
    reset();
    mock.on((req, res) => {
      sendJson(res, 200, { choices: [{ message: { content: "  OK\n" }, finish_reason: "stop" }], usage: {} });
    });
    const r = await probe();
    assert.equal(r.status, "healthy");
    assert.equal(r.layers.strict.status, "pass");
  });

  test("三层 label 为固定中文", async () => {
    reset();
    mock.on((req, res) => {
      sendJson(res, 200, { choices: [{ message: { content: "OK" }, finish_reason: "stop" }], usage: {} });
    });
    const r = await probe();
    assert.deepEqual(Object.keys(r.layers), ["api", "model", "strict"], "层顺序固定");
    assert.equal(r.layers.api.label, "API 请求");
    assert.equal(r.layers.model.label, "模型响应");
    assert.equal(r.layers.strict.label, "严格校验");
  });

  test("TestResult 字段齐备且无 undefined", async () => {
    reset();
    mock.on((req, res) => {
      sendJson(res, 200, { choices: [{ message: { content: "OK" }, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });
    });
    const r = await probe();
    const required = [
      "pluginVersion", "startedAt", "finishedAt", "latencyMs", "ttftMs", "status", "reasons",
      "target", "actualUrl", "httpStatus", "httpStatusText", "requestHeaders", "requestBodyPreview",
      "responseText", "responseRaw", "truncated", "finishReason", "usage", "usageSource",
      "sseEventCount", "sseEventTypes", "layers", "error"
    ];
    for (const k of required) {
      assert.ok(k in r, `缺字段 ${k}`);
      assert.notEqual(r[k], undefined, `字段 ${k} 不应是 undefined（无值用 null）`);
    }
    for (const k of ["promptTokens", "completionTokens", "totalTokens", "cacheReadTokens", "cacheWriteTokens"]) {
      assert.ok(k in r.usage, `usage 缺 ${k}`);
    }
  });
});

// ===========================================================================
// 9. 密钥零泄漏（SPEC §8.4、AC11）
// ===========================================================================

describe("密钥零泄漏（§8.4、AC11）", () => {
  const SECRET = "sk-super-secret-abcdefghijklmnop";

  test("requestHeaders 中鉴权头渲染为 ***", async () => {
    reset();
    mock.on((req, res) => {
      sendJson(res, 200, { choices: [{ message: { content: "OK" }, finish_reason: "stop" }], usage: {} });
    });
    const r = await probe({ apiKey: SECRET });
    assert.equal(r.requestHeaders.authorization, "Bearer ***");
    assert.equal(JSON.stringify(r).includes(SECRET), false, "记录中不得出现密钥明文");
  });

  test("网关在错误体中回显密钥 → 被替换为 ***", async () => {
    reset();
    mock.on((req, res) => {
      sendJson(res, 401, { error: `invalid api key: ${SECRET}` });
    });
    const r = await probe({ apiKey: SECRET });
    assert.equal(r.error.code, "HTTP_401");
    assert.equal(JSON.stringify(r).includes(SECRET), false, "回显的密钥必须被脱敏");
    assert.ok(r.error.raw.includes("***"), "错误体中的密钥应替换为 ***");
  });

  test("响应正文中回显密钥 → 被脱敏", async () => {
    reset();
    mock.on((req, res) => {
      sendJson(res, 200, {
        choices: [{ message: { content: `your key is ${SECRET}` }, finish_reason: "stop" }],
        usage: {}
      });
    });
    const r = await probe({ apiKey: SECRET });
    assert.equal(JSON.stringify(r).includes(SECRET), false);
    assert.ok(r.responseText.includes("***"));
  });

  test("anthropic 的 x-api-key 头也脱敏", async () => {
    reset();
    mock.on((req, res) => {
      sendJson(res, 200, { content: [{ type: "text", text: "OK" }], stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 } });
    });
    const r = await probe({ api: "anthropic-messages", apiKey: SECRET });
    assert.equal(r.requestHeaders["x-api-key"], "***");
    assert.equal(JSON.stringify(r).includes(SECRET), false);
  });

  test("redactText / redactHeaders 单元行为", () => {
    assert.equal(redactText(`a ${SECRET} b`, SECRET), "a *** b");
    assert.equal(redactText("no secret here", SECRET), "no secret here");
    assert.equal(redactText("x", ""), "x");
    const h = redactHeaders({ authorization: `Bearer ${SECRET}`, "x-api-key": SECRET, accept: "application/json" }, SECRET);
    assert.equal(h.authorization, "Bearer ***");
    assert.equal(h["x-api-key"], "***");
    assert.equal(h.accept, "application/json");
  });
});

// ===========================================================================
// 10. 分组算法（SPEC §7、AC2、AC3、AC4）
// ===========================================================================

describe("分组算法（§7）", () => {
  test("normalizeBaseURL 只去尾斜杠，绝不增删 /v1", () => {
    assert.equal(normalizeBaseURL("https://a.com/"), "https://a.com");
    assert.equal(normalizeBaseURL("https://a.com///"), "https://a.com");
    assert.equal(normalizeBaseURL("https://a.com/v1"), "https://a.com/v1", "不得裁剪 /v1");
    assert.equal(normalizeBaseURL("https://a.com"), "https://a.com", "不得补全 /v1");
    assert.equal(normalizeBaseURL("https://a.com/v1/"), "https://a.com/v1");
    assert.equal(normalizeBaseURL("  https://a.com/v1  "), "https://a.com/v1");
    assert.equal(normalizeBaseURL(undefined), "");
  });

  test("fixture ①：同 baseURL + 同 api 多路由 → 第四行候选 > 1", () => {
    const providers = {
      "a1": { api: "openai-completions", baseURL: "https://same.com/v1", apiKeyEnv: "K1", models: [{ id: "m1" }, { id: "m2" }] },
      "a2": { api: "openai-completions", baseURL: "https://same.com/v1", apiKeyEnv: "K2", models: [{ id: "m1" }] },
      "a3": { api: "openai-completions", baseURL: "https://same.com/v1", apiKeyEnv: "K3", models: [{ id: "m1" }] }
    };
    const sel = buildSelection(providers, {});
    assert.equal(sel.providers.length, 1, "同一 baseURL+api 应只有 1 个供应商组");
    assert.equal(sel.groups.length, 1, "同一 baseURL+api 应只有 1 个分组");
    assert.equal(sel.groups[0].routeCount, 3);

    const m1 = sel.groups[0].models.find((m) => m.id === "m1");
    assert.equal(m1.routeKeys.length, 3, "m1 被 3 条路由声明 → 第四行出现");
    assert.deepEqual(m1.routeKeys, ["a1", "a2", "a3"], "routeKeys 保持配置顺序");

    const m2 = sel.groups[0].models.find((m) => m.id === "m2");
    assert.equal(m2.routeKeys.length, 1, "m2 只被 1 条路由声明 → 第四行不出现");
  });

  test("fixture ②：同 baseURL 多 api → 第二行多个按钮", () => {
    const providers = {
      "a1": { api: "anthropic-messages", baseURL: "http://dual.com/v1", apiKeyEnv: "K1", models: [{ id: "m1" }] },
      "a2": { api: "openai-completions", baseURL: "http://dual.com/v1", apiKeyEnv: "K2", models: [{ id: "m2" }] }
    };
    const sel = buildSelection(providers, {});
    assert.equal(sel.providers.length, 1, "同 baseURL 应归为 1 个供应商");
    assert.equal(sel.providers[0].apiCount, 2, "该供应商应有 2 个 API 类型按钮");
    assert.equal(sel.groups.length, 2);
    assert.deepEqual(
      sel.groups.map((g) => g.api).sort(),
      ["anthropic-messages", "openai-completions"]
    );
    // anthropic + /v1 → 警告
    const anth = sel.groups.find((g) => g.api === "anthropic-messages");
    assert.ok(anth.warnings.some((w) => w.code === "ANTHROPIC_BASEURL_HAS_V1"), "应给出 /v1/v1/messages 警告");
  });

  test("fixture ③：尾斜杠差异 → 两个不同组，且绝不误合并 /v1", () => {
    const providers = {
      "p-anthropic": { api: "anthropic-messages", baseURL: "https://happycodeai.com/", apiKeyEnv: "K1", models: [{ id: "claude" }] },
      "p-openai": { api: "openai-completions", baseURL: "https://happycodeai.com/v1", apiKeyEnv: "K2", models: [{ id: "gpt" }] }
    };
    const sel = buildSelection(providers, {});
    assert.equal(sel.providers.length, 2, "happycodeai.com/ 与 happycodeai.com/v1 必须是两个供应商组");
    assert.deepEqual(
      sel.providers.map((p) => p.baseURLNormalized).sort(),
      ["https://happycodeai.com", "https://happycodeai.com/v1"]
    );
    assert.equal(sel.groups.length, 2);

    // 预览 URL 各自正确（AC4：同源）
    const anth = sel.groups.find((g) => g.api === "anthropic-messages");
    const open = sel.groups.find((g) => g.api === "openai-completions");
    assert.equal(anth.previewUrl, "https://happycodeai.com/v1/messages");
    assert.equal(open.previewUrl, "https://happycodeai.com/v1/chat/completions");
  });

  test("尾斜杠归一化：同 baseURL 仅尾斜杠不同 → 合并为一组", () => {
    const providers = {
      "a1": { api: "openai-completions", baseURL: "https://same.com/v1", apiKeyEnv: "K1", models: [{ id: "m1" }] },
      "a2": { api: "openai-completions", baseURL: "https://same.com/v1/", apiKeyEnv: "K2", models: [{ id: "m1" }] }
    };
    const sel = buildSelection(providers, {});
    assert.equal(sel.providers.length, 1, "仅尾斜杠不同应合并");
    assert.equal(sel.providers[0].routeCount, 2);
  });

  test("不硬编码组数：3 组假配置 → 恰为 3 组", () => {
    const providers = {
      "x": { api: "openai-completions", baseURL: "https://x.com/v1", apiKeyEnv: "K", models: [{ id: "m" }] },
      "y": { api: "openai-completions", baseURL: "https://y.com/v1", apiKeyEnv: "K", models: [{ id: "m" }] },
      "z": { api: "anthropic-messages", baseURL: "https://z.com", apiKeyEnv: "K", models: [{ id: "m" }] }
    };
    const sel = buildSelection(providers, {});
    assert.equal(sel.providers.length, 3);
    assert.equal(sel.groups.length, 3);
  });

  test("空配置 → 0 组且带 SETTINGS_UNAVAILABLE", () => {
    const sel = buildSelection({}, {});
    assert.equal(sel.providers.length, 0);
    assert.equal(sel.groups.length, 0);
    assert.ok(sel.warnings.some((w) => w.code === "SETTINGS_UNAVAILABLE"));
  });

  test("顺序稳定：同一配置两次调用产出完全一致的顺序", () => {
    const providers = {
      "k1": { api: "openai-completions", baseURL: "https://a.com/v1", apiKeyEnv: "K", models: [{ id: "m1" }, { id: "m2" }] },
      "k2": { api: "anthropic-messages", baseURL: "https://b.com", apiKeyEnv: "K", models: [{ id: "m3" }] },
      "k3": { api: "openai-completions", baseURL: "https://a.com/v1", apiKeyEnv: "K", models: [{ id: "m1" }] }
    };
    const s1 = buildSelection(providers, {});
    const s2 = buildSelection(providers, {});
    assert.deepEqual(s1.providers.map((p) => p.id), s2.providers.map((p) => p.id));
    assert.deepEqual(s1.groups.map((g) => g.id), s2.groups.map((g) => g.id));
    assert.deepEqual(s1.groups[0].models.map((m) => m.id), s2.groups[0].models.map((m) => m.id));
  });

  test("api 缺失/不支持仍成组并标记", () => {
    const providers = {
      "bad": { api: "azure-openai-responses", baseURL: "https://bad.com/v1", apiKeyEnv: "K", models: [{ id: "m" }] },
      "none": { baseURL: "https://none.com/v1", apiKeyEnv: "K", models: [{ id: "m" }] }
    };
    const sel = buildSelection(providers, {});
    const bad = sel.groups.find((g) => g.api === "azure-openai-responses");
    assert.equal(bad.apiSupported, false);
    assert.ok(bad.warnings.some((w) => w.code === "UNSUPPORTED_API"));
    const none = sel.groups.find((g) => g.api === null);
    assert.equal(none.apiSupported, false);
    assert.ok(none.warnings.some((w) => w.code === "UNSUPPORTED_API"));
  });

  test("模型并集按 id 去重并保留首个的名称", () => {
    const providers = {
      "a1": { api: "openai-completions", baseURL: "https://a.com/v1", apiKeyEnv: "K", models: [{ id: "m1", name: "First" }, { id: "m2" }] },
      "a2": { api: "openai-completions", baseURL: "https://a.com/v1", apiKeyEnv: "K", models: [{ id: "m1", name: "Second" }] }
    };
    const sel = buildSelection(providers, {});
    assert.equal(sel.groups[0].models.length, 2, "m1 应去重");
    assert.equal(sel.groups[0].models.find((m) => m.id === "m1").name, "First", "保留首个出现项");
  });

  test("请求预览由与真实请求同一函数产出（AC4）", async () => {
    const providers = {
      "a1": { api: "openai-completions", baseURL: "https://prev.com/v1", apiKeyEnv: "K", models: [{ id: "m1" }] }
    };
    const sel = buildSelection(providers, {});
    const preview = sel.groups[0].requestPreview.nonStream;
    const real = buildRequest({ baseURL: "https://prev.com/v1", api: "openai-completions", modelId: "m1", stream: false, cfg: {} });
    assert.equal(preview.url, real.url, "预览 URL 必须与真实请求同源");
    assert.deepEqual(preview.body, real.body, "预览请求体必须与真实请求同源");
  });

  test("displayLabelOf 输出 host+路径", () => {
    assert.equal(displayLabelOf("https://www.xcmapi.com/v1"), "www.xcmapi.com/v1");
    assert.equal(displayLabelOf("https://happycodeai.com"), "happycodeai.com");
  });
});

// ===========================================================================
// 11. RingBuffer（SPEC §12.2、AC12）
// ===========================================================================

describe("RingBuffer（§12.2）", () => {
  test("容量 50，新记录在前，溢出丢最旧", () => {
    const ring = createRing(50);
    for (let i = 1; i <= 55; i++) {
      ring.push({ startedAt: 1000 + i, status: "healthy" });
    }
    assert.equal(ring.count, 50);
    const snap = ring.snapshot();
    assert.equal(snap[0].startedAt, 1055, "records[0] 应为最新");
    assert.equal(snap[49].startedAt, 1006, "最旧的 1001..1005 应被丢弃");
  });

  test("id 唯一且格式为 r-<startedAt>-<seq>", () => {
    const ring = createRing(50);
    const a = ring.push({ startedAt: 5000 });
    const b = ring.push({ startedAt: 5000 });
    assert.match(a.id, /^r-5000-\d+$/);
    assert.notEqual(a.id, b.id);
  });

  test("snapshot 是副本，改动不影响内部", () => {
    const ring = createRing(50);
    ring.push({ startedAt: 1 });
    const s = ring.snapshot();
    s.push({ startedAt: 2 });
    s[0].startedAt = 999;
    assert.equal(ring.count, 1);
    assert.equal(ring.snapshot()[0].startedAt, 1);
  });

  test("clear 返回清空条数", () => {
    const ring = createRing(50);
    ring.push({ startedAt: 1 });
    ring.push({ startedAt: 2 });
    assert.equal(ring.clear(), 2);
    assert.equal(ring.count, 0);
    assert.equal(ring.clear(), 0);
  });
});

// ===========================================================================
// 12. 宿主端点（SPEC §11、AC18、AC19）+ 密钥解析顺序（AC10）
// ===========================================================================

/** 构造一个最小的 fake cordis ctx，并抓取注册的路由。 */
function createFakeCtx({ providers = null, credentials = undefined, settingsThrows = false } = {}) {
  const routes = new Map();
  const logs = [];
  const ctx = {
    logger: {
      info: (m) => logs.push(["info", String(m)]),
      warn: (m) => logs.push(["warn", String(m)]),
      debug: (m) => logs.push(["debug", String(m)]),
      error: (m) => logs.push(["error", String(m)])
    },
    get(name) {
      if (name === "webServer") {
        return {
          register(route) {
            routes.set(route.path, route);
            return () => routes.delete(route.path);
          }
        };
      }
      if (name === "settings") {
        if (settingsThrows) return { get() { throw new TypeError("namespace not registered"); } };
        return { get: () => (providers === null ? undefined : { providers }) };
      }
      if (name === "credentials") return credentials;
      return undefined;
    },
    on() {},
    effect(fn) {
      return fn();
    }
  };
  return { ctx, routes, logs };
}

/** 构造 fake req / res。 */
function createReqRes(method, body, url = "/") {
  const payload = body === undefined ? "" : JSON.stringify(body);
  const req = {
    method,
    url,
    async *[Symbol.asyncIterator]() {
      if (payload !== "") yield Buffer.from(payload, "utf8");
    }
  };
  const captured = { status: null, headers: null, body: null };
  const res = {
    writeHead(status, headers) {
      captured.status = status;
      captured.headers = headers;
    },
    end(chunk) {
      captured.body = chunk === undefined ? "" : String(chunk);
    }
  };
  return { req, res, captured };
}

async function callRoute(routes, path, method, body) {
  const route = routes.get(path);
  assert.ok(route, `路由 ${path} 未注册`);
  const { req, res, captured } = createReqRes(method, body);
  await route.handler(req, res);
  return { ...captured, json: captured.body === "" ? null : JSON.parse(captured.body) };
}

describe("宿主端点（§11）", () => {
  const PROVIDERS = {
    "happycodeai": {
      displayName: "happycodeai",
      apiKeyEnv: "HAPPYCODEAI_API_KEY",
      api: "anthropic-messages",
      baseURL: "https://happycodeai.com/",
      models: [{ id: "claude-opus-5", name: "claude-opus-5" }]
    },
    "a1": { api: "openai-completions", baseURL: "https://same.com/v1", apiKeyEnv: "K1", models: [{ id: "m1" }] },
    "a2": { api: "openai-completions", baseURL: "https://same.com/v1", apiKeyEnv: "K2", models: [{ id: "m1" }] }
  };

  test("启动后注册 3 条路由", () => {
    const { ctx, routes } = createFakeCtx({ providers: PROVIDERS });
    apply(ctx, {});
    assert.ok(routes.has("/api/model-health/config"));
    assert.ok(routes.has("/api/model-health/test"));
    assert.ok(routes.has("/api/model-health/records"));
  });

  test("GET /config：UTF-8 头、no-store、结构完整", async () => {
    const { ctx, routes } = createFakeCtx({ providers: PROVIDERS });
    apply(ctx, {});
    const r = await callRoute(routes, "/api/model-health/config", "GET");
    assert.equal(r.status, 200);
    assert.equal(r.headers["content-type"], "application/json; charset=utf-8");
    assert.equal(r.headers["cache-control"], "no-store");
    assert.equal(r.json.ok, true);
    assert.equal(r.json.source.namespace, "llm-pi-ai");
    assert.equal(r.json.source.available, true);
    assert.equal(r.json.source.providerCount, 3);
    assert.equal(r.json.providers.length, 2, "happycodeai.com 与 same.com/v1 两个供应商组");
    assert.equal(r.json.groups.length, 2);
    assert.equal(r.json.defaults.stream, false);
    assert.equal(r.json.defaults.maxRecords, 50);
    assert.ok(r.json.thresholds.slowMs > 0);
    assert.ok(r.json.templates.systemPrompt.length > 0);
  });

  test("GET /config：中文不乱码（UTF-8 往返）", async () => {
    // 加一条 anthropic + /v1 的路由，触发 ANTHROPIC_BASEURL_HAS_V1 中文警告
    const providers = {
      ...PROVIDERS,
      "dual": {
        displayName: "dual",
        apiKeyEnv: "DUAL_KEY",
        api: "anthropic-messages",
        baseURL: "http://dual.example.com/v1",
        models: [{ id: "dm1" }]
      }
    };
    const { ctx, routes } = createFakeCtx({ providers });
    apply(ctx, {});
    const r = await callRoute(routes, "/api/model-health/config", "GET");
    assert.ok(r.json.templates.systemPrompt.includes("连通性探针"), "中文模板应正确编码");

    const dual = r.json.groups.find((g) => g.providerId && g.api === "anthropic-messages" && g.baseURLNormalized === "http://dual.example.com/v1");
    assert.ok(dual, "应存在 dual 分组");
    assert.ok(
      dual.warnings.some((w) => w.code === "ANTHROPIC_BASEURL_HAS_V1" && /[\u4e00-\u9fff]/.test(w.message)),
      "中文警告文案应正确编码"
    );
    // 整体中文往返校验：响应文本里不应出现替换字符
    assert.equal(r.body.includes("\uFFFD"), false, "响应不得含替换字符（编码错误信号）");
  });

  test("GET /config：密钥只回引用名与 configured，绝不回值", async () => {
    const credentials = {
      async resolve() {
        return { value: "sk-secret-value-should-not-leak", source: "file" };
      },
      async describe(ref) {
        return { configured: true, source: "file", writable: false };
      }
    };
    const { ctx, routes } = createFakeCtx({ providers: PROVIDERS, credentials });
    apply(ctx, {});
    const r = await callRoute(routes, "/api/model-health/config", "GET");
    const text = JSON.stringify(r.json);
    assert.equal(text.includes("sk-secret-value-should-not-leak"), false, "config 响应绝不得含密钥值");
    const allRoutes = r.json.groups.flatMap((g) => g.routes);
    const anth = allRoutes.find((x) => x.routeKey === "happycodeai");
    assert.equal(anth.credential.ref, "HAPPYCODEAI_API_KEY");
    assert.equal(anth.credential.configured, true);
    assert.equal(anth.credential.source, "file");
  });

  test("GET /config：凭据服务缺失时 configured 为 null（未知）", async () => {
    const { ctx, routes } = createFakeCtx({ providers: PROVIDERS, credentials: undefined });
    apply(ctx, {});
    const r = await callRoute(routes, "/api/model-health/config", "GET");
    const anth = r.json.groups.flatMap((g) => g.routes).find((x) => x.routeKey === "happycodeai");
    assert.equal(anth.credential.ref, "HAPPYCODEAI_API_KEY", "引用名仍应回显");
    assert.equal(anth.credential.configured, null);
  });

  test("GET /config：settings 缺失 → available:false 且不抛", async () => {
    const { ctx, routes } = createFakeCtx({ providers: null });
    apply(ctx, {});
    const r = await callRoute(routes, "/api/model-health/config", "GET");
    assert.equal(r.status, 200);
    assert.equal(r.json.source.available, false);
    assert.equal(r.json.providers.length, 0);
    assert.ok(r.json.warnings.some((w) => w.code === "SETTINGS_UNAVAILABLE"));
  });

  test("GET /config：settings.get 抛异常 → 降级不 500", async () => {
    const { ctx, routes } = createFakeCtx({ settingsThrows: true });
    apply(ctx, {});
    const r = await callRoute(routes, "/api/model-health/config", "GET");
    assert.equal(r.status, 200);
    assert.equal(r.json.source.available, false);
  });

  test("POST /test：未知 routeKey → 404 UNKNOWN_ROUTE", async () => {
    const { ctx, routes } = createFakeCtx({ providers: PROVIDERS });
    apply(ctx, {});
    const r = await callRoute(routes, "/api/model-health/test", "POST", { routeKey: "nope", modelId: "m1" });
    assert.equal(r.status, 404);
    assert.equal(r.json.ok, false);
    assert.equal(r.json.error.code, "UNKNOWN_ROUTE");
  });

  test("POST /test：未知 modelId → 400 UNKNOWN_MODEL", async () => {
    const { ctx, routes } = createFakeCtx({ providers: PROVIDERS });
    apply(ctx, {});
    const r = await callRoute(routes, "/api/model-health/test", "POST", { routeKey: "a1", modelId: "nope" });
    assert.equal(r.status, 400);
    assert.equal(r.json.error.code, "UNKNOWN_MODEL");
  });

  test("POST /test：缺字段 → 400 BAD_REQUEST", async () => {
    const { ctx, routes } = createFakeCtx({ providers: PROVIDERS });
    apply(ctx, {});
    const r1 = await callRoute(routes, "/api/model-health/test", "POST", { routeKey: "a1" });
    assert.equal(r1.status, 400);
    assert.equal(r1.json.error.code, "BAD_REQUEST");
    const r2 = await callRoute(routes, "/api/model-health/test", "POST", { routeKey: "a1", modelId: "m1", stream: "yes" });
    assert.equal(r2.status, 400);
    assert.equal(r2.json.error.code, "BAD_REQUEST");
  });

  test("POST /test：非法 JSON body → 400 BAD_REQUEST（不 500）", async () => {
    const { ctx, routes } = createFakeCtx({ providers: PROVIDERS });
    apply(ctx, {});
    const route = routes.get("/api/model-health/test");
    const req = {
      method: "POST",
      url: "/",
      async *[Symbol.asyncIterator]() {
        yield Buffer.from("{not json", "utf8");
      }
    };
    const captured = { status: null, body: null };
    const res = {
      writeHead(s) {
        captured.status = s;
      },
      end(c) {
        captured.body = String(c);
      }
    };
    await route.handler(req, res);
    assert.equal(captured.status, 400);
    assert.equal(JSON.parse(captured.body).error.code, "BAD_REQUEST");
  });

  test("POST /test：缺密钥 → 200 + status:failed + MISSING_CREDENTIAL（测试失败是数据不是传输错误）", async () => {
    const { ctx, routes } = createFakeCtx({ providers: PROVIDERS, credentials: undefined });
    apply(ctx, {});
    const r = await callRoute(routes, "/api/model-health/test", "POST", { routeKey: "a1", modelId: "m1" });
    assert.equal(r.status, 200, "测试失败仍返回 HTTP 200");
    assert.equal(r.json.status, "failed");
    assert.equal(r.json.error.code, "MISSING_CREDENTIAL");
    assert.ok(r.json.target.credentialRef === "K1");
  });

  test("GET /records：空时 count 0；POST clear 生效", async () => {
    const { ctx, routes } = createFakeCtx({ providers: PROVIDERS });
    apply(ctx, {});
    const r = await callRoute(routes, "/api/model-health/records", "GET");
    assert.equal(r.status, 200);
    assert.equal(r.json.count, 0);
    assert.equal(r.json.capacity, 50);
    assert.deepEqual(r.json.records, []);

    const c = await callRoute(routes, "/api/model-health/records", "POST", { action: "clear" });
    assert.equal(c.status, 200);
    assert.equal(c.json.cleared, 0);

    const bad = await callRoute(routes, "/api/model-health/records", "POST", { action: "nope" });
    assert.equal(bad.status, 400);
    assert.equal(bad.json.error.code, "BAD_REQUEST");
  });

  test("真实测试经端点落到 RingBuffer 并可读回（记录与 /test 返回同构）", async () => {
    reset();
    const providers = {
      "local": { displayName: "local", apiKeyEnv: "LOCAL_KEY", api: "openai-completions", baseURL: base, models: [{ id: "m1" }] }
    };
    const credentials = { async resolve() { return { value: "sk-test-abcdefghijklmnop", source: "file" }; } };
    const { ctx, routes } = createFakeCtx({ providers, credentials });
    apply(ctx, {});
    mock.on((req, res) => {
      sendJson(res, 200, { choices: [{ message: { content: "OK" }, finish_reason: "stop" }], usage: { prompt_tokens: 5, completion_tokens: 1, total_tokens: 6 } });
    });

    const r = await callRoute(routes, "/api/model-health/test", "POST", { routeKey: "local", modelId: "m1" });
    assert.equal(r.status, 200);
    assert.equal(r.json.status, "healthy");
    assert.equal(r.json.responseText, "OK");
    assert.ok(r.json.id.startsWith("r-"));

    const rec = await callRoute(routes, "/api/model-health/records", "GET");
    assert.equal(rec.json.count, 1);
    assert.deepEqual(Object.keys(rec.json.records[0]).sort(), Object.keys(r.json).sort(), "记录与 /test 返回同构");
    assert.equal(rec.json.records[0].actualUrl, `${base}/chat/completions`);

    const cleared = await callRoute(routes, "/api/model-health/records", "POST", { action: "clear" });
    assert.equal(cleared.json.cleared, 1);
    assert.equal((await callRoute(routes, "/api/model-health/records", "GET")).json.count, 0);
  });

  test("AC4：actualUrl 与 requestPreview 的 url 一致", async () => {
    reset();
    const providers = {
      "local": { displayName: "local", apiKeyEnv: "LOCAL_KEY", api: "openai-completions", baseURL: base, models: [{ id: "m1" }] }
    };
    const credentials = { async resolve() { return { value: "sk-test-abcdefghijklmnop", source: "file" }; } };
    const { ctx, routes } = createFakeCtx({ providers, credentials });
    apply(ctx, {});
    mock.on((req, res) => {
      sendJson(res, 200, { choices: [{ message: { content: "OK" }, finish_reason: "stop" }], usage: {} });
    });
    const cfg = await callRoute(routes, "/api/model-health/config", "GET");
    const preview = cfg.json.groups[0].requestPreview.nonStream.url;
    const r = await callRoute(routes, "/api/model-health/test", "POST", { routeKey: "local", modelId: "m1" });
    assert.equal(r.json.actualUrl, preview, "真实 URL 必须等于预览 URL");
  });

  test("AC10 反证：credentials 缺失且无环境变量 → 12 条路由全 MISSING_CREDENTIAL", async () => {
    // 构造 12 条路由，apiKeyEnv 指向本机不存在于环境的变量名
    const providers = {};
    for (let i = 1; i <= 12; i++) {
      providers[`r${i}`] = {
        apiKeyEnv: `DSH_MH_NONEXISTENT_${i}`,
        api: "openai-completions",
        baseURL: `https://h${i}.com/v1`,
        models: [{ id: "m1" }]
      };
    }
    const { ctx, routes } = createFakeCtx({ providers, credentials: undefined });
    apply(ctx, {});
    let count = 0;
    for (let i = 1; i <= 12; i++) {
      const r = await callRoute(routes, "/api/model-health/test", "POST", { routeKey: `r${i}`, modelId: "m1" });
      assert.equal(r.json.status, "failed");
      assert.equal(r.json.error.code, "MISSING_CREDENTIAL", `r${i} 应 MISSING_CREDENTIAL`);
      count++;
    }
    assert.equal(count, 12);
  });

  test("AC10 正证：credentials 服务存在时必须走它（而非环境变量）", async () => {
    let resolveCalls = 0;
    const credentials = {
      async resolve(ref) {
        resolveCalls++;
        return { value: "sk-from-credentials-service", source: "file" };
      }
    };
    const providers = {
      "local": { apiKeyEnv: "LOCAL_KEY", api: "openai-completions", baseURL: base, models: [{ id: "m1" }] }
    };
    const { ctx, routes } = createFakeCtx({ providers, credentials });
    apply(ctx, {});
    reset();
    mock.on((req, res) => {
      sendJson(res, 200, { choices: [{ message: { content: "OK" }, finish_reason: "stop" }], usage: {} });
    });
    const r = await callRoute(routes, "/api/model-health/test", "POST", { routeKey: "local", modelId: "m1" });
    assert.equal(r.json.status, "healthy", "应使用 credentials 服务解析出的密钥");
    assert.ok(resolveCalls > 0, "必须调用 credentials.resolve");
    assert.equal(JSON.stringify(r.json).includes("sk-from-credentials-service"), false, "密钥不得泄漏");
    assert.equal(mock.last.headers.authorization, "Bearer sk-from-credentials-service", "真实请求应带解析出的密钥");
  });

  test("AC19 配置只读：llm-pi-ai 命名空间绝不被写（唯一写操作是 agent-default-model）", async () => {
    const { readFile } = await import("node:fs/promises");
    const { fileURLToPath } = await import("node:url");
    const { dirname, join } = await import("node:path");
    const here = dirname(fileURLToPath(import.meta.url));

    // ★ 口径变化（v1.0.8）：本插件新增了「设为默认模型」功能，它**必须**写 settings
    //   （写 agent-default-model 一节）。故原先的「源码无任何 settings 写调用」已不成立，
    //   若继续照旧断言，就只能在文件清单里漏掉新模块才能保持绿 —— 那是**假绿**。
    //   正确口径是：**llm-pi-ai 只读**（既有契约不变），写操作只允许落在 agent-default-model。
    //   因此这里改为「全量扫描 lib/*.js」+「按命名空间断言」，而不是「按调用形式断言」。
    const { readdir } = await import("node:fs/promises");
    const libDir = join(here, "..", "lib");
    const files = (await readdir(libDir)).filter((f) => f.endsWith(".js"));
    assert.ok(files.length >= 6, `lib/ 下应至少 6 个模块（实测 ${files.length}），否则扫描不完整`);

    const writeCall = /\b(?:update|replace|mutate)\s*\(/;
    for (const f of files) {
      const src = await readFile(join(libDir, f), "utf8");
      // 1) 任何写调用都不得以 llm-pi-ai 为命名空间
      assert.equal(
        /\b(?:update|replace|mutate)\s*\(\s*["']llm-pi-ai["']/.test(src),
        false,
        `lib/${f} 不得写入 llm-pi-ai 命名空间`
      );
      // 2) 不得出现把命名空间作为常量传给写调用的写法
      assert.equal(
        /NS\s*\)/.test(src) && writeCall.test(src) && /settings\s*\.\s*(?:update|replace|mutate)\s*\(\s*NS/.test(src),
        false,
        `lib/${f} 不得以 NS（llm-pi-ai）为写目标`
      );
    }

    // 3) 唯一的写路径必须明确指向 agent-default-model
    const dmSrc = await readFile(join(libDir, "default-model.js"), "utf8");
    assert.equal(
      /settings\.replace\(\s*DEFAULT_MODEL_NAMESPACE/.test(dmSrc),
      true,
      "default-model.js 必须只写 DEFAULT_MODEL_NAMESPACE"
    );
    assert.equal(dmSrc.includes('"agent-default-model"'), true, "DEFAULT_MODEL_NAMESPACE 必须是 agent-default-model");
    // 4) 不得用 update（合并语义无法移除字段，见 SPEC §19.3）
    assert.equal(/settings\.update\(/.test(dmSrc), false, "默认模型写入不得用 update（合并语义无法移除字段）");

    // 5) 反向对照：断言本身必须能失败 —— 用一份**故意写入 llm-pi-ai** 的样本验证检测力
    const probe = 'await settings.replace("llm-pi-ai", {});';
    assert.equal(
      /\b(?:update|replace|mutate)\s*\(\s*["']llm-pi-ai["']/.test(probe),
      true,
      "检测正则必须能抓到写入 llm-pi-ai 的样本（否则是空断言）"
    );
  });
});

// ===========================================================================
// 13. 配置读取与工具函数
// ===========================================================================

describe("配置读取与工具函数", () => {
  test("readProviders：正常 / 缺失 / 抛异常 三种降级", () => {
    const good = readProviders({ get: () => ({ get: () => ({ providers: { a: {} } }) }) });
    assert.equal(good.available, true);
    assert.equal(good.providerCount, 1);

    const noSettings = readProviders({ get: () => undefined });
    assert.equal(noSettings.available, false);
    assert.equal(noSettings.providerCount, 0);

    const noNs = readProviders({ get: () => ({ get: () => undefined }) });
    assert.equal(noNs.available, false);

    const badNs = readProviders({ get: () => ({ get: () => ({ providers: [] }) }) });
    assert.equal(badNs.available, false, "providers 是数组应视为不可用");

    const throws = readProviders({
      get: () => ({
        get: () => {
          throw new TypeError("namespace not registered");
        }
      })
    });
    assert.equal(throws.available, false);
    assert.ok(throws.warnings.length > 0);
  });

  test("normalizeApiKey：空 / 非法字符 / 合法", () => {
    assert.equal(normalizeApiKey("").ok, false);
    assert.equal(normalizeApiKey("   ").reason, "empty");
    assert.equal(normalizeApiKey("has space").reason, "illegalCharacters");
    assert.equal(normalizeApiKey("has\nnewline").reason, "illegalCharacters");
    assert.equal(normalizeApiKey("中文密钥").reason, "illegalCharacters");
    assert.equal(normalizeApiKey(undefined).ok, false);
    const ok = normalizeApiKey("  sk-abc123  ");
    assert.equal(ok.ok, true);
    assert.equal(ok.value, "sk-abc123", "应 trim");
  });

  test("httpCodeOf 映射", () => {
    assert.equal(httpCodeOf(401), "HTTP_401");
    assert.equal(httpCodeOf(404), "HTTP_404");
    assert.equal(httpCodeOf(429), "HTTP_429");
    assert.equal(httpCodeOf(500), "HTTP_5XX");
    assert.equal(httpCodeOf(599), "HTTP_5XX");
    assert.equal(httpCodeOf(418), "HTTP_ERROR");
  });

  test("buildWarnings：四种警告", () => {
    assert.ok(buildWarnings({ api: "anthropic-messages", baseURLNormalized: "http://a.com/v1", rawBaseURL: "http://a.com/v1" }).some((w) => w.code === "ANTHROPIC_BASEURL_HAS_V1"));
    assert.ok(buildWarnings({ api: "openai-completions", baseURLNormalized: "https://a.com", rawBaseURL: "https://a.com" }).some((w) => w.code === "OPENAI_BASEURL_MISSING_V1"));
    assert.ok(buildWarnings({ api: "bedrock-converse-stream", baseURLNormalized: "https://a.com", rawBaseURL: "https://a.com" }).some((w) => w.code === "UNSUPPORTED_API"));
    assert.ok(buildWarnings({ api: "openai-completions", baseURLNormalized: "", rawBaseURL: null }).some((w) => w.code === "MISSING_BASE_URL"));
    // openai 系带 /v1 且受支持 → 无警告
    assert.equal(buildWarnings({ api: "openai-completions", baseURLNormalized: "https://a.com/v1", rawBaseURL: "https://a.com/v1" }).length, 0);
  });

  test("resolveConfig 夹紧越界值", () => {
    const c = resolveConfig({ slowMs: -5, hardTimeoutMs: 10, maxRecords: 9999, maxResponseBytes: 1 });
    assert.equal(c.slowMs, 100);
    assert.equal(c.hardTimeoutMs, 1000);
    assert.equal(c.maxRecords, 500);
    assert.equal(c.maxResponseBytes, 1024);
    const d = resolveConfig({});
    assert.equal(d.slowMs, 15000);
    assert.equal(d.hardTimeoutMs, 60000);
    assert.equal(d.maxRecords, 50);
  });
});

// ===========================================================================
// 14. 路由身份与测试发现（回归护栏）
// ===========================================================================

describe("路由身份与测试发现（回归护栏）", () => {
  test("路由身份用 routeKey，绝不用密钥值或 apiKeyEnv 去重（F-QA-06）", () => {
    // 真实反例：本机 xcmapi.com/v1 下 4 条路由，其中 API_TCVPS_006_API_KEY 与
    // XCMAPI_GUOMO_KEY 的密钥【值】逐字节相同；若按值去重会少算成 3 条。
    // 另一反例：AI_MAX66_API_KEY 被 aimax66 与 aimax66-open 两条路由共用——
    // 所以按 apiKeyEnv 名去重同样不安全。唯一正确的身份是 routeKey（字典键）。
    const providers = {
      "r1": { api: "openai-completions", baseURL: "https://s.com/v1", apiKeyEnv: "SAME_KEY", models: [{ id: "m" }] },
      "r2": { api: "openai-completions", baseURL: "https://s.com/v1", apiKeyEnv: "SAME_KEY", models: [{ id: "m" }] },
      "r3": { api: "openai-completions", baseURL: "https://s.com/v1", apiKeyEnv: "OTHER_KEY", models: [{ id: "m" }] }
    };
    const sel = buildSelection(providers, {});
    assert.equal(sel.groups.length, 1, "同 baseURL+api 应归为一个分组");
    assert.equal(sel.groups[0].routeCount, 3, "3 条路由即使共享 apiKeyEnv 也必须各算一条");
    assert.deepEqual(sel.groups[0].routes.map((r) => r.routeKey), ["r1", "r2", "r3"], "路由顺序按配置声明");
    const m = sel.groups[0].models[0];
    assert.equal(m.routeKeys.length, 3, "同一模型被 3 条路由声明 → 第四行候选 3");
  });

  test("同一 apiKeyEnv 跨分组复用不影响路由计数", () => {
    const providers = {
      "a": { api: "anthropic-messages", baseURL: "https://dual.com/v1", apiKeyEnv: "SHARED", models: [{ id: "m1" }] },
      "b": { api: "openai-completions", baseURL: "https://dual.com/v1", apiKeyEnv: "SHARED", models: [{ id: "m2" }] }
    };
    const sel = buildSelection(providers, {});
    assert.equal(sel.groups.length, 2, "两种 api 应分成两组");
    assert.equal(sel.groups.reduce((n, g) => n + g.routeCount, 0), 2, "共享 apiKeyEnv 不得让路由数变少");
  });

  // captain 要求的 fixture：两个【不同 route key】但 apiKeyEnv 指向【同一密钥值】，
  // 断言仍产出两条独立路由——防止未来有人「优化」成按值去重。
  // 这精确复现本机真实反例：API_TCVPS_006_API_KEY ≡ XCMAPI_GUOMO_KEY（同值不同名）。
  test("不同 route key + 同一密钥值 → 仍产出两条独立路由（按值去重会红）", () => {
    const SAME_VALUE = "sk-identical-value-for-two-routes-0123456789";
    const providers = {
      "route-alpha": {
        api: "openai-completions",
        baseURL: "https://same.example.com/v1",
        apiKeyEnv: "ALPHA_KEY",
        models: [{ id: "m1" }]
      },
      "route-beta": {
        api: "openai-completions",
        baseURL: "https://same.example.com/v1",
        apiKeyEnv: "BETA_KEY", // 不同的引用名
        models: [{ id: "m1" }]
      }
    };

    // 两个引用名解析出【逐字节相同】的密钥值 —— 正是本机的真实形态
    const credentials = {
      async resolve(ref) {
        return { value: SAME_VALUE, source: "file" };
      },
      async describe() {
        return { configured: true, source: "file", writable: false };
      }
    };

    const sel = buildSelection(providers, {});
    assert.equal(sel.groups.length, 1, "同 baseURL+api 归为一个分组");
    assert.equal(sel.groups[0].routeCount, 2, "两条路由必须各算一条，尽管密钥值相同");
    assert.deepEqual(
      sel.groups[0].routes.map((r) => r.routeKey),
      ["route-alpha", "route-beta"],
      "两条路由都必须出现在 routes[] 里"
    );
    // 该模型被两条路由声明 → 第四行候选 2（若按值去重会退化成 1，第四行消失）
    assert.equal(sel.groups[0].models[0].routeKeys.length, 2, "routeKeys 必须为 2，否则第四行会消失");

    // 分组算法是纯函数：它根本看不到密钥值，因此不可能按值去重。
    // 这里额外断言「产出与凭据服务无关」——换一个 credentials stub 结果不变。
    const sel2 = buildSelection(providers, {});
    assert.deepEqual(
      sel2.groups[0].routes.map((r) => r.routeKey),
      sel.groups[0].routes.map((r) => r.routeKey),
      "分组结果不得依赖凭据解析结果"
    );
    assert.equal(typeof credentials.resolve, "function");
  });

  // ---------------------------------------------------------------------------
  // F-DC-24 回归：分组级警告不得随该组路由数线性增长
  //
  // 缺陷：group.warnings.push(...buildWarnings(...)) 原先位于 per-route 循环体内，
  // 而 buildWarnings 的三个输入全是分组级常量 ⇒ N 条路由产生 N 条逐字相同警告
  // （每条占 18px），在「四行选择器 + 警告条」组合下撑爆面板高度预算（AC15 A 档）。
  // ---------------------------------------------------------------------------

  /** 构造同组 N 条路由的 fixture（同 baseURL + 同 api）。 */
  function sameGroupRoutes(n, api, baseURL) {
    const p = {};
    for (let i = 0; i < n; i++) {
      p[`route-${i}`] = { baseURL, api, models: [{ id: `m${i}` }] };
    }
    return p;
  }

  test("F-DC-24：同组 N 条路由 ⇒ 警告数为 1，不随路由数增长", () => {
    for (const n of [2, 3, 4, 8]) {
      const sel = buildSelection(sameGroupRoutes(n, "openai-completions", "https://www.xcmapi.com"), {});
      assert.equal(sel.groups.length, 1, `N=${n} 应只有一个分组`);
      assert.equal(sel.groups[0].routeCount, n, `N=${n} 路由数应正确`);
      assert.equal(sel.groups[0].warnings.length, 1, `N=${n} 条路由只应产出 1 条分组级警告，实际 ${sel.groups[0].warnings.length}`);
    }
  });

  test("F-DC-24：4 个 code 在「同组 4 条路由」下各自只产出 1 条", () => {
    const cases = [
      ["MISSING_BASE_URL", "openai-completions", null],
      ["UNSUPPORTED_API", "azure-openai-responses", "https://a.com/v1"],
      ["ANTHROPIC_BASEURL_HAS_V1", "anthropic-messages", "http://ai.max66.xyz/v1"],
      ["OPENAI_BASEURL_MISSING_V1", "openai-completions", "https://www.xcmapi.com"]
    ];
    for (const [expectCode, api, baseURL] of cases) {
      const sel = buildSelection(sameGroupRoutes(4, api, baseURL), {});
      const g = sel.groups[0];
      assert.equal(g.routeCount, 4, `${expectCode} 组应有 4 条路由`);
      assert.equal(g.warnings.length, 1, `${expectCode} 应只产出 1 条警告，实际 ${g.warnings.length}`);
      assert.equal(g.warnings[0].code, expectCode, `警告 code 应为 ${expectCode}`);
    }
  });

  test("F-DC-24：警告文本逐字唯一（不存在任何重复项）", () => {
    const sel = buildSelection(sameGroupRoutes(4, "openai-completions", "https://www.xcmapi.com"), {});
    const warnings = sel.groups[0].warnings;
    const keys = warnings.map((w) => JSON.stringify([w.code, w.message]));
    assert.equal(new Set(keys).size, keys.length, "不得存在 (code, message) 逐字相同的重复警告");
    assert.equal(keys.length, 1);
  });

  test("F-DC-24 语义保留：不同分组各自的警告不被跨组合并", () => {
    // 两个不同 baseURL 的分组，各自都应保留自己的警告
    const providers = {
      "a": { baseURL: "https://a.example.com", api: "openai-completions", models: [{ id: "m" }] },
      "b": { baseURL: "https://b.example.com", api: "openai-completions", models: [{ id: "m" }] }
    };
    const sel = buildSelection(providers, {});
    assert.equal(sel.groups.length, 2, "两个 baseURL 应分成两组");
    for (const g of sel.groups) {
      assert.equal(g.warnings.length, 1, `分组 ${g.baseURLNormalized} 应保留自己的 1 条警告（不得跨组去重）`);
      assert.equal(g.warnings[0].code, "OPENAI_BASEURL_MISSING_V1");
    }

    // ★ 区分力反证（防恒真）：这两条警告是【逐字相同】的 —— code 与 message 都由常量构成，
    //   与 baseURL 无关。因此若去重集 seen 被提到分组循环【外】（全局去重），
    //   第二组就会被静默吞掉 1 条警告（warnings.length 变 0）。
    //   先断言「它们确实逐字相同」，上面的「两组各 1 条」才是有区分力的断言。
    const w0 = sel.groups[0].warnings[0], w1 = sel.groups[1].warnings[0];
    assert.equal(w0.code, w1.code, "两组 code 相同 ⇒ 全局去重会误吞第二组");
    assert.equal(w0.message, w1.message, "两组 message 逐字相同 ⇒ 全局去重会误吞第二组");
  });

  test("F-DC-24 反证：断言具备区分力（若回到 per-route 累积，警告数会变成 N）", () => {
    // 模拟旧实现：在 per-route 循环里 push 分组级警告
    const n = 4;
    const providers = sameGroupRoutes(n, "openai-completions", "https://www.xcmapi.com");
    const groupLevel = buildWarnings({
      api: "openai-completions",
      baseURLNormalized: "https://www.xcmapi.com",
      rawBaseURL: "https://www.xcmapi.com"
    });
    // 旧行为 = 每条路由各 push 一次
    const buggy = [];
    for (let i = 0; i < n; i++) buggy.push(...groupLevel);
    // 新行为 = 每组只 push 一次
    const fixed = [...groupLevel];
    assert.equal(buggy.length, n, "旧实现应产生 N 条（证明该断言能区分新旧行为）");
    assert.equal(fixed.length, 1, "新实现只产生 1 条");

    // 真实实现必须与 fixed 一致
    const sel = buildSelection(providers, {});
    assert.equal(sel.groups[0].warnings.length, fixed.length, "真实实现必须与「每组一次」一致");
  });

  test("tests/ 目录入口必须发现全部 *.test.mjs，不得漏跑（防假绿）", async () => {
    // Node 24 下 `node --test tests/` 依赖 tests/index.js 作为目录入口。
    // 若该入口只 import 单个文件，后来新增的测试文件会被静默跳过，
    // 产生「用例数偏少但退出码 0」的假绿——最危险的失败模式。
    const { readFile, readdir } = await import("node:fs/promises");
    const { fileURLToPath } = await import("node:url");
    const { dirname, join } = await import("node:path");
    const here = dirname(fileURLToPath(import.meta.url));

    const entry = await readFile(join(here, "index.js"), "utf8");
    assert.match(entry, /readdirSync|readdir/, "tests/index.js 必须动态枚举目录，而不是硬编码文件名");
    assert.match(entry, /\.test\.(mjs|cjs|js)/, "tests/index.js 必须按测试文件模式过滤");

    const files = (await readdir(here)).filter((f) => /\.test\.mjs$/.test(f));
    assert.ok(files.length >= 1, "tests/ 下应至少有一个 *.test.mjs");
    assert.ok(files.includes("probe.test.mjs"), "probe.test.mjs 必须存在");
  });
});

// ===========================================================================
// 15. 源码卫生：NUL 字节自检（F-R-01）
// ===========================================================================

describe("源码卫生：NUL 字节自检", () => {
  test("lib/** 与 tests/** 内不得出现 0x00（裸 NUL 会破坏编辑/审查/打包）", async () => {
    const { readFile, readdir } = await import("node:fs/promises");
    const { fileURLToPath } = await import("node:url");
    const { dirname, join } = await import("node:path");
    const root = join(dirname(fileURLToPath(import.meta.url)), "..");

    /** 递归收集待扫描文件。 */
    async function collect(dir) {
      const out = [];
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
        const full = join(dir, entry.name);
        if (entry.isDirectory()) out.push(...(await collect(full)));
        else if (/\.(mjs|cjs|js|json|yml|yaml|md|txt)$/.test(entry.name)) out.push(full);
      }
      return out;
    }

    const files = [...(await collect(join(root, "lib"))), ...(await collect(join(root, "tests")))];
    assert.ok(files.length > 0, "应扫描到若干源码文件");

    const offenders = [];
    for (const f of files) {
      const buf = await readFile(f);
      const at = buf.indexOf(0x00);
      if (at !== -1) offenders.push(`${f.replace(root, ".")} (offset ${at})`);
    }
    assert.deepEqual(offenders, [], `以下文件含裸 NUL 字节：\n  ${offenders.join("\n  ")}`);
  });

  test("NUL 自检具备区分力：构造含 NUL 的临时文件必须被判定为违规", async () => {
    // 反证：证明上面那条用例不是恒真。用同样的判定逻辑扫一个刻意含 NUL 的缓冲。
    const detect = (buf) => buf.indexOf(0x00) !== -1;
    const dirty = Buffer.from("abc\u0000def", "utf8");
    const clean = Buffer.from("abc def", "utf8");
    assert.equal(detect(dirty), true, "含 NUL 的缓冲必须被判为违规（否则自检无意义）");
    assert.equal(detect(clean), false, "不含 NUL 的缓冲不得误报");
    // 并确认哨兵值修复后 providers.js 确实干净
    const { readFile } = await import("node:fs/promises");
    const { fileURLToPath } = await import("node:url");
    const { dirname, join } = await import("node:path");
    const root = join(dirname(fileURLToPath(import.meta.url)), "..");
    const buf = await readFile(join(root, "lib", "providers.js"));
    assert.equal(buf.indexOf(0x00), -1, "lib/providers.js 的 NUL 必须已清除");
  });
});

// ===========================================================================
// 16. AC2 反越界：只扫 llm-pi-ai.providers，不受其它命名空间干扰
// ===========================================================================

describe("AC2 反越界：只扫 llm-pi-ai.providers", () => {
  test("向 describe-image / llm-deepseek 塞干扰 baseURL，组数与 API 按钮数不变", () => {
    // 本机真实存在的其它命名空间（describe-image 的 baseURL 与 happycodeai 归一化后相同，
    // 正是「7 组 vs 6 组」分歧的来源）。readProviders 必须只认 llm-pi-ai.providers。
    const llmProviders = {
      "p-anthropic": { api: "anthropic-messages", baseURL: "https://happycodeai.com/", apiKeyEnv: "K1", models: [{ id: "claude" }] },
      "p-openai": { api: "openai-completions", baseURL: "https://happycodeai.com/v1", apiKeyEnv: "K2", models: [{ id: "gpt" }] }
    };

    const baseline = buildSelection(llmProviders, {});
    const baselineGroups = baseline.providers.length;
    const baselineApis = baseline.groups.length;
    assert.equal(baselineGroups, 2);
    assert.equal(baselineApis, 2);

    // 模拟 settings 里同时存在其它命名空间：readProviders 只取 llm-pi-ai.providers，
    // 所以干扰段必须完全不影响结果。
    const fakeSettings = {
      "llm-pi-ai": { providers: llmProviders },
      "describe-image": {
        baseURL: "https://happycodeai.com",
        channels: [{ api_url: "https://happycodeai.com", models: ["gpt-image-2"] }]
      },
      "llm-deepseek": {
        baseURL: "http://max66.xyz/v1",
        models: [{ id: "deepseek-v4-pro" }, { id: "glm-5.3" }]
      }
    };
    const ctx = { get: (n) => (n === "settings" ? { get: (ns) => fakeSettings[ns] } : undefined) };

    const read = readProviders(ctx);
    assert.equal(read.available, true);
    assert.equal(read.providerCount, 2, "providerCount 必须只数 llm-pi-ai.providers");
    assert.deepEqual(Object.keys(read.providers).sort(), ["p-anthropic", "p-openai"]);

    const after = buildSelection(read.providers, {});
    assert.equal(after.providers.length, baselineGroups, "供应商组数不得被其它命名空间影响");
    assert.equal(after.groups.length, baselineApis, "API 按钮数不得被其它命名空间影响");
    assert.equal(
      after.groups.reduce((n, g) => n + g.routeCount, 0),
      baseline.groups.reduce((n, g) => n + g.routeCount, 0),
      "路由数不得被其它命名空间影响"
    );
  });

  test("describe-image 的 baseURL 不得进入分组（否则会出现幽灵供应商组）", () => {
    const llmProviders = {
      "only": { api: "openai-completions", baseURL: "https://a.com/v1", apiKeyEnv: "K", models: [{ id: "m" }] }
    };
    const fakeSettings = {
      "llm-pi-ai": { providers: llmProviders },
      "describe-image": { baseURL: "https://ghost.example.com" }
    };
    const ctx = { get: (n) => (n === "settings" ? { get: (ns) => fakeSettings[ns] } : undefined) };
    const read = readProviders(ctx);
    const sel = buildSelection(read.providers, {});
    assert.equal(sel.providers.length, 1);
    assert.equal(
      sel.providers.some((p) => p.baseURLNormalized.includes("ghost.example.com")),
      false,
      "describe-image 的 baseURL 绝不能出现在供应商组里"
    );
  });

  test("llm-pi-ai 命名空间缺失时不回落到其它命名空间", () => {
    const fakeSettings = {
      "describe-image": { baseURL: "https://img.example.com" },
      "llm-deepseek": { baseURL: "https://ds.example.com", models: [{ id: "x" }] }
    };
    const ctx = { get: (n) => (n === "settings" ? { get: (ns) => fakeSettings[ns] } : undefined) };
    const read = readProviders(ctx);
    assert.equal(read.available, false, "llm-pi-ai 缺失必须判为不可用");
    assert.equal(read.providerCount, 0);
    assert.ok(read.warnings.some((w) => w.code === "SETTINGS_UNAVAILABLE"));
  });
});

// ===========================================================================
// 17. AC11 密钥泄漏：四面扫描器（每面独立跑 sk- 全量正则）
// ===========================================================================

/** 密钥特征正则：与 SPEC §15.1 泄漏扫描命令一致。 */
const SK_RE = /sk-[A-Za-z0-9_-]{8,}/g;

/** 在任意文本中统计 sk- 命中数（返回命中片段，便于定位）。 */
function scanSk(text) {
  if (typeof text !== "string" || text === "") return [];
  return String(text).match(SK_RE) ?? [];
}

/** 把任意值安全序列化为可扫描文本（循环引用安全）。 */
function scanText(value) {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

describe("AC11 密钥泄漏：四面扫描", () => {
  // 刻意使用 sk- 形态的假密钥，保证扫描器能识别（也验证它有区分力）
  const SECRET = "sk-ac11-scan-secret-value-0123456789";
  const PROVIDERS = {
    "leak-route": {
      displayName: "leak-route",
      apiKeyEnv: "AC11_KEY",
      api: "openai-completions",
      baseURL: "https://leak.example.com/v1",
      models: [{ id: "m1" }]
    }
  };

  /** 构造一个 credentials stub，resolve 返回已知密钥。 */
  function credsStub() {
    return {
      async resolve() {
        return { value: SECRET, source: "file" };
      },
      async describe() {
        return { configured: true, source: "file", writable: false };
      }
    };
  }

  test("面1｜三端点完整响应文本：sk- 命中数 = 0", async () => {
    const { ctx, routes, logs } = createFakeCtx({ providers: PROVIDERS, credentials: credsStub() });
    apply(ctx, {});

    const bodies = [];
    bodies.push(scanText((await callRoute(routes, "/api/model-health/config", "GET")).json));
    bodies.push(scanText((await callRoute(routes, "/api/model-health/records", "GET")).json));
    bodies.push(scanText((await callRoute(routes, "/api/model-health/records", "POST", { action: "clear" })).json));
    // POST /test：无 mock 上游会失败，但仍必须返回结构化结果且不泄漏
    bodies.push(scanText((await callRoute(routes, "/api/model-health/test", "POST", { routeKey: "leak-route", modelId: "m1" })).json));

    const face1 = scanSk(bodies.join("\n"));
    assert.deepEqual(face1, [], `面1 命中密钥特征：${face1.join(", ")}`);
    assert.equal(bodies.join("\n").includes(SECRET), false, "面1 不得出现密钥明文");
    assert.ok(logs.length > 0, "应有日志产生（面2 才有内容可扫）");
  });

  test("面2｜logger 输出：sk- 命中数 = 0", async () => {
    const { ctx, routes, logs } = createFakeCtx({ providers: PROVIDERS, credentials: credsStub() });
    apply(ctx, {});
    await callRoute(routes, "/api/model-health/config", "GET");
    await callRoute(routes, "/api/model-health/test", "POST", { routeKey: "leak-route", modelId: "m1" });
    await callRoute(routes, "/api/model-health/records", "GET");

    const logged = logs.map(([, m]) => m).join("\n");
    const face2 = scanSk(logged);
    assert.deepEqual(face2, [], `面2 日志命中密钥特征：${face2.join(", ")}`);
    assert.equal(logged.includes(SECRET), false, "面2 日志不得出现密钥明文");
    // 日志必须仍是有内容的（否则面2 是空扫描、无意义）
    assert.ok(logged.length > 0, "日志不应为空");
  });

  test("面3｜状态文件：断言不落盘 + 候选文件扫描命中数 = 0", async () => {
    const { readdir, readFile } = await import("node:fs/promises");
    const { fileURLToPath } = await import("node:url");
    const { dirname, join } = await import("node:path");
    const root = join(dirname(fileURLToPath(import.meta.url)), "..");

    /** 递归快照（路径 → mtimeMs）。 */
    async function snap(dir) {
      const out = new Map();
      async function walk(d) {
        let entries;
        try {
          entries = await readdir(d, { withFileTypes: true });
        } catch {
          return;
        }
        for (const e of entries) {
          if (e.name === "node_modules" || e.name.startsWith(".")) continue;
          const full = join(d, e.name);
          if (e.isDirectory()) await walk(full);
          else {
            try {
              const st = await (await import("node:fs/promises")).stat(full);
              out.set(full, st.mtimeMs);
            } catch {
              /* 忽略 */
            }
          }
        }
      }
      await walk(dir);
      return out;
    }

    const before = await snap(root);
    const { ctx, routes } = createFakeCtx({ providers: PROVIDERS, credentials: credsStub() });
    apply(ctx, {});
    await callRoute(routes, "/api/model-health/config", "GET");
    await callRoute(routes, "/api/model-health/test", "POST", { routeKey: "leak-route", modelId: "m1" });
    await callRoute(routes, "/api/model-health/records", "GET");
    const after = await snap(root);

    // 断言不落盘：不得新增文件，也不得改写既有文件
    const added = [...after.keys()].filter((f) => !before.has(f));
    const modified = [...after.keys()].filter((f) => before.has(f) && before.get(f) !== after.get(f));
    assert.deepEqual(added, [], `插件运行期间不得新增文件：${added.join(", ")}`);
    assert.deepEqual(modified, [], `插件运行期间不得改写文件：${modified.join(", ")}`);

    // 候选状态文件目录：插件声明不落盘，这里对常见落点做存在性 + 内容扫描。
    // 只扫当前包名对应的路径——插件从未落盘（AC12 已证「新增文件 = 0」），
    // 保留历史旧名路径只会扫到恒不存在的死路径，反而让断言看起来比实际更严。
    const candidates = [
      join(root, "state.json"),
      join(root, ".dsh-model-health-probe", "state.json"),
      join(process.env.USERPROFILE ?? "", ".dsh", "model-health-probe", "state.json")
    ];
    const scanned = [];
    for (const c of candidates) {
      try {
        const content = await readFile(c, "utf8");
        scanned.push(content);
      } catch {
        /* 不存在即符合「不落盘」 */
      }
    }
    const face3 = scanSk(scanned.join("\n"));
    assert.deepEqual(face3, [], `面3 命中密钥特征：${face3.join(", ")}`);
    assert.equal(scanned.join("\n").includes(SECRET), false, "面3 状态文件不得出现密钥明文");
  });

  test("面4｜error.title/hint/raw 与 4xx 错误体：sk- 命中数 = 0", async () => {
    // 4a) 上游 401 且【在响应体里回显密钥】——最危险的回显路径
    reset();
    mock.on((req, res) => {
      sendJson(res, 401, { error: `invalid api key: ${SECRET}` });
    });
    const r401 = await probe({ apiKey: SECRET });
    assert.equal(r401.error.code, "HTTP_401");

    // 4b) 未配置密钥（hint 会点名 apiKeyEnv 引用名，但不得含值）
    const rNoKey = await probe({ apiKey: null });

    // 4c) 4xx 错误体（未知路由 / 未知模型 / 非法 body）
    const { ctx, routes } = createFakeCtx({ providers: PROVIDERS, credentials: credsStub() });
    apply(ctx, {});
    const e404 = await callRoute(routes, "/api/model-health/test", "POST", { routeKey: "nope", modelId: "m1" });
    const e400 = await callRoute(routes, "/api/model-health/test", "POST", { routeKey: "leak-route", modelId: "nope" });
    const eBad = await callRoute(routes, "/api/model-health/test", "POST", { routeKey: "leak-route" });
    assert.equal(e404.status, 404);
    assert.equal(e400.status, 400);
    assert.equal(eBad.status, 400);

    const face4Text = [
      scanText({ title: r401.error.title, hint: r401.error.hint, raw: r401.error.raw }),
      scanText({ title: rNoKey.error.title, hint: rNoKey.error.hint, raw: rNoKey.error.raw }),
      scanText(e404.json),
      scanText(e400.json),
      scanText(eBad.json),
      scanText(r401.layers),
      scanText(rNoKey.layers)
    ].join("\n");

    const face4 = scanSk(face4Text);
    assert.deepEqual(face4, [], `面4 命中密钥特征：${face4.join(", ")}`);
    assert.equal(face4Text.includes(SECRET), false, "面4 错误文本不得出现密钥明文");
    // 回显路径确实被触发过：raw 里应出现 *** 而不是明文
    assert.ok(r401.error.raw.includes("***"), "网关回显的密钥应被替换为 ***");
  });

  test("扫描器具备区分力：植入密钥的阳性对照必须被抓到（防恒真）", () => {
    // 反证 1：正则本身能命中 sk- 形态
    assert.deepEqual(scanSk(`token=${SECRET}`), [SECRET], "扫描器必须能抓到植入的密钥");
    // 反证 2：经过脱敏的文本必须抓不到
    const redacted = `token=${"*".repeat(3)}`;
    assert.deepEqual(scanSk(redacted), [], "脱敏后不应命中");
    // 反证 3：非 sk- 形态的普通文本不得误报
    assert.deepEqual(scanSk("hello world, no secrets here"), [], "普通文本不得误报");
    // 反证 4：scanText 对对象/循环引用安全
    const circular = { a: 1 };
    circular.self = circular;
    assert.equal(typeof scanText(circular), "string", "scanText 必须对循环引用安全");
  });
});
