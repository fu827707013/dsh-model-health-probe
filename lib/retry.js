/**
 * 自动重试会话引擎（SPEC §18 / R29–R33）。
 *
 * 定位：用户显式启动后，按固定间隔反复测试**同一目标**，直到成功或触发停止条件。
 * 它**不是**后台常驻监控：单例运行、成功即停、结束不自动重启（§18.1 / §18.5）。
 *
 * 与单次测试的关系（§18.1 末段）：每一次尝试**就是**一次完整的单次测试——复用同一套
 * 探测实现、同一状态机、同一错误映射、同一条记录写入路径。本模块**不引入**新的协议
 * 行为、新的请求构造逻辑；它只负责「何时再试一次」与「何时停」。
 *
 * 本模块是纯调度逻辑：不碰网络、不碰 settings、不碰 RingBuffer。
 * 所有副作用经注入的 runAttempt / onAttempt / onSessionEnd 回调外置，
 * 因此可用假时钟做完全确定性的测试。
 */

/** 两种成功判定模式（§18.2，互斥且必选其一，无「都不选」态）。 */
export const RETRY_MODES = new Set(["strict", "connectivity"]);

/** 参数默认值与域（§18.4）。 */
export const DEFAULT_RETRY = {
  mode: "strict",
  intervalMinutes: 1,
  maxAttempts: 30,
  maxDurationMinutes: 30
};

/** 间隔硬下限（分钟）：0.1 分钟 = 6 秒（§18.4「参数域硬要求」第 1 条）。 */
export const MIN_INTERVAL_MINUTES = 0.1;

/** 停止原因（§18.5 穷举 4 条，四条之外没有其它结束路径）。 */
export const STOP_REASONS = new Set(["success", "max-attempts", "max-duration", "stopped-by-user"]);

/**
 * 一位小数校验：`0.5` 合法、`0.05` 非法（多于一位小数）。
 * 用整数化比较而非浮点 `%`——`0.3 % 0.1` 在 IEEE754 下不为 0，会误判合法值。
 */
function hasAtMostOneDecimal(n) {
  return Math.abs(n * 10 - Math.round(n * 10)) < 1e-9;
}

/**
 * 参数校验（§18.4）。**启动前**即拒绝非法参数，不进入重试循环（§18.5 末条例外）。
 *
 * @returns {{ok:true, params:object} | {ok:false, code:string, message:string}}
 */
export function validateRetryParams(input) {
  const raw = input === null || input === undefined || typeof input !== "object" ? {} : input;

  const mode = raw.mode === undefined || raw.mode === null ? DEFAULT_RETRY.mode : raw.mode;
  if (typeof mode !== "string" || !RETRY_MODES.has(mode)) {
    return {
      ok: false,
      code: "BAD_REQUEST",
      message: `mode 必须是 "strict" 或 "connectivity"（当前：${JSON.stringify(raw.mode)}）`
    };
  }

  const interval = raw.intervalMinutes === undefined || raw.intervalMinutes === null ? DEFAULT_RETRY.intervalMinutes : raw.intervalMinutes;
  if (typeof interval !== "number" || !Number.isFinite(interval)) {
    return { ok: false, code: "BAD_REQUEST", message: "intervalMinutes 必须是数字（单位：分钟）" };
  }
  if (interval < MIN_INTERVAL_MINUTES) {
    return {
      ok: false,
      code: "BAD_REQUEST",
      message: `intervalMinutes 不得小于 ${MIN_INTERVAL_MINUTES} 分钟（0.1 分钟 = 6 秒）`
    };
  }
  if (!hasAtMostOneDecimal(interval)) {
    return { ok: false, code: "BAD_REQUEST", message: "intervalMinutes 最多允许一位小数（如 0.5、2.5）" };
  }

  const maxAttempts = raw.maxAttempts === undefined || raw.maxAttempts === null ? DEFAULT_RETRY.maxAttempts : raw.maxAttempts;
  if (typeof maxAttempts !== "number" || !Number.isInteger(maxAttempts) || maxAttempts < 0) {
    return { ok: false, code: "BAD_REQUEST", message: "maxAttempts 必须是不小于 0 的整数（0 = 不限）" };
  }

  const maxDuration = raw.maxDurationMinutes === undefined || raw.maxDurationMinutes === null ? DEFAULT_RETRY.maxDurationMinutes : raw.maxDurationMinutes;
  if (typeof maxDuration !== "number" || !Number.isFinite(maxDuration) || maxDuration < 0) {
    return { ok: false, code: "BAD_REQUEST", message: "maxDurationMinutes 必须是不小于 0 的数字（0 = 不限）" };
  }
  if (!hasAtMostOneDecimal(maxDuration)) {
    return { ok: false, code: "BAD_REQUEST", message: "maxDurationMinutes 最多允许一位小数（如 0.5、2.5）" };
  }

  return {
    ok: true,
    params: {
      mode,
      intervalMinutes: interval,
      maxAttempts,
      maxDurationMinutes: maxDuration,
      /** 两者同为 0 = 不限：面板须以**可见文本**提示（§18.4 第 3 条 / AC25）。 */
      unlimited: maxAttempts === 0 && maxDuration === 0
    }
  };
}

/**
 * 单次尝试是否算「成功」（§18.2）。
 *
 * 严格模式：判据 = 严格校验通过 **且** 未超慢阈值 —— 即 `status === "healthy"`。
 *   规格表格行写「严格校验通过」，而 §18.2 判据补充又明确「严格模式下 `slow` 不算成功」。
 *   两句话在「严格校验通过但耗时超阈值」这一种情形下冲突，取**同时满足**者（更严的一侧），
 *   即要求 `status === "healthy"`：它既蕴含严格校验 pass，又排除 slow。这是两句规格文字
 *   的唯一共同解，不引入第三种语义。（该冲突已登记进 SPEC §18.2 的实现注记。）
 *
 * 连通模式：判据 = HTTP 2xx **且** 响应体按该协议解析成功（不比对内容）。
 *   规格原文写 `layers.model.status === "ok"`，但 §9.2 冻结的 `status` 取值只有
 *   `pass | fail | skip`（R21）。`"ok"` 恒不成立 ⇒ 照字面实现会得到一条**空断言**
 *   （连通模式永远失败）。故按 §9.2 冻结契约取 `"pass"`。此偏差已登记。
 *   连通模式下 `slow` **算成功**（耗时只影响该次的状态徽标）。
 *
 * @param {"strict"|"connectivity"} mode
 * @param {object} result - 一条完整 TestResult（§12.1）
 * @returns {boolean}
 */
export function isAttemptSuccessful(mode, result) {
  if (result === null || result === undefined || typeof result !== "object") return false;
  if (mode === "connectivity") {
    const status = Number(result.httpStatus);
    if (!Number.isFinite(status) || status < 200 || status >= 300) return false;
    const layers = result.layers ?? {};
    const model = layers.model ?? {};
    return model.status === "pass";
  }
  // strict（默认）
  return result.status === "healthy";
}

/**
 * 创建重试会话管理器。
 *
 * 单例约束（§18.6）：**同一时刻只允许一个重试会话**（全局，不区分目标）。
 * 重复 start **必须被拒绝**（返回 RETRY_IN_FLIGHT），不得替换、不得忽略、不得排队。
 *
 * @param {object} deps
 * @param {(attemptCtx:object) => Promise<object>} deps.runAttempt
 *        执行一次完整单次测试；接收 { target, attempt, sessionId, signal }，返回 TestResult。
 * @param {(result:object, meta:object) => void} [deps.onAttempt]
 *        每次尝试结束（含被中止）时回调，用于写记录（§18.3）。
 * @param {(info:object) => void} [deps.onSessionEnd]
 *        会话结束时回调。`needsFinalMark` 为真表示「最后写下的那条记录需要补记 isFinal」
 *        —— 只在「未成功且非达次数上限」的收尾路径出现（时长上限 / 等待期手动停止）。
 * @param {() => number} [deps.now]
 * @param {typeof setTimeout} [deps.setTimer]
 * @param {typeof clearTimeout} [deps.clearTimer]
 * @param {() => string} [deps.newSessionId]
 */
export function createRetryManager({
  runAttempt,
  onAttempt,
  onSessionEnd,
  now = () => Date.now(),
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  newSessionId = () => "rs-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8)
} = {}) {
  /** @type {object|null} 当前会话（null = 从未启动过）。 */
  let session = null;

  /** 时长上限（毫秒）；0 = 不限。 */
  const durationLimitMs = () => (session.params.maxDurationMinutes === 0 ? 0 : session.params.maxDurationMinutes * 60000);

  /** 距时长上限的剩余毫秒；不限时返回 Infinity。 */
  function remainingMs() {
    const limit = durationLimitMs();
    if (limit === 0) return Infinity;
    return limit - (now() - session.startedAt);
  }

  /** 对外快照：无会话时 `{active:false}`（§18.7 status 契约）。 */
  function snapshot() {
    if (session === null) return { active: false };
    return {
      active: session.active,
      sessionId: session.sessionId,
      mode: session.params.mode,
      params: {
        mode: session.params.mode,
        intervalMinutes: session.params.intervalMinutes,
        maxAttempts: session.params.maxAttempts,
        maxDurationMinutes: session.params.maxDurationMinutes,
        unlimited: session.params.unlimited
      },
      target: session.target,
      startedAt: session.startedAt,
      attempts: session.attempts,
      /** 下一次尝试的**计划时刻**（无计划时为 null，例如已结束或正在尝试）。 */
      nextAttemptAt: session.nextAttemptAt,
      /** 正在尝试时该次尝试的开始时刻，否则 null。 */
      attemptStartedAt: session.attemptStartedAt,
      stopReason: session.stopReason,
      stoppedAt: session.stoppedAt,
      lastResult: session.lastResult,
      lastError: session.lastError
    };
  }

  /** 结束会话：清定时器、收口状态、回调。四条停止原因之外无其它路径（§18.5）。 */
  function endSession(stopReason, { needsFinalMark }) {
    if (session === null || session.active !== true) return;
    if (session.timer !== null) {
      clearTimer(session.timer);
      session.timer = null;
    }
    session.active = false;
    session.stopReason = stopReason;
    session.stoppedAt = now();
    session.nextAttemptAt = null;
    session.attemptStartedAt = null;
    if (typeof onSessionEnd === "function") {
      onSessionEnd({
        sessionId: session.sessionId,
        stopReason,
        attempts: session.attempts,
        lastResult: session.lastResult,
        needsFinalMark: needsFinalMark === true
      });
    }
  }

  /**
   * 安排下一次尝试。
   *
   * 等待时长取 `min(间隔, 距时长上限的剩余)`：这样「时长上限在等待期间到期」也能被
   * 及时收口（§18.4 明确最长时长「含等待时间与请求耗时」）。
   */
  function scheduleNext() {
    if (session.params.maxAttempts !== 0 && session.attempts >= session.params.maxAttempts) {
      endSession("max-attempts", { needsFinalMark: false });
      return;
    }
    const remain = remainingMs();
    if (remain <= 0) {
      endSession("max-duration", { needsFinalMark: true });
      return;
    }
    const waitMs = Math.min(session.params.intervalMinutes * 60000, remain);
    session.nextAttemptAt = now() + waitMs;
    session.timer = setTimer(() => {
      session.timer = null;
      session.nextAttemptAt = null;
      if (session === null || session.active !== true) return;
      if (remainingMs() <= 0) {
        endSession("max-duration", { needsFinalMark: true });
        return;
      }
      runOne();
    }, waitMs);
  }

  /** 执行一次尝试并决定后续。 */
  async function runOne() {
    if (session === null || session.active !== true) return;
    session.timer = null;
    session.nextAttemptAt = null;
    session.attempts += 1;
    const attempt = session.attempts;
    const attemptStartedAt = now();
    session.attemptStartedAt = attemptStartedAt;
    const sessionId = session.sessionId;

    let result;
    try {
      result = await runAttempt({
        target: session.target,
        attempt,
        sessionId,
        signal: session.controller.signal
      });
    } catch (error) {
      // runAttempt 自身抛出属实现异常：记为一次失败尝试，不炸掉会话。
      result = null;
      session.lastError = String(error?.message ?? error);
    }
    // 会话可能在 await 期间被结束/替换（例如手动停止）：此时不再改状态、不再排下一次。
    if (session === null || session.sessionId !== sessionId) return;
    session.attemptStartedAt = null;
    session.lastResult = result;

    const stoppedByUser = session.pendingUserStop === true;
    const ok = isAttemptSuccessful(session.params.mode, result);
    const reachMaxAttempts = session.params.maxAttempts !== 0 && session.attempts >= session.params.maxAttempts;
    // isFinal 在**写记录那一刻**即可确定的三条路径：成功、达次数上限、用户手动停止。
    const isFinalKnown = ok || reachMaxAttempts || stoppedByUser;

    if (typeof onAttempt === "function") {
      onAttempt(result, {
        sessionId,
        attempt,
        isFinal: isFinalKnown,
        success: ok,
        aborted: stoppedByUser,
        startedAt: attemptStartedAt
      });
    }

    if (stoppedByUser) {
      endSession("stopped-by-user", { needsFinalMark: false });
      return;
    }
    if (ok) {
      endSession("success", { needsFinalMark: false });
      return;
    }
    scheduleNext();
  }

  return {
    /**
     * 启动会话（§18.1 启用条件三条同时满足）。
     * @returns {{ok:true, status:object} | {ok:false, httpStatus:number, code:string, message:string}}
     */
    start({ target, params } = {}) {
      const checked = validateRetryParams(params);
      if (!checked.ok) {
        return { ok: false, httpStatus: 400, code: checked.code, message: checked.message };
      }
      if (target === null || target === undefined || typeof target !== "object") {
        return { ok: false, httpStatus: 400, code: "BAD_REQUEST", message: "target 必填（routeKey + modelId）" };
      }
      // §18.6：在飞时**拒绝**而非静默覆盖（不得替换、不得忽略、不得排队）。
      if (session !== null && session.active === true) {
        return {
          ok: false,
          httpStatus: 409,
          code: "RETRY_IN_FLIGHT",
          message: "已有重试会话进行中，请先停止或等它结束"
        };
      }

      const sessionId = newSessionId();
      session = {
        sessionId,
        params: checked.params,
        target,
        startedAt: now(),
        attempts: 0,
        active: true,
        attemptStartedAt: null,
        nextAttemptAt: null,
        stopReason: null,
        stoppedAt: null,
        lastResult: null,
        lastError: null,
        pendingUserStop: false,
        timer: null,
        controller: new AbortController()
      };

      // 首次尝试立即执行（§18.4「首次尝试立即执行，不等间隔」）。
      runOne();
      return { ok: true, status: snapshot() };
    },

    /**
     * 手动停止（§18.5 条件 4）：**必须能中断在飞请求**——与单次测试同一 AbortController
     * 中止路径。无会话时返回 409，不得静默成功（§18.7）。
     */
    stop() {
      if (session === null || session.active !== true) {
        return { ok: false, httpStatus: 409, code: "NO_ACTIVE_RETRY", message: "当前没有进行中的重试会话" };
      }
      // 先中止在飞请求，再收口：在飞那一次会以「已中止」落一条记录（不计入成功）。
      try {
        session.controller.abort();
      } catch {
        /* 尽力而为 */
      }
      if (session.attemptStartedAt === null) {
        // 等待期停止：没有在飞请求，直接收口。
        endSession("stopped-by-user", { needsFinalMark: session.attempts > 0 });
      } else {
        // 在飞停止：标记后由 runOne 的收尾负责 endSession（保证记录先落地）。
        session.pendingUserStop = true;
      }
      return { ok: true, status: snapshot() };
    },

    /** 状态查询（§18.7）：无会话时 `{active:false}`。 */
    status() {
      return snapshot();
    },

    /** 卸载清理：中止在飞请求、清定时器，避免插件卸载后仍有定时器在跑。 */
    dispose() {
      if (session !== null) {
        try {
          session.controller.abort();
        } catch {
          /* 尽力而为 */
        }
        if (session.timer !== null) clearTimer(session.timer);
      }
      session = null;
    }
  };
}
