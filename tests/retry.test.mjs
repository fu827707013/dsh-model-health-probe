/**
 * 自动重试会话的验收用例（SPEC §18 / R29–R33 / AC24–AC27）。
 *
 * 本文件**不联网**：所有尝试由注入的假 runAttempt 产生，时间由假时钟推进，
 * 因此每个用例都是完全确定性的（不依赖真实 sleep，不依赖上游）。
 *
 * 覆盖矩阵：
 *   - AC24 两种成功判定模式（严格 / 连通）× {OK, OK！, ok, 空, 500}
 *   - AC25 参数域（0.1 合法 / 0.05 非法 / 一位小数 / 0=不限 / unlimited 标志）
 *   - AC26 停止条件穷举 4 条 + 致命错误 401/403/404/400 不短路 + 结束后不自动重启
 *   - AC27 并发约束（重复 start 409 + RETRY_IN_FLIGHT、旧 sessionId 不变、stop 无会话 409、
 *          status 无会话 {active:false}）
 *   - §18.3 每次尝试都写记录 + attempt/sessionId/isFinal 上下文 + isFinal 补记
 *   - §18.5 条件 4 手动停止必须中断在飞请求（abort 真实触发）
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  createRetryManager,
  validateRetryParams,
  isAttemptSuccessful,
  DEFAULT_RETRY,
  MIN_INTERVAL_MINUTES
} from "../lib/retry.js";

// ---------------------------------------------------------------------------
// 假时钟：让「间隔 / 时长上限」的用例确定且瞬时
// ---------------------------------------------------------------------------

function createClock() {
  let current = 0;
  let seq = 0;
  /** @type {Map<number, {fn:Function, at:number}>} */
  const timers = new Map();

  return {
    now: () => current,
    setTimer: (fn, ms) => {
      const id = ++seq;
      timers.set(id, { fn, at: current + ms });
      return id;
    },
    clearTimer: (id) => {
      timers.delete(id);
    },
    get pending() {
      return timers.size;
    },
    /** 推进到下一个到期定时器并触发它（无定时器则不动）。 */
    async fireNext() {
      if (timers.size === 0) return false;
      let bestId = null;
      let bestAt = Infinity;
      for (const [id, t] of timers) {
        if (t.at < bestAt) {
          bestAt = t.at;
          bestId = id;
        }
      }
      const t = timers.get(bestId);
      timers.delete(bestId);
      current = Math.max(current, t.at);
      t.fn();
      await settle();
      return true;
    },
    /** 只推进时间，不触发任何定时器（用于构造「时长已过」）。 */
    advance(ms) {
      current += ms;
    }
  };
}

/** 冲干净微任务：runAttempt 是 async，runOne 里的 await 需要几轮 tick 才落地。 */
async function settle(rounds = 8) {
  for (let i = 0; i < rounds; i += 1) await Promise.resolve();
}

// ---------------------------------------------------------------------------
// TestResult 构造器：只填判定需要的字段，形态与 §12.1 同构
// ---------------------------------------------------------------------------

function makeResult({ status = "healthy", httpStatus = 200, modelLayer = "pass", text = "OK" } = {}) {
  const apiLayer = httpStatus !== null && httpStatus >= 200 && httpStatus < 300 ? "pass" : "fail";
  return {
    pluginVersion: "test",
    startedAt: 0,
    finishedAt: 0,
    latencyMs: 10,
    ttftMs: null,
    status,
    reasons: status === "slow" ? ["strict-mismatch"] : [],
    target: { routeKey: "r1", displayName: "r1", modelId: "m1", stream: false },
    httpStatus,
    httpStatusText: null,
    requestHeaders: null,
    requestBodyPreview: null,
    responseText: text,
    responseRaw: null,
    truncated: false,
    finishReason: "stop",
    usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2, cacheReadTokens: null, cacheWriteTokens: null, totalComputed: false },
    usageSource: "body",
    sseEventCount: null,
    sseEventTypes: null,
    layers: {
      api: { status: apiLayer, label: "API 请求", detail: "", code: null },
      model: { status: modelLayer, label: "模型响应", detail: "", code: null },
      strict: { status: status === "healthy" ? "pass" : "fail", label: "严格校验", detail: "", code: null }
    },
    error: null
  };
}

/** 造一个受控的 manager：attempts 为按次序返回的结果数组（元素可为 "throw" 或 Promise）。 */
function makeManager({ results, clock, onAttempt, onSessionEnd }) {
  let idx = 0;
  const calls = [];
  const manager = createRetryManager({
    runAttempt: async ({ target, attempt, sessionId, signal }) => {
      calls.push({ target, attempt, sessionId, aborted: signal.aborted });
      const spec = typeof results === "function" ? results(attempt, calls.length) : results[idx++];
      if (spec === "throw") throw new Error("boom");
      if (typeof spec === "function") return spec({ signal, attempt });
      return spec;
    },
    onAttempt,
    onSessionEnd,
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    newSessionId: (() => {
      let n = 0;
      return () => "sess-" + ++n;
    })()
  });
  return { manager, calls };
}

const TARGET = { routeKey: "r1", modelId: "m1", stream: false };

// ===========================================================================
// AC25 参数域（§18.4）
// ===========================================================================

describe("AC25 重试参数域（§18.4）", () => {
  test("间隔 0.1 合法；0.05 非法（低于硬下限）", () => {
    const ok = validateRetryParams({ intervalMinutes: 0.1 });
    assert.equal(ok.ok, true);
    assert.equal(ok.params.intervalMinutes, 0.1);

    const bad = validateRetryParams({ intervalMinutes: 0.05 });
    assert.equal(bad.ok, false);
    assert.equal(bad.code, "BAD_REQUEST");
    assert.match(bad.message, /0\.1/);
  });

  test("间隔多于一位小数非法（0.15 / 0.25）——但 0.2 / 0.5 / 2.5 合法", () => {
    for (const v of [0.15, 0.25, 1.23]) {
      assert.equal(validateRetryParams({ intervalMinutes: v }).ok, false, `${v} 应非法`);
    }
    for (const v of [0.1, 0.2, 0.5, 1, 2.5, 30]) {
      assert.equal(validateRetryParams({ intervalMinutes: v }).ok, true, `${v} 应合法`);
    }
  });

  test("浮点陷阱：0.3 与 0.7 必须判合法（不能因 IEEE754 余数误判）", () => {
    assert.equal(validateRetryParams({ intervalMinutes: 0.3 }).ok, true);
    assert.equal(validateRetryParams({ intervalMinutes: 0.7 }).ok, true);
  });

  test("最大次数接受 0（=不限）与非负整数；负数/小数非法", () => {
    assert.equal(validateRetryParams({ maxAttempts: 0 }).ok, true);
    assert.equal(validateRetryParams({ maxAttempts: 5 }).ok, true);
    assert.equal(validateRetryParams({ maxAttempts: -1 }).ok, false);
    assert.equal(validateRetryParams({ maxAttempts: 1.5 }).ok, false);
  });

  test("最长时长接受 0（=不限）与一位小数；多于一位小数非法", () => {
    assert.equal(validateRetryParams({ maxDurationMinutes: 0 }).ok, true);
    assert.equal(validateRetryParams({ maxDurationMinutes: 2.5 }).ok, true);
    assert.equal(validateRetryParams({ maxDurationMinutes: 2.55 }).ok, false);
  });

  test("两者同时为 0 → unlimited 标志为真（面板据此显示可见文本提示）", () => {
    const out = validateRetryParams({ maxAttempts: 0, maxDurationMinutes: 0 });
    assert.equal(out.ok, true);
    assert.equal(out.params.unlimited, true);

    const one = validateRetryParams({ maxAttempts: 0, maxDurationMinutes: 30 });
    assert.equal(one.params.unlimited, false);
  });

  test("mode 互斥必选：strict / connectivity 合法，其它值非法", () => {
    assert.equal(validateRetryParams({ mode: "strict" }).ok, true);
    assert.equal(validateRetryParams({ mode: "connectivity" }).ok, true);
    assert.equal(validateRetryParams({ mode: "both" }).ok, false);
    assert.equal(validateRetryParams({ mode: "" }).ok, false);
  });

  test("缺省值 = 严格模式 / 1 分钟 / 30 次 / 30 分钟（§18.4 默认列）", () => {
    const out = validateRetryParams({});
    assert.equal(out.ok, true);
    assert.equal(out.params.mode, "strict");
    assert.equal(out.params.intervalMinutes, DEFAULT_RETRY.intervalMinutes);
    assert.equal(out.params.maxAttempts, DEFAULT_RETRY.maxAttempts);
    assert.equal(out.params.maxDurationMinutes, DEFAULT_RETRY.maxDurationMinutes);
    assert.equal(MIN_INTERVAL_MINUTES, 0.1);
  });
});

// ===========================================================================
// AC24 两种成功判定模式（§18.2）
// ===========================================================================

describe("AC24 成功判定模式（§18.2）", () => {
  test("严格模式：healthy 算成功；slow / failed 不算", () => {
    assert.equal(isAttemptSuccessful("strict", makeResult({ status: "healthy" })), true);
    assert.equal(isAttemptSuccessful("strict", makeResult({ status: "slow", httpStatus: 200, modelLayer: "pass" })), false);
    assert.equal(isAttemptSuccessful("strict", makeResult({ status: "failed", httpStatus: 500, modelLayer: "fail" })), false);
  });

  test("★ 严格模式：仅 HTTP 200 但内容不符（slow）不得判成功（反例）", () => {
    // 这是 AC24 明确要求的反例：HTTP 2xx 本身不是严格模式的成功依据
    const slow = makeResult({ status: "slow", httpStatus: 200, modelLayer: "pass", text: "OK！" });
    assert.equal(slow.httpStatus, 200);
    assert.equal(isAttemptSuccessful("strict", slow), false);
  });

  test("连通模式：HTTP 200 且模型层 pass 即成功——即使内容是 OK！/ ok / 任意文本", () => {
    for (const text of ["OK！", "ok", "随便什么内容"]) {
      const r = makeResult({ status: "slow", httpStatus: 200, modelLayer: "pass", text });
      assert.equal(isAttemptSuccessful("connectivity", r), true, `${text} 应算连通`);
    }
  });

  test("连通模式：slow 算成功（耗时只影响状态徽标，§18.2 判据补充）", () => {
    const r = makeResult({ status: "slow", httpStatus: 200, modelLayer: "pass" });
    assert.equal(isAttemptSuccessful("connectivity", r), true);
    assert.equal(isAttemptSuccessful("strict", r), false);
  });

  test("连通模式：HTTP 500 不成功（即便模型层被标 pass）", () => {
    const r = makeResult({ status: "failed", httpStatus: 500, modelLayer: "pass" });
    assert.equal(isAttemptSuccessful("connectivity", r), false);
  });

  test("连通模式：HTTP 2xx 但模型层非 pass 不成功（响应体解析失败）", () => {
    const r = makeResult({ status: "failed", httpStatus: 200, modelLayer: "fail" });
    assert.equal(isAttemptSuccessful("connectivity", r), false);
  });

  test("两模式判据不混用：同一结果在两种模式下结论可不同（证明模式真的生效）", () => {
    const r = makeResult({ status: "slow", httpStatus: 200, modelLayer: "pass" });
    assert.notEqual(isAttemptSuccessful("strict", r), isAttemptSuccessful("connectivity", r));
  });

  test("null / 畸形结果一律不成功（不抛异常）", () => {
    assert.equal(isAttemptSuccessful("strict", null), false);
    assert.equal(isAttemptSuccessful("connectivity", undefined), false);
    assert.equal(isAttemptSuccessful("connectivity", { httpStatus: null, layers: null }), false);
  });
});

// ===========================================================================
// AC26 停止条件穷举 4 条（§18.5）
// ===========================================================================

describe("AC26 停止条件（§18.5）", () => {
  test("条件 1：成功 → stopReason=success，且该次即最后一次（不再排新尝试）", async () => {
    const clock = createClock();
    const ends = [];
    const attempts = [];
    const { manager } = makeManager({
      clock,
      results: [makeResult({ status: "failed", httpStatus: 500, modelLayer: "fail" }), makeResult({ status: "healthy" })],
      onAttempt: (r, m) => attempts.push(m),
      onSessionEnd: (i) => ends.push(i)
    });

    const out = manager.start({ target: TARGET, params: { intervalMinutes: 0.1, maxAttempts: 10, maxDurationMinutes: 0 } });
    assert.equal(out.ok, true);
    await settle();
    assert.equal(attempts.length, 1);
    assert.equal(attempts[0].success, false);
    assert.equal(attempts[0].isFinal, false);

    await clock.fireNext(); // 第 2 次尝试 → 成功
    assert.equal(attempts.length, 2);
    assert.equal(attempts[1].success, true);
    assert.equal(attempts[1].isFinal, true, "成功那次必须是最后一次");

    assert.equal(ends.length, 1);
    assert.equal(ends[0].stopReason, "success");
    assert.equal(clock.pending, 0, "成功后不得再排尝试");
    assert.equal(manager.status().active, false);
  });

  test("条件 2：达次数上限 → max-attempts，尝试次数恰等于上限", async () => {
    const clock = createClock();
    const attempts = [];
    const ends = [];
    const { manager } = makeManager({
      clock,
      results: () => makeResult({ status: "failed", httpStatus: 500, modelLayer: "fail" }),
      onAttempt: (r, m) => attempts.push(m),
      onSessionEnd: (i) => ends.push(i)
    });

    manager.start({ target: TARGET, params: { intervalMinutes: 0.1, maxAttempts: 3, maxDurationMinutes: 0 } });
    await settle();
    await clock.fireNext();
    await clock.fireNext();

    assert.equal(attempts.length, 3, "恰好 3 次，不多不少");
    assert.equal(attempts[2].isFinal, true, "达上限那次是最后一次");
    assert.equal(ends.length, 1);
    assert.equal(ends[0].stopReason, "max-attempts");
    assert.equal(ends[0].attempts, 3);
    assert.equal(clock.pending, 0);
  });

  test("条件 3：达时长上限 → max-duration（等待期到期也能收口）", async () => {
    const clock = createClock();
    const ends = [];
    const attempts = [];
    const { manager } = makeManager({
      clock,
      results: () => makeResult({ status: "failed", httpStatus: 500, modelLayer: "fail" }),
      onAttempt: (r, m) => attempts.push(m),
      onSessionEnd: (i) => ends.push(i)
    });

    // 间隔 2 分钟、时长上限 3 分钟：
    //   t=0    第 1 次尝试（立即）
    //   t=2min 第 2 次尝试（仍在 3 分钟窗口内，合法）
    //   t=3min 到期 → max-duration，不再发起第 3 次
    manager.start({ target: TARGET, params: { intervalMinutes: 2, maxAttempts: 0, maxDurationMinutes: 3 } });
    await settle();
    assert.equal(attempts.length, 1);

    await clock.fireNext(); // t=2min：第 2 次尝试
    assert.equal(attempts.length, 2, "3 分钟窗口内的第 2 次尝试是合法的");
    assert.equal(ends.length, 0);

    await clock.fireNext(); // t=3min：到期
    assert.equal(attempts.length, 2, "到期后不得再发起尝试");
    assert.equal(ends.length, 1);
    assert.equal(ends[0].stopReason, "max-duration");
    assert.equal(clock.pending, 0);
  });

  test("条件 3：时长上限在「等待期」到期时也能及时收口（不越界发起新尝试）", async () => {
    const clock = createClock();
    const ends = [];
    const attempts = [];
    const { manager } = makeManager({
      clock,
      results: () => makeResult({ status: "failed", httpStatus: 500, modelLayer: "fail" }),
      onAttempt: (r, m) => attempts.push(m),
      onSessionEnd: (i) => ends.push(i)
    });

    // 间隔 10 分钟 > 时长上限 3 分钟：等待被夹到剩余 3 分钟，到期即结束，只发生 1 次尝试
    manager.start({ target: TARGET, params: { intervalMinutes: 10, maxAttempts: 0, maxDurationMinutes: 3 } });
    await settle();
    assert.equal(attempts.length, 1);

    await clock.fireNext(); // t=3min：到期
    assert.equal(attempts.length, 1, "越界的那次尝试不得被发起");
    assert.equal(ends.length, 1);
    assert.equal(ends[0].stopReason, "max-duration");
    assert.equal(clock.pending, 0);
  });

  test("条件 3 的 isFinal 补记：needsFinalMark 为真（写记录时无法预知）", async () => {
    const clock = createClock();
    const ends = [];
    const { manager } = makeManager({
      clock,
      results: () => makeResult({ status: "failed", httpStatus: 500, modelLayer: "fail" }),
      onSessionEnd: (i) => ends.push(i)
    });
    manager.start({ target: TARGET, params: { intervalMinutes: 1, maxAttempts: 0, maxDurationMinutes: 1 } });
    await settle();
    await clock.fireNext();
    assert.equal(ends.length, 1);
    assert.equal(ends[0].stopReason, "max-duration");
    assert.equal(ends[0].needsFinalMark, true, "时长上限须事后补记 isFinal");
  });

  test("条件 4：等待期手动停止 → stopped-by-user，且不再有尝试", async () => {
    const clock = createClock();
    const ends = [];
    const attempts = [];
    const { manager } = makeManager({
      clock,
      results: () => makeResult({ status: "failed", httpStatus: 500, modelLayer: "fail" }),
      onAttempt: (r, m) => attempts.push(m),
      onSessionEnd: (i) => ends.push(i)
    });

    manager.start({ target: TARGET, params: { intervalMinutes: 5, maxAttempts: 0, maxDurationMinutes: 0 } });
    await settle();
    assert.equal(attempts.length, 1);

    const out = manager.stop();
    assert.equal(out.ok, true);
    assert.equal(ends.length, 1);
    assert.equal(ends[0].stopReason, "stopped-by-user");
    assert.equal(ends[0].needsFinalMark, true, "等待期停止须补记 isFinal");
    assert.equal(clock.pending, 0, "停止后不得再有定时器");

    await clock.fireNext();
    assert.equal(attempts.length, 1, "停止后不得再发起尝试");
  });

  test("★ 条件 4 必须中断在飞请求：stop 触发 abort，那次尝试记为已中止且不计成功", async () => {
    const clock = createClock();
    const ends = [];
    const attempts = [];
    let sawAbort = false;

    const { manager } = makeManager({
      clock,
      // 这次尝试永不自行结束——只有 abort 能让它返回
      results: () => ({ signal }) =>
        new Promise((resolve) => {
          signal.addEventListener("abort", () => {
            sawAbort = true;
            resolve(makeResult({ status: "failed", httpStatus: null, modelLayer: "skip" }));
          });
        }),
      onAttempt: (r, m) => attempts.push(m),
      onSessionEnd: (i) => ends.push(i)
    });

    manager.start({ target: TARGET, params: { intervalMinutes: 5, maxAttempts: 0, maxDurationMinutes: 0 } });
    await settle();
    assert.equal(attempts.length, 0, "在飞中，尚无记录");
    assert.equal(manager.status().attemptStartedAt !== null, true, "status 应显示在飞");

    manager.stop();
    await settle();
    await settle();

    assert.equal(sawAbort, true, "stop 必须真实触发 abort");
    assert.equal(attempts.length, 1, "被中止的那次也要落一条记录");
    assert.equal(attempts[0].aborted, true);
    assert.equal(attempts[0].success, false);
    assert.equal(attempts[0].isFinal, true);
    assert.equal(ends.length, 1);
    assert.equal(ends[0].stopReason, "stopped-by-user");
  });

  test("★ 致命错误不短路：401/403/404/400 持续返回时继续重试到次数上限", async () => {
    for (const status of [401, 403, 404, 400]) {
      const clock = createClock();
      const attempts = [];
      const ends = [];
      const { manager } = makeManager({
        clock,
        results: () => makeResult({ status: "failed", httpStatus: status, modelLayer: "skip" }),
        onAttempt: (r, m) => attempts.push(m),
        onSessionEnd: (i) => ends.push(i)
      });
      manager.start({ target: TARGET, params: { intervalMinutes: 0.1, maxAttempts: 4, maxDurationMinutes: 0 } });
      await settle();
      for (let i = 0; i < 3; i += 1) await clock.fireNext();

      assert.equal(attempts.length, 4, `HTTP ${status} 必须重试到上限，而不是提前结束`);
      assert.equal(ends.length, 1);
      assert.equal(ends[0].stopReason, "max-attempts", `HTTP ${status} 不得短路`);
      assert.equal(manager.status().stopReason, "max-attempts");
    }
  });

  test("会话结束后不自动重启：结束态稳定，不会被任何 tick 复活", async () => {
    const clock = createClock();
    const attempts = [];
    const { manager } = makeManager({
      clock,
      results: () => makeResult({ status: "healthy" }),
      onAttempt: (r, m) => attempts.push(m)
    });
    manager.start({ target: TARGET, params: { intervalMinutes: 0.1, maxAttempts: 10, maxDurationMinutes: 0 } });
    await settle();
    assert.equal(attempts.length, 1);
    assert.equal(manager.status().active, false);

    // 多轮 tick：不应有任何新尝试
    for (let i = 0; i < 5; i += 1) await clock.fireNext();
    assert.equal(attempts.length, 1, "结束后不得自动重启");
    assert.equal(clock.pending, 0);
  });

  test("首次尝试立即执行，不等间隔（§18.4）", async () => {
    const clock = createClock();
    const attempts = [];
    const { manager } = makeManager({
      clock,
      results: () => makeResult({ status: "failed", httpStatus: 500, modelLayer: "fail" }),
      onAttempt: (r, m) => attempts.push(m)
    });
    manager.start({ target: TARGET, params: { intervalMinutes: 10, maxAttempts: 0, maxDurationMinutes: 0 } });
    await settle();
    // 时钟未推进，第 1 次尝试已经发生
    assert.equal(attempts.length, 1);
    assert.equal(clock.now(), 0, "首次尝试不得先等待间隔");
  });
});

// ===========================================================================
// AC27 并发约束（§18.6）
// ===========================================================================

describe("AC27 重试并发约束（§18.6）", () => {
  test("在飞时重复 start → 409 + RETRY_IN_FLIGHT，且旧 sessionId 不变（不替换、不排队）", async () => {
    const clock = createClock();
    const { manager } = makeManager({
      clock,
      results: () => makeResult({ status: "failed", httpStatus: 500, modelLayer: "fail" })
    });
    const first = manager.start({ target: TARGET, params: { intervalMinutes: 5, maxAttempts: 0, maxDurationMinutes: 0 } });
    await settle();
    const firstId = first.status.sessionId;

    const second = manager.start({ target: { routeKey: "r2", modelId: "m2" }, params: { intervalMinutes: 1 } });
    assert.equal(second.ok, false);
    assert.equal(second.httpStatus, 409);
    assert.equal(second.code, "RETRY_IN_FLIGHT");

    // 旧会话完好：sessionId 未变、目标未变、仍在飞
    const status = manager.status();
    assert.equal(status.sessionId, firstId, "旧 sessionId 必须不变");
    assert.equal(status.active, true);
    assert.equal(status.target.routeKey, "r1", "不得被新目标替换");
  });

  test("无会话时 stop → 409（不得静默成功）", () => {
    const clock = createClock();
    const { manager } = makeManager({ clock, results: [] });
    const out = manager.stop();
    assert.equal(out.ok, false);
    assert.equal(out.httpStatus, 409);
    assert.equal(out.code, "NO_ACTIVE_RETRY");
  });

  test("会话结束后 stop 同样 409（会话已不在飞）", async () => {
    const clock = createClock();
    const { manager } = makeManager({ clock, results: () => makeResult({ status: "healthy" }) });
    manager.start({ target: TARGET, params: { intervalMinutes: 1, maxAttempts: 1, maxDurationMinutes: 0 } });
    await settle();
    assert.equal(manager.status().active, false);
    assert.equal(manager.stop().httpStatus, 409);
  });

  test("无会话时 status → {active:false}（§18.7）", () => {
    const clock = createClock();
    const { manager } = makeManager({ clock, results: [] });
    assert.deepEqual(manager.status(), { active: false });
  });

  test("status 能表达：是否在飞 / sessionId / 已尝试次数 / 下次尝试时间 / 模式 / 三参数", async () => {
    const clock = createClock();
    const { manager } = makeManager({
      clock,
      results: () => makeResult({ status: "failed", httpStatus: 500, modelLayer: "fail" })
    });
    manager.start({
      target: TARGET,
      params: { mode: "connectivity", intervalMinutes: 2, maxAttempts: 7, maxDurationMinutes: 9 }
    });
    await settle();

    const s = manager.status();
    assert.equal(s.active, true);
    assert.equal(typeof s.sessionId, "string");
    assert.equal(s.attempts, 1);
    assert.equal(typeof s.nextAttemptAt, "number");
    assert.equal(s.mode, "connectivity");
    assert.equal(s.params.intervalMinutes, 2);
    assert.equal(s.params.maxAttempts, 7);
    assert.equal(s.params.maxDurationMinutes, 9);
    assert.equal(s.params.unlimited, false);
  });

  test("结束后 status 带 stopReason / stoppedAt / lastResult（面板据此答「第几次成功」）", async () => {
    const clock = createClock();
    const { manager } = makeManager({
      clock,
      results: [makeResult({ status: "failed", httpStatus: 500, modelLayer: "fail" }), makeResult({ status: "healthy" })]
    });
    manager.start({ target: TARGET, params: { intervalMinutes: 0.1, maxAttempts: 5, maxDurationMinutes: 0 } });
    await settle();
    await clock.fireNext();

    const s = manager.status();
    assert.equal(s.active, false);
    assert.equal(s.stopReason, "success");
    assert.equal(s.attempts, 2);
    assert.equal(typeof s.stoppedAt, "number");
    assert.equal(s.lastResult.status, "healthy");
    assert.equal(s.nextAttemptAt, null);
  });
});

// ===========================================================================
// §18.3 每次尝试的记录规则 + 其它健壮性
// ===========================================================================

describe("重试记录与健壮性（§18.3）", () => {
  test("每次尝试都回调一次（不合并、不覆盖）——3 次失败即 3 条", async () => {
    const clock = createClock();
    const seen = [];
    const { manager } = makeManager({
      clock,
      results: () => makeResult({ status: "failed", httpStatus: 500, modelLayer: "fail" }),
      onAttempt: (r, m) => seen.push({ status: r.status, attempt: m.attempt, sessionId: m.sessionId })
    });
    manager.start({ target: TARGET, params: { intervalMinutes: 0.1, maxAttempts: 3, maxDurationMinutes: 0 } });
    await settle();
    await clock.fireNext();
    await clock.fireNext();

    assert.equal(seen.length, 3);
    assert.deepEqual(seen.map((x) => x.attempt), [1, 2, 3], "attempt 从 1 起递增");
    assert.equal(new Set(seen.map((x) => x.sessionId)).size, 1, "同一会话 sessionId 一致");
  });

  test("runAttempt 抛异常不炸会话：记为一次失败尝试并继续", async () => {
    const clock = createClock();
    const seen = [];
    const ends = [];
    const { manager } = makeManager({
      clock,
      results: ["throw", "throw", makeResult({ status: "healthy" })],
      onAttempt: (r, m) => seen.push({ result: r, meta: m }),
      onSessionEnd: (i) => ends.push(i)
    });
    manager.start({ target: TARGET, params: { intervalMinutes: 0.1, maxAttempts: 5, maxDurationMinutes: 0 } });
    await settle();
    await clock.fireNext();
    await clock.fireNext();

    assert.equal(seen.length, 3);
    assert.equal(seen[0].result, null, "抛异常那次结果为 null");
    assert.equal(seen[2].meta.success, true);
    assert.equal(ends[0].stopReason, "success");
  });

  test("dispose 会中止在飞请求并清掉定时器（插件卸载不留后患）", async () => {
    const clock = createClock();
    let aborted = false;
    const { manager } = makeManager({
      clock,
      results: () => ({ signal }) =>
        new Promise((resolve) => {
          signal.addEventListener("abort", () => {
            aborted = true;
            resolve(makeResult({ status: "failed", httpStatus: null, modelLayer: "skip" }));
          });
        })
    });
    manager.start({ target: TARGET, params: { intervalMinutes: 1, maxAttempts: 0, maxDurationMinutes: 0 } });
    await settle();
    manager.dispose();
    await settle();
    assert.equal(aborted, true, "dispose 必须中止在飞请求");
    assert.equal(clock.pending, 0, "dispose 后不得残留定时器");
    assert.deepEqual(manager.status(), { active: false });
  });

  test("start 参数非法时不进入重试循环（§18.5 末条例外）", async () => {
    const clock = createClock();
    const calls = [];
    const { manager, calls: attemptCalls } = makeManager({ clock, results: [] });
    const out = manager.start({ target: TARGET, params: { intervalMinutes: 0.01 } });
    assert.equal(out.ok, false);
    assert.equal(out.httpStatus, 400);
    assert.equal(out.code, "BAD_REQUEST");
    assert.equal(attemptCalls.length, 0, "非法参数不得发起任何尝试");
    assert.equal(manager.status().active, false);
    void calls;
  });

  test("start 缺 target 时 400（不抛异常）", () => {
    const clock = createClock();
    const { manager } = makeManager({ clock, results: [] });
    const out = manager.start({ params: {} });
    assert.equal(out.ok, false);
    assert.equal(out.httpStatus, 400);
  });
});
