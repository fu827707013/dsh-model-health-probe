/**
 * 宿主端点集成用例：自动重试三端点（§18.7）+ 设为默认模型端点（§19.4）
 * + GET /config 的 defaultModel 字段（§19.2）。
 *
 * 本文件**不联网**：探测在无凭据时会立即以 MISSING_CREDENTIAL 收尾，
 * 因此每次尝试都是快速且确定的（不依赖上游、不消耗额度）。
 *
 * 这里刻意走**真实宿主入口**（`apply(ctx)` → 真实注册的路由 → 真实 handler），
 * 而不是直接调 retry.js：要验证的是「端点接线是否正确」——参数怎么传进引擎、
 * 记录怎么写进 RingBuffer、错误码与 HTTP 状态怎么落。
 * 引擎自身的时序语义（间隔 / 时长上限 / 假时钟）由 retry.test.mjs 覆盖。
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { apply, resolveConfig } from "../lib/index.js";

// ---------------------------------------------------------------------------
// fake cordis ctx：webServer 收路由；settings 同时提供 llm-pi-ai 与默认模型命名空间
// ---------------------------------------------------------------------------

function createFakeCtx({ providers = {}, defaultModel = undefined, defaultUser = undefined, writable = true } = {}) {
  const routes = new Map();
  const logs = [];
  const writes = [];
  const state = { defaultModel };

  const settings = {
    get(ns) {
      if (ns === "llm-pi-ai") return { providers };
      if (ns === "agent-default-model") return state.defaultModel;
      return undefined;
    },
    describe() {
      const d = { ns: "agent-default-model", value: state.defaultModel, revision: 1, applies: "live" };
      if (defaultUser !== undefined) d.user = defaultUser;
      return [d];
    },
    async replace(ns, section) {
      if (!writable) throw new Error("read-only provider");
      writes.push({ ns, section: JSON.parse(JSON.stringify(section)) });
      state.defaultModel = section;
    }
  };

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
      if (name === "settings") return settings;
      return undefined;
    },
    on() {},
    effect(fn) {
      return fn();
    }
  };
  return { ctx, routes, logs, writes, state };
}

/** 构造 fake req / res 并调用路由。 */
async function callRoute(routes, path, method, body) {
  const route = routes.get(path);
  assert.ok(route, `路由 ${path} 未注册`);
  const payload = body === undefined ? "" : JSON.stringify(body);
  const req = {
    method,
    url: path,
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
  await route.handler(req, res);
  return { ...captured, json: captured.body === "" ? null : JSON.parse(captured.body) };
}

/**
 * 轮询等待条件成立（无网络，通常几毫秒内满足）。
 *
 * 谓词可以是同步或异步（返回 Promise）。**必须 await 谓词结果**——
 * 直接 `if (fn())` 会让一个 async 谓词恒为真（Promise 对象本身是 truthy），
 * 于是「等待」变成「立即通过」，后续断言全部建立在尚未就绪的状态上。
 */
async function waitFor(fn, { timeoutMs = 5000, label = "条件" } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await fn()) return;
    if (Date.now() > deadline) throw new Error(`等待「${label}」超时（${timeoutMs}ms）`);
    await new Promise((r) => setTimeout(r, 5));
  }
}

const PROVIDERS = {
  "max66": {
    displayName: "max66",
    apiKeyEnv: "MAX66_API_KEY",
    api: "openai-completions",
    baseURL: "http://max66.xyz/v1",
    models: [
      { id: "deepseek-v4.1-flash", name: "deepseek-v4.1-flash", reasoningEfforts: { off: null, low: "low", max: "max" } },
      { id: "deepseek-v4-pro", name: "deepseek-v4-pro", reasoningEfforts: { low: "low" } }
    ]
  },
  "happycodeai": {
    displayName: "happycodeai",
    apiKeyEnv: "HAPPYCODEAI_API_KEY",
    api: "openai-completions",
    baseURL: "https://happycodeai.com/v1",
    models: [{ id: "gpt-image-2", name: "gpt-image-2" }]
  }
};

function boot(overrides = {}) {
  const fake = createFakeCtx({ providers: PROVIDERS, ...overrides });
  apply(fake.ctx, resolveConfig({}));
  return fake;
}

// ===========================================================================
// §18.7 重试三端点
// ===========================================================================

describe("重试端点契约（§18.7）", () => {
  test("三个端点全部注册；无会话时 status 返回 {active:false}", async () => {
    const { routes } = boot();
    assert.ok(routes.has("/api/model-health/retry/start"));
    assert.ok(routes.has("/api/model-health/retry/status"));
    assert.ok(routes.has("/api/model-health/retry/stop"));

    const out = await callRoute(routes, "/api/model-health/retry/status", "GET");
    assert.equal(out.status, 200);
    assert.equal(out.json.ok, true);
    assert.deepEqual(out.json.session, { active: false });
  });

  test("响应头符合 §11：json + charset + no-store", async () => {
    const { routes } = boot();
    const out = await callRoute(routes, "/api/model-health/retry/status", "GET");
    assert.equal(out.headers["content-type"], "application/json; charset=utf-8");
    assert.equal(out.headers["cache-control"], "no-store");
  });

  test("start 缺 routeKey/modelId → 400 BAD_REQUEST", async () => {
    const { routes } = boot();
    for (const bad of [{}, { routeKey: "max66" }, { modelId: "x" }, { routeKey: "", modelId: "x" }]) {
      const out = await callRoute(routes, "/api/model-health/retry/start", "POST", bad);
      assert.equal(out.status, 400, JSON.stringify(bad));
      assert.equal(out.json.error.code, "BAD_REQUEST");
    }
  });

  test("start 未知路由 → 404 UNKNOWN_ROUTE（启动前即拒绝，不进入重试循环）", async () => {
    const { routes } = boot();
    const out = await callRoute(routes, "/api/model-health/retry/start", "POST", {
      routeKey: "no-such-route",
      modelId: "m"
    });
    assert.equal(out.status, 404);
    assert.equal(out.json.error.code, "UNKNOWN_ROUTE");
  });

  test("start 路由不声明该模型 → 400 UNKNOWN_MODEL", async () => {
    const { routes } = boot();
    const out = await callRoute(routes, "/api/model-health/retry/start", "POST", {
      routeKey: "max66",
      modelId: "gpt-image-2"
    });
    assert.equal(out.status, 400);
    assert.equal(out.json.error.code, "UNKNOWN_MODEL");
  });

  test("start 非法参数（间隔 0.05）→ 400，且不产生任何尝试记录", async () => {
    const { routes } = boot();
    const out = await callRoute(routes, "/api/model-health/retry/start", "POST", {
      routeKey: "max66",
      modelId: "deepseek-v4.1-flash",
      intervalMinutes: 0.05,
      maxAttempts: 5
    });
    assert.equal(out.status, 400);
    assert.equal(out.json.error.code, "BAD_REQUEST");

    const rec = await callRoute(routes, "/api/model-health/records", "GET");
    assert.equal(rec.json.count, 0, "非法参数不得发起尝试");
  });

  test("★ start 成功 → 首次尝试立即执行并写入带 retry 上下文的记录", async () => {
    const { routes } = boot();
    const out = await callRoute(routes, "/api/model-health/retry/start", "POST", {
      routeKey: "max66",
      modelId: "deepseek-v4.1-flash",
      intervalMinutes: 1,
      maxAttempts: 1,
      maxDurationMinutes: 0
    });
    assert.equal(out.status, 200);
    assert.equal(out.json.ok, true);
    assert.equal(out.json.session.active, true);
    assert.equal(typeof out.json.session.sessionId, "string");
    assert.equal(out.json.session.params.mode, "strict");

    // maxAttempts=1 → 一次尝试后即结束（无等待）
    await waitFor(async () => {
      const s = await callRoute(routes, "/api/model-health/retry/status", "GET");
      return s.json.session.active === false;
    }, { label: "会话结束" });

    const again = await callRoute(routes, "/api/model-health/records", "GET");
    assert.equal(again.json.count, 1, "每次尝试恰好写一条记录");

    const record = again.json.records[0];
    assert.equal(record.retry.attempt, 1);
    assert.equal(record.retry.sessionId, out.json.session.sessionId);
    assert.equal(record.retry.isFinal, true, "达次数上限那次是最后一次");
    // 无凭据服务 → 该次尝试必然是 MISSING_CREDENTIAL 的失败结果（不发真实请求）
    assert.equal(record.status, "failed");
    assert.equal(record.error.code, "MISSING_CREDENTIAL");
    assert.equal(record.httpStatus, null, "未发出请求时不得有 HTTP 状态");
  });

  test("★ 在飞时重复 start → 409 RETRY_IN_FLIGHT，且旧 sessionId 不变", async () => {
    const { routes } = boot();
    const first = await callRoute(routes, "/api/model-health/retry/start", "POST", {
      routeKey: "max66",
      modelId: "deepseek-v4.1-flash",
      intervalMinutes: 1,
      maxAttempts: 0,
      maxDurationMinutes: 0
    });
    assert.equal(first.status, 200);
    const firstId = first.json.session.sessionId;

    const second = await callRoute(routes, "/api/model-health/retry/start", "POST", {
      routeKey: "happycodeai",
      modelId: "gpt-image-2",
      intervalMinutes: 1,
      maxAttempts: 5,
      maxDurationMinutes: 5
    });
    assert.equal(second.status, 409);
    assert.equal(second.json.error.code, "RETRY_IN_FLIGHT");

    const status = await callRoute(routes, "/api/model-health/retry/status", "GET");
    assert.equal(status.json.session.sessionId, firstId, "旧 sessionId 必须不变");
    assert.equal(status.json.session.target.routeKey, "max66", "不得被新目标替换");

    // 收尾：停掉，避免定时器泄漏到后续用例
    const stop = await callRoute(routes, "/api/model-health/retry/stop", "POST");
    assert.equal(stop.status, 200);
  });

  test("无会话时 stop → 409（不得静默成功）", async () => {
    const { routes } = boot();
    const out = await callRoute(routes, "/api/model-health/retry/stop", "POST");
    assert.equal(out.status, 409);
    assert.equal(out.json.error.code, "NO_ACTIVE_RETRY");
  });

  test("★ 等待期 stop → 200 且 stopReason=stopped-by-user；再次 stop 变 409", async () => {
    const { routes } = boot();
    const started = await callRoute(routes, "/api/model-health/retry/start", "POST", {
      routeKey: "max66",
      modelId: "deepseek-v4.1-flash",
      intervalMinutes: 5,
      maxAttempts: 0,
      maxDurationMinutes: 0
    });
    assert.equal(started.status, 200);
    // 等第 1 次尝试收尾（无凭据，很快）
    await waitFor(async () => {
      const s = await callRoute(routes, "/api/model-health/retry/status", "GET");
      return s.json.session.attemptStartedAt === null && s.json.session.attempts >= 1;
    }, { label: "第 1 次尝试收尾" });

    const stop = await callRoute(routes, "/api/model-health/retry/stop", "POST");
    assert.equal(stop.status, 200);
    assert.equal(stop.json.session.active, false);
    assert.equal(stop.json.session.stopReason, "stopped-by-user");

    const again = await callRoute(routes, "/api/model-health/retry/stop", "POST");
    assert.equal(again.status, 409, "已结束的会话不得再次 stop 成功");
  });

  test("status 能表达 §18.7 要求的全部字段", async () => {
    const { routes } = boot();
    await callRoute(routes, "/api/model-health/retry/start", "POST", {
      routeKey: "max66",
      modelId: "deepseek-v4.1-flash",
      mode: "connectivity",
      intervalMinutes: 2,
      maxAttempts: 9,
      maxDurationMinutes: 8
    });
    const out = await callRoute(routes, "/api/model-health/retry/status", "GET");
    const s = out.json.session;
    for (const key of ["active", "sessionId", "attempts", "nextAttemptAt", "mode", "params", "stopReason", "lastResult"]) {
      assert.ok(key in s, `status 缺少字段 ${key}`);
    }
    assert.equal(s.params.mode, "connectivity");
    assert.equal(s.params.intervalMinutes, 2);
    assert.equal(s.params.maxAttempts, 9);
    assert.equal(s.params.maxDurationMinutes, 8);
    await callRoute(routes, "/api/model-health/retry/stop", "POST");
  });

  test("mode 非法 → 400（互斥必选其一，无「都不选」态）", async () => {
    const { routes } = boot();
    const out = await callRoute(routes, "/api/model-health/retry/start", "POST", {
      routeKey: "max66",
      modelId: "deepseek-v4.1-flash",
      mode: "both"
    });
    assert.equal(out.status, 400);
    assert.match(out.json.error.message, /strict/);
  });

  test("请求体不是 JSON 对象 → 400 BAD_REQUEST", async () => {
    const { routes } = boot();
    const out = await callRoute(routes, "/api/model-health/retry/start", "POST", [1, 2, 3]);
    assert.equal(out.status, 400);
    assert.equal(out.json.error.code, "BAD_REQUEST");
  });

  test("★ 多尝试端到端：0.1 分钟间隔（最短）下第 2 次尝试确实发生", async () => {
    const { routes } = boot();
    const started = await callRoute(routes, "/api/model-health/retry/start", "POST", {
      routeKey: "max66",
      modelId: "deepseek-v4.1-flash",
      intervalMinutes: 0.1, // 6 秒（规格硬下限）
      maxAttempts: 2,
      maxDurationMinutes: 0
    });
    assert.equal(started.status, 200);

    // 这是本套件唯一的真实等待用例（约 6 秒）：验证「间隔调度 → 第 2 次尝试 → 达上限结束」
    // 这条完整链路真的会跑起来，而不是只验证第 1 次。
    await waitFor(async () => {
      const s = await callRoute(routes, "/api/model-health/retry/status", "GET");
      return s.json.session.active === false;
    }, { timeoutMs: 20000, label: "会话结束" });

    const status = await callRoute(routes, "/api/model-health/retry/status", "GET");
    assert.equal(status.json.session.attempts, 2, "必须真的发生 2 次尝试");
    assert.equal(status.json.session.stopReason, "max-attempts");

    const rec = await callRoute(routes, "/api/model-health/records", "GET");
    assert.equal(rec.json.count, 2, "两次尝试写两条记录");
    const attempts = rec.json.records.map((r) => r.retry.attempt).sort();
    assert.deepEqual(attempts, [1, 2]);
    assert.equal(rec.json.records[0].retry.isFinal, true, "最新一条是最后一次");
  });

  test("★ 卸载时停掉会话（不留定时器）", async () => {
    const fake = createFakeCtx({ providers: PROVIDERS });
    // effect 收集清理函数，模拟真实 cordis 生命周期
    const disposers = [];
    fake.ctx.effect = (fn) => {
      const d = fn();
      if (typeof d === "function") disposers.push(d);
      return d;
    };
    apply(fake.ctx, resolveConfig({}));

    // 先抓住 status 的 handler：teardown 会注销路由，之后再从 routes 取就拿不到了
    const statusRoute = fake.routes.get("/api/model-health/retry/status");
    assert.ok(statusRoute, "status 路由应已注册");
    const statusOf = async () => {
      const captured = { body: null };
      const res = { writeHead() {}, end: (c) => { captured.body = String(c); } };
      await statusRoute.handler({ method: "GET", url: "/", async *[Symbol.asyncIterator]() {} }, res);
      return JSON.parse(captured.body);
    };

    await callRoute(fake.routes, "/api/model-health/retry/start", "POST", {
      routeKey: "max66",
      modelId: "deepseek-v4.1-flash",
      intervalMinutes: 5,
      maxAttempts: 0,
      maxDurationMinutes: 0
    });
    // 倒序执行清理（cordis 语义）
    for (const d of disposers.reverse()) d();

    const after = await statusOf();
    assert.deepEqual(after.session, { active: false }, "卸载后不得残留会话");
  });
});

// ===========================================================================
// §19 默认模型端点 + /config 下发
// ===========================================================================

describe("默认模型端点与 /config 下发（§19）", () => {
  test("/config 含 defaultModel：可定位时带 selection", async () => {
    const { routes } = boot({
      defaultModel: { provider: "max66", model: "deepseek-v4.1-flash", reasoningEffort: "max" },
      defaultUser: { provider: "max66", model: "deepseek-v4.1-flash", reasoningEffort: "max" }
    });
    const out = await callRoute(routes, "/api/model-health/config", "GET");
    assert.equal(out.status, 200);
    const dm = out.json.defaultModel;
    assert.equal(dm.available, true);
    assert.equal(dm.provider, "max66");
    assert.equal(dm.model, "deepseek-v4.1-flash");
    assert.equal(dm.reasoningEffort, "max");
    assert.equal(dm.source, "user");
    assert.notEqual(dm.selection, null, "必须能定位到四层选择状态");
    assert.equal(dm.selection.routeKey, "max66");
  });

  test("/config 的 defaultModel.selection 自洽（AC23 不变式）", async () => {
    const { routes } = boot({ defaultModel: { provider: "happycodeai", model: "gpt-image-2" } });
    const out = await callRoute(routes, "/api/model-health/config", "GET");
    const sel = out.json.defaultModel.selection;
    const group = out.json.groups.find((g) => g.id === sel.groupId);
    const model = group.models.find((m) => m.modelKey === sel.modelKey);
    assert.equal(model.id, "gpt-image-2");
    assert.ok(model.routeKeys.includes(sel.routeKey));
  });

  test("/config 无默认模型时 available=false 且 selection=null（面板回落默认选择）", async () => {
    const { routes } = boot({ defaultModel: undefined });
    const out = await callRoute(routes, "/api/model-health/config", "GET");
    assert.equal(out.json.defaultModel.available, false);
    assert.equal(out.json.defaultModel.selection, null);
    assert.equal(typeof out.json.defaultModel.reason, "string");
  });

  test("/config 含 retryDefaults（面板据此初始化控件）", async () => {
    const { routes } = boot();
    const out = await callRoute(routes, "/api/model-health/config", "GET");
    assert.equal(out.json.retryDefaults.mode, "strict");
    assert.equal(out.json.retryDefaults.intervalMinutes, 1);
    assert.equal(out.json.retryDefaults.maxAttempts, 30);
    assert.equal(out.json.retryDefaults.maxDurationMinutes, 30);
    assert.equal(out.json.retryDefaults.unlimited, false);
  });

  test("/config 的 pluginVersion 来自 package.json（F-R-13）", async () => {
    const { routes } = boot();
    const out = await callRoute(routes, "/api/model-health/config", "GET");
    const pkg = JSON.parse((await import("node:fs")).readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    assert.equal(out.json.pluginVersion, pkg.version);
    assert.notEqual(out.json.pluginVersion, "0.1.0", "不得再是硬编码的 0.1.0");
  });

  test("★ POST /default 写入 agent-default-model 一节", async () => {
    const { routes, writes } = boot({ defaultModel: { provider: "old", model: "old" } });
    const out = await callRoute(routes, "/api/model-health/default", "POST", {
      routeKey: "max66",
      modelId: "deepseek-v4.1-flash"
    });
    assert.equal(out.status, 200);
    assert.equal(out.json.ok, true);
    assert.equal(writes.length, 1);
    assert.equal(writes[0].ns, "agent-default-model");
    assert.equal(writes[0].section.provider, "max66");
    assert.equal(writes[0].section.model, "deepseek-v4.1-flash");
    assert.equal(out.json.defaultModel.provider, "max66");
    assert.notEqual(out.json.defaultModel.selection, null);
  });

  test("★ effort 只在目标模型支持时才带上（不支持则丢弃，不写非法挡位）", async () => {
    // 当前默认 effort = max；目标 deepseek-v4-pro 只声明 low → 必须丢弃
    const { routes, writes } = boot({
      defaultModel: { provider: "max66", model: "deepseek-v4.1-flash", reasoningEffort: "max" },
      defaultUser: { provider: "max66", model: "deepseek-v4.1-flash", reasoningEffort: "max" }
    });
    const out = await callRoute(routes, "/api/model-health/default", "POST", {
      routeKey: "max66",
      modelId: "deepseek-v4-pro"
    });
    assert.equal(out.status, 200);
    assert.equal("reasoningEffort" in writes[0].section, false, "pro 不支持 max，必须丢弃");
    assert.equal(out.json.written.reasoningEffort, undefined);
  });

  test("★ effort 受支持时保留（同模型换路由不丢挡位）", async () => {
    const { routes, writes } = boot({
      defaultModel: { provider: "max66", model: "deepseek-v4-pro", reasoningEffort: "low" },
      defaultUser: { provider: "max66", model: "deepseek-v4-pro", reasoningEffort: "low" }
    });
    await callRoute(routes, "/api/model-health/default", "POST", {
      routeKey: "max66",
      modelId: "deepseek-v4.1-flash"
    });
    assert.equal(writes[0].section.reasoningEffort, "low", "目标模型支持 low 时应保留");
  });

  test("POST /default 未知路由 / 未声明模型 → 404 / 400，且不写入", async () => {
    const { routes, writes } = boot({ defaultModel: { provider: "old", model: "old" } });
    const a = await callRoute(routes, "/api/model-health/default", "POST", { routeKey: "nope", modelId: "m" });
    assert.equal(a.status, 404);
    const b = await callRoute(routes, "/api/model-health/default", "POST", { routeKey: "max66", modelId: "gpt-image-2" });
    assert.equal(b.status, 400);
    assert.equal(writes.length, 0, "非法目标不得写入默认模型");
  });

  test("POST /default 缺字段 → 400；settings 不可写 → 5xx（不谎报成功）", async () => {
    const { routes } = boot();
    const bad = await callRoute(routes, "/api/model-health/default", "POST", { routeKey: "max66" });
    assert.equal(bad.status, 400);

    const ro = boot({ defaultModel: {}, writable: false });
    const denied = await callRoute(ro.routes, "/api/model-health/default", "POST", {
      routeKey: "max66",
      modelId: "deepseek-v4.1-flash"
    });
    assert.equal(denied.status, 500);
    assert.equal(denied.json.error.code, "SETTINGS_WRITE_FAILED");
  });

  test("★ 默认模型端点只写默认模型一节，绝不碰 llm-pi-ai（配置只读不变式 AC19）", async () => {
    const { routes, writes } = boot({ defaultModel: {} });
    await callRoute(routes, "/api/model-health/default", "POST", {
      routeKey: "max66",
      modelId: "deepseek-v4.1-flash"
    });
    assert.equal(writes.length, 1);
    assert.equal(writes[0].ns, "agent-default-model");
    assert.ok(!writes.some((w) => w.ns === "llm-pi-ai"), "不得写入 llm-pi-ai");
  });
});
