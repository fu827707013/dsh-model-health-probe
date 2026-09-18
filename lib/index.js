/**
 * dsh-model-health-probe — 宿主入口（SPEC §5、§8、§11、§12、§18、§19）。
 *
 * 挂面：
 *   - GET  /api/model-health/config        四层选择器数据 + 请求预览 + 当前默认模型
 *   - POST /api/model-health/test          执行一次真实裸 HTTP 探测，返回完整 TestResult
 *   - GET  /api/model-health/records       最近测试记录（RingBuffer 50 条，最新在前）
 *   - POST /api/model-health/records       {action:"clear"} 清空记录
 *   - POST /api/model-health/retry/start   启动自动重试会话（§18.7）
 *   - GET  /api/model-health/retry/status  查询重试会话状态（无会话时 {active:false}）
 *   - POST /api/model-health/retry/stop    手动停止（无会话时 409）
 *   - POST /api/model-health/default       把某路由+模型设为宿主默认模型（§19）
 *
 * webServer / settings / credentials 全部用 ctx.get 惰性获取：缺失时降级，
 * 绝不让插件纤维失败（照搬 dsh-concurrency-guard 骨架）。
 */
import { readFileSync } from "node:fs";
import { readProviders, buildSelection } from "./providers.js";
import { executeProbe, resolveTemplates, DEFAULT_TEMPLATES, DEFAULT_MAX_RESPONSE_BYTES } from "./probe.js";
import { createRing, DEFAULT_MAX_RECORDS } from "./records.js";
import { createRetryManager, validateRetryParams, isAttemptSuccessful, DEFAULT_RETRY } from "./retry.js";
import { readDefaultModel, writeDefaultModel, selectionForRouteModel, modelSupportsEffort, DEFAULT_MODEL_NAMESPACE } from "./default-model.js";

export const name = "model-health";

/** 本插件不依赖任何硬服务；settings/credentials/webServer 全部惰性获取。 */
export const inject = [];

/**
 * 版本自述从 package.json 读取（修复 F-R-13：原先硬编码 "0.1.0" 与包版本脱节）。
 * 读不到时回落 "0.0.0-unknown"，绝不让插件纤维失败。
 */
const PLUGIN_VERSION = (() => {
  try {
    const url = new URL("../package.json", import.meta.url);
    const pkg = JSON.parse(readFileSync(url, "utf8"));
    return typeof pkg.version === "string" && pkg.version !== "" ? pkg.version : "0.0.0-unknown";
  } catch {
    return "0.0.0-unknown";
  }
})();

const NS = "llm-pi-ai";

/** 插件配置默认值（SPEC §8.2、§8.3、§12.2、§6.4）。 */
export const DEFAULT_CONFIG = {
  slowMs: 15000,
  hardTimeoutMs: 60000,
  maxResponseBytes: DEFAULT_MAX_RESPONSE_BYTES,
  maxRecords: DEFAULT_MAX_RECORDS,
  templates: DEFAULT_TEMPLATES
};

function clampInt(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  const i = Math.floor(n);
  if (i < min) return min;
  if (i > max) return max;
  return i;
}

/** 合并并夹紧插件配置。 */
export function resolveConfig(config) {
  const c = config ?? {};
  return {
    pluginVersion: PLUGIN_VERSION,
    slowMs: clampInt(c.slowMs, DEFAULT_CONFIG.slowMs, 100, 600000),
    hardTimeoutMs: clampInt(c.hardTimeoutMs, DEFAULT_CONFIG.hardTimeoutMs, 1000, 600000),
    maxResponseBytes: clampInt(c.maxResponseBytes, DEFAULT_CONFIG.maxResponseBytes, 1024, 64 * 1024 * 1024),
    maxRecords: clampInt(c.maxRecords, DEFAULT_CONFIG.maxRecords, 1, 500),
    templates: { ...DEFAULT_TEMPLATES, ...(typeof c.templates === "object" && c.templates !== null ? c.templates : {}) }
  };
}

export function apply(ctx, config) {
  const logger = ctx.logger;
  const cfg = resolveConfig(config);
  const ring = createRing(cfg.maxRecords);

  /** 在飞目标集合：同目标并发保护（SPEC §11.2、R25）。 */
  const inFlight = new Set();

  // ---------- 动态加载可选服务模块（失败降级，零硬依赖） ----------
  let credentialRefFn = null;
  let isRefNameFn = null;
  let launchEnvFn = null;
  const optionalReady = (async () => {
    try {
      const mod = await import("@deepseek-ai/dsh-credentials");
      if (typeof mod.credentialRef === "function") credentialRefFn = mod.credentialRef;
      if (typeof mod.isCredentialRefName === "function") isRefNameFn = mod.isCredentialRefName;
    } catch {
      logger.debug("[model-health] 无法解析 @deepseek-ai/dsh-credentials，密钥解析降级为环境快照");
    }
    try {
      const mod = await import("@deepseek-ai/dsh-launch-environment");
      if (typeof mod.launchEnvironmentOf === "function") launchEnvFn = mod.launchEnvironmentOf;
    } catch {
      logger.debug("[model-health] 无法解析 @deepseek-ai/dsh-launch-environment，环境兜底不可用");
    }
  })();

  /** 引用名合法性：dsh-credentials 可用时用它的判定，否则用等价正则。 */
  const isRefName = (ref) =>
    typeof isRefNameFn === "function" ? isRefNameFn(ref) : /^[A-Za-z_][A-Za-z0-9_]*$/.test(String(ref ?? ""));

  /**
   * 解析密钥（SPEC §8.1，blocker 级）。
   *
   * 必须照抄宿主 dsh-llm-pi-ai/lib/index.js:2598 的顺序——注意这是**三元**而非兜底链：
   * credentials 服务存在时只用它；只有服务不存在才回退启动环境快照。
   * 只读 process.env 会让本机 12/12 路由全部 401。
   */
  async function resolveApiKey(ref) {
    if (typeof ref !== "string" || ref === "") {
      return { error: { code: "MISSING_CREDENTIAL", detail: "该路由未声明 apiKeyEnv，无法解析密钥" } };
    }
    if (!isRefName(ref)) {
      return {
        error: {
          code: "MISSING_CREDENTIAL",
          detail: `apiKeyEnv「${ref}」不是合法的环境变量名（应为 POSIX 标识符）`
        }
      };
    }
    let hit;
    try {
      const credentials = ctx.get("credentials");
      if (credentials !== undefined && typeof credentials.resolve === "function") {
        const branded = typeof credentialRefFn === "function" ? credentialRefFn(ref) : ref;
        hit = (await credentials.resolve(branded))?.value;
      } else if (typeof launchEnvFn === "function") {
        hit = launchEnvFn(ctx).get(ref)?.value;
      } else {
        hit = process.env?.[ref];
      }
    } catch (error) {
      logger.debug(`[model-health] 密钥解析异常（route ref=${ref}）: ${String(error?.message ?? error)}`);
      hit = undefined;
    }
    if (hit === undefined || hit === null || String(hit).length === 0) {
      return {
        error: {
          code: "MISSING_CREDENTIAL",
          detail: `该供应商未配置密钥（${ref}），请在模型设置页填写或通过环境变量提供`
        }
      };
    }
    // 可发送性校验：不合法就别发，否则 fetch 抛 ByteString TypeError 被误报成网络错误
    const checked = normalizeApiKeyValue(String(hit));
    if (!checked.ok) {
      return {
        error: {
          code: "INVALID_CREDENTIAL",
          detail:
            checked.reason === "empty"
              ? `密钥（${ref}）为空`
              : `密钥（${ref}）含 HTTP 头无法承载的字符，请只粘贴密钥原文`
        }
      };
    }
    return { value: checked.value };
  }

  /** 凭据状态（只回引用名与状态，永不回值，SPEC §11.1）。 */
  async function describeCredential(ref) {
    const blank = { ref: ref ?? null, configured: null, source: null, writable: null };
    if (typeof ref !== "string" || ref === "") return { ref: null, configured: null, source: null, writable: null };
    try {
      const credentials = ctx.get("credentials");
      if (credentials === undefined || typeof credentials.describe !== "function") return blank;
      const branded = typeof credentialRefFn === "function" ? credentialRefFn(ref) : ref;
      const info = await credentials.describe(branded);
      return {
        ref,
        configured: typeof info?.configured === "boolean" ? info.configured : null,
        source: typeof info?.source === "string" ? info.source : null,
        writable: typeof info?.writable === "boolean" ? info.writable : null
      };
    } catch {
      return blank;
    }
  }

  /** 组装 GET /config 的完整载荷。 */
  async function buildConfigPayload() {
    await optionalReady;
    const read = readProviders(ctx);
    const selection = buildSelection(read.providers, cfg);

    // 回填凭据状态（并行，失败静默）
    const groups = await Promise.all(
      selection.groups.map(async (group) => {
        const routes = await Promise.all(
          group.routes.map(async (route) => {
            const profile = read.providers[route.routeKey] ?? {};
            const credential = await describeCredential(profile.apiKeyEnv);
            return { ...route, credential };
          })
        );
        return { ...group, routes };
      })
    );

    return {
      ok: true,
      pluginVersion: PLUGIN_VERSION,
      generatedAt: Date.now(),
      source: {
        namespace: NS,
        available: read.available,
        providerCount: read.providerCount
      },
      thresholds: {
        slowMs: cfg.slowMs,
        hardTimeoutMs: cfg.hardTimeoutMs,
        maxResponseBytes: cfg.maxResponseBytes
      },
      templates: resolveTemplates(cfg),
      defaults: { stream: false, maxRecords: cfg.maxRecords },
      /* 当前宿主默认模型 + 它在四层选择器里的落点（§19）。
         面板据此在首次打开时预选用户的默认模型；定位不到时 selection 为 null，
         面板回落 §7.3 的默认选择并给出提示。
         注意：内层变量名不得叫 selection —— 那会遮蔽外层的分组结果并触发 TDZ。 */
      defaultModel: (() => {
        const current = readDefaultModel(ctx);
        if (current.available !== true) return { ...current, selection: null };
        const mapped = selectionForRouteModel({ providers: selection.providers, groups }, current.provider, current.model);
        return { ...current, selection: mapped };
      })(),
      retryDefaults: { ...DEFAULT_RETRY, unlimited: false },
      providers: selection.providers,
      groups,
      warnings: [...read.warnings, ...selection.warnings]
    };
  }

  /**
   * 定位目标（routeKey + modelId）在当前配置下的分组与路由。
   * 单次测试与重试会话共用同一套定位与校验（§18.1：重试的每次尝试就是一次完整单测）。
   */
  function locateTarget(routeKey, modelId) {
    const read = readProviders(ctx);
    const selection = buildSelection(read.providers, cfg);
    let targetGroup = null;
    let targetRoute = null;
    for (const group of selection.groups) {
      for (const route of group.routes) {
        if (route.routeKey === routeKey) {
          targetGroup = group;
          targetRoute = route;
          break;
        }
      }
      if (targetRoute !== null) break;
    }
    return { read, selection, targetGroup, targetRoute };
  }

  /**
   * 执行一次真实探测（**不**写记录、**不**做并发保护）。
   *
   * 单次测试与重试会话共用本函数：这正是 §18.1「复用同一套探测实现、同一状态机、
   * 同一错误映射」的落点。差异只在调用方如何处理结果与是否写记录。
   */
  async function probeTarget({ routeKey, modelId, stream, systemPrompt, userPrompt, signal, targetGroup, targetRoute, read }) {
    const profile = read.providers[routeKey] ?? {};
    const credentialRef = typeof profile.apiKeyEnv === "string" && profile.apiKeyEnv !== "" ? profile.apiKeyEnv : null;
    const resolved = await resolveApiKey(credentialRef);

    return executeProbe({
      routeKey,
      displayName: targetRoute.displayName,
      baseURL: targetGroup.baseURL,
      baseURLNormalized: targetGroup.baseURLNormalized,
      api: targetGroup.api,
      modelId,
      stream,
      routeCount: targetRoute.routeCount ?? targetRoute.modelIds.length,
      credentialRef,
      apiKey: resolved.value ?? null,
      credentialError: resolved.error ?? null,
      cfg,
      systemPrompt,
      userPrompt,
      externalSignal: signal ?? null
    });
  }

  /** 组装一条 TestResult（含 id），并追加进 RingBuffer。 */
  async function runTest(body) {
    await optionalReady;
    const routeKey = body?.routeKey;
    const modelId = body?.modelId;
    const { read, targetGroup, targetRoute } = locateTarget(routeKey, modelId);

    if (targetRoute === null) {
      return { httpStatus: 404, payload: { ok: false, error: { code: "UNKNOWN_ROUTE", message: `未找到路由「${String(routeKey)}」` } } };
    }
    if (!targetRoute.modelIds.includes(modelId)) {
      return {
        httpStatus: 400,
        payload: {
          ok: false,
          error: { code: "UNKNOWN_MODEL", message: `路由「${String(routeKey)}」未声明模型「${String(modelId)}」` }
        }
      };
    }

    const stream = body?.stream === true;
    const flightKey = `${routeKey}::${modelId}::${stream ? "stream" : "plain"}`;
    if (inFlight.has(flightKey)) {
      return {
        httpStatus: 409,
        payload: { ok: false, error: { code: "TEST_IN_FLIGHT", message: "该目标正在测试中，请等待当前测试返回" } }
      };
    }
    inFlight.add(flightKey);

    try {
      const result = await probeTarget({
        routeKey,
        modelId,
        stream,
        systemPrompt: typeof body?.systemPrompt === "string" ? body.systemPrompt.slice(0, 2000) : null,
        userPrompt: typeof body?.userPrompt === "string" ? body.userPrompt.slice(0, 2000) : null,
        targetGroup,
        targetRoute,
        read
      });

      const record = ring.push(result);
      logger.info(
        `[model-health] 测试完成 route=${routeKey} model=${modelId} api=${String(targetGroup.api)} ` +
          `stream=${stream} status=${record.status} http=${String(record.httpStatus)} latencyMs=${record.latencyMs}`
      );
      return { httpStatus: 200, payload: record };
    } finally {
      inFlight.delete(flightKey);
    }
  }

  // ---------- 自动重试会话（SPEC §18） ----------

  /**
   * 每次尝试都写一条记录（§18.3，不合并、不覆盖），并额外携带重试上下文。
   * 中止的那一次也写（记为「已中止」），否则用户看不到「第 N 次被手动停掉」。
   */
  const retryManager = createRetryManager({
    runAttempt: async ({ target, attempt, sessionId, signal }) => {
      await optionalReady;
      const { read, targetGroup, targetRoute } = locateTarget(target.routeKey, target.modelId);
      // 会话启动后配置可能被改（路由/模型消失）：按单测同样的判据产出一条失败结果，
      // 而不是抛异常——用户需要看到「为什么这次没成功」。
      if (targetRoute === null || !targetRoute.modelIds.includes(target.modelId)) {
        return {
          pluginVersion: PLUGIN_VERSION,
          startedAt: Date.now(),
          finishedAt: Date.now(),
          latencyMs: 0,
          ttftMs: null,
          status: "failed",
          reasons: [],
          target: { routeKey: target.routeKey, displayName: target.routeKey, modelId: target.modelId, stream: false },
          httpStatus: null,
          responseText: "",
          responseRaw: null,
          usage: { promptTokens: null, completionTokens: null, totalTokens: null, cacheReadTokens: null, cacheWriteTokens: null, totalComputed: false },
          usageSource: "none",
          layers: {
            api: { status: "fail", label: "API 请求", detail: "该路由或模型在当前配置中已不存在", code: "UNKNOWN_ROUTE" },
            model: { status: "skip", label: "模型响应", detail: "上游层未通过，本层未执行", code: null },
            strict: { status: "skip", label: "严格校验", detail: "上游层未通过，本层未执行", code: null }
          },
          error: { code: "UNKNOWN_ROUTE", title: "路由或模型不存在", hint: "配置可能已变更，请重新加载面板", httpStatus: null, raw: null },
          retry: { attempt, sessionId, isFinal: false, aborted: false }
        };
      }
      const result = await probeTarget({
        routeKey: target.routeKey,
        modelId: target.modelId,
        stream: target.stream === true,
        systemPrompt: typeof target.systemPrompt === "string" ? target.systemPrompt.slice(0, 2000) : null,
        userPrompt: typeof target.userPrompt === "string" ? target.userPrompt.slice(0, 2000) : null,
        signal,
        targetGroup,
        targetRoute,
        read
      });
      return result;
    },
    onAttempt: (result, meta) => {
      if (result === null || result === undefined) return;
      const record = ring.push({
        ...result,
        retry: {
          attempt: meta.attempt,
          sessionId: meta.sessionId,
          isFinal: meta.isFinal === true,
          aborted: meta.aborted === true,
          success: meta.success === true
        }
      });
      logger.info(
        `[model-health] 重试尝试 #${meta.attempt} session=${meta.sessionId} ` +
          `status=${record.status} http=${String(record.httpStatus)} success=${meta.success === true}`
      );
    },
    onSessionEnd: (info) => {
      // 时长上限 / 等待期手动停止：写记录时无法预知是最后一次，故补记 isFinal。
      if (info.needsFinalMark === true) ring.markHeadFinal();
      logger.info(
        `[model-health] 重试会话结束 session=${info.sessionId} reason=${info.stopReason} attempts=${info.attempts}`
      );
    }
  });

  /** 重试会话的完整状态（含 params 回显，供面板在刷新后重建控件）。 */
  function retryStatus() {
    return retryManager.status();
  }

  /**
   * 轻量选择器载荷：只做分组计算，**不回填凭据状态**（不做 N 次 credentials.describe）。
   * 用途：`POST /default` 里判断目标模型支持哪些推理挡位——那只需要 groups[].models[]，
   * 不需要凭据；用 buildConfigPayload() 会白白多打一轮凭据服务。
   */
  function buildConfigPayloadForEffort() {
    const read = readProviders(ctx);
    const selection = buildSelection(read.providers, cfg);
    return { providers: selection.providers, groups: selection.groups };
  }

  // ---------- HTTP 端点（惰性注册，照搬 guard 先例） ----------
  let didRoute = false;
  const tryRegister = () => {
    if (didRoute) return;
    try {
      const webServer = ctx.get("webServer");
      if (!webServer || typeof webServer.register !== "function") return;

      ctx.effect(
        () =>
          webServer.register({
            kind: "exact",
            path: "/api/model-health/config",
            handler: async (req, res) => {
              try {
                sendJson(res, 200, await buildConfigPayload());
              } catch (error) {
                logger.warn(`[model-health] GET /config 失败: ${String(error?.message ?? error)}`);
                sendJson(res, 200, {
                  ok: true,
                  pluginVersion: PLUGIN_VERSION,
                  generatedAt: Date.now(),
                  source: { namespace: NS, available: false, providerCount: 0 },
                  thresholds: { slowMs: cfg.slowMs, hardTimeoutMs: cfg.hardTimeoutMs, maxResponseBytes: cfg.maxResponseBytes },
                  templates: resolveTemplates(cfg),
                  defaults: { stream: false, maxRecords: cfg.maxRecords },
                  providers: [],
                  groups: [],
                  warnings: [
                    { code: "SETTINGS_UNAVAILABLE", message: "未读取到 llm-pi-ai 配置（读取过程异常）" }
                  ]
                });
              }
            }
          }),
        "model-health: GET /api/model-health/config"
      );

      ctx.effect(
        () =>
          webServer.register({
            kind: "exact",
            path: "/api/model-health/test",
            handler: async (req, res) => {
              try {
                const body = await readJsonBody(req);
                if (body === null || typeof body !== "object" || Array.isArray(body)) {
                  sendJson(res, 400, { ok: false, error: { code: "BAD_REQUEST", message: "请求体必须是 JSON 对象" } });
                  return;
                }
                if (typeof body.routeKey !== "string" || body.routeKey === "" || typeof body.modelId !== "string" || body.modelId === "") {
                  sendJson(res, 400, {
                    ok: false,
                    error: { code: "BAD_REQUEST", message: "routeKey 与 modelId 必填且必须为字符串" }
                  });
                  return;
                }
                if (body.stream !== undefined && typeof body.stream !== "boolean") {
                  sendJson(res, 400, { ok: false, error: { code: "BAD_REQUEST", message: "stream 必须是布尔值" } });
                  return;
                }
                const { httpStatus, payload } = await runTest(body);
                sendJson(res, httpStatus, payload);
              } catch (error) {
                logger.warn(`[model-health] POST /test 失败: ${String(error?.message ?? error)}`);
                sendJson(res, 400, { ok: false, error: { code: "BAD_REQUEST", message: "请求体不是合法 JSON" } });
              }
            }
          }),
        "model-health: POST /api/model-health/test"
      );

      ctx.effect(
        () =>
          webServer.register({
            kind: "exact",
            path: "/api/model-health/records",
            handler: async (req, res) => {
              try {
                const method = String(req.method ?? "GET").toUpperCase();
                if (method === "POST") {
                  const body = await readJsonBody(req);
                  if (body?.action !== "clear") {
                    sendJson(res, 400, {
                      ok: false,
                      error: { code: "BAD_REQUEST", message: 'action 必须是 "clear"' }
                    });
                    return;
                  }
                  sendJson(res, 200, { ok: true, cleared: ring.clear() });
                  return;
                }
                const records = ring.snapshot();
                sendJson(res, 200, { ok: true, capacity: ring.capacity, count: records.length, records });
              } catch (error) {
                logger.warn(`[model-health] /records 失败: ${String(error?.message ?? error)}`);
                sendJson(res, 400, { ok: false, error: { code: "BAD_REQUEST", message: "请求处理失败" } });
              }
            }
          }),
        "model-health: /api/model-health/records"
      );

      // ---------- 自动重试会话三端点（SPEC §18.7） ----------

      ctx.effect(
        () =>
          webServer.register({
            kind: "exact",
            path: "/api/model-health/retry/start",
            handler: async (req, res) => {
              try {
                const body = await readJsonBody(req);
                if (body === null || typeof body !== "object" || Array.isArray(body)) {
                  sendJson(res, 400, { ok: false, error: { code: "BAD_REQUEST", message: "请求体必须是 JSON 对象" } });
                  return;
                }
                const routeKey = body.routeKey;
                const modelId = body.modelId;
                if (typeof routeKey !== "string" || routeKey === "" || typeof modelId !== "string" || modelId === "") {
                  sendJson(res, 400, {
                    ok: false,
                    error: { code: "BAD_REQUEST", message: "routeKey 与 modelId 必填且必须为字符串" }
                  });
                  return;
                }
                // 启动前先按单测同一判据校验目标存在（§18.1 启用条件 1）——
                // 非法目标不进入重试循环，避免会话在第一次尝试里才发现路由不存在。
                await optionalReady;
                const { targetRoute } = locateTarget(routeKey, modelId);
                if (targetRoute === null) {
                  sendJson(res, 404, {
                    ok: false,
                    error: { code: "UNKNOWN_ROUTE", message: `未找到路由「${routeKey}」` }
                  });
                  return;
                }
                if (!targetRoute.modelIds.includes(modelId)) {
                  sendJson(res, 400, {
                    ok: false,
                    error: { code: "UNKNOWN_MODEL", message: `路由「${routeKey}」未声明模型「${modelId}」` }
                  });
                  return;
                }

                const out = retryManager.start({
                  target: {
                    routeKey,
                    modelId,
                    stream: body.stream === true,
                    systemPrompt: typeof body.systemPrompt === "string" ? body.systemPrompt.slice(0, 2000) : null,
                    userPrompt: typeof body.userPrompt === "string" ? body.userPrompt.slice(0, 2000) : null
                  },
                  params: {
                    mode: body.mode,
                    intervalMinutes: body.intervalMinutes,
                    maxAttempts: body.maxAttempts,
                    maxDurationMinutes: body.maxDurationMinutes
                  }
                });
                if (!out.ok) {
                  sendJson(res, out.httpStatus, { ok: false, error: { code: out.code, message: out.message } });
                  return;
                }
                sendJson(res, 200, { ok: true, session: out.status });
              } catch (error) {
                logger.warn(`[model-health] POST /retry/start 失败: ${String(error?.message ?? error)}`);
                sendJson(res, 400, { ok: false, error: { code: "BAD_REQUEST", message: "请求体不是合法 JSON" } });
              }
            }
          }),
        "model-health: POST /api/model-health/retry/start"
      );

      ctx.effect(
        () =>
          webServer.register({
            kind: "exact",
            path: "/api/model-health/retry/status",
            handler: async (req, res) => {
              try {
                sendJson(res, 200, { ok: true, session: retryStatus() });
              } catch (error) {
                logger.warn(`[model-health] GET /retry/status 失败: ${String(error?.message ?? error)}`);
                sendJson(res, 500, { ok: false, error: { code: "INTERNAL", message: "状态查询失败" } });
              }
            }
          }),
        "model-health: GET /api/model-health/retry/status"
      );

      ctx.effect(
        () =>
          webServer.register({
            kind: "exact",
            path: "/api/model-health/retry/stop",
            handler: async (req, res) => {
              try {
                const out = retryManager.stop();
                if (!out.ok) {
                  sendJson(res, out.httpStatus, { ok: false, error: { code: out.code, message: out.message } });
                  return;
                }
                sendJson(res, 200, { ok: true, session: out.status });
              } catch (error) {
                logger.warn(`[model-health] POST /retry/stop 失败: ${String(error?.message ?? error)}`);
                sendJson(res, 500, { ok: false, error: { code: "INTERNAL", message: "停止失败" } });
              }
            }
          }),
        "model-health: POST /api/model-health/retry/stop"
      );

      // ---------- 设为默认模型（SPEC §19） ----------

      ctx.effect(
        () =>
          webServer.register({
            kind: "exact",
            path: "/api/model-health/default",
            handler: async (req, res) => {
              try {
                const body = await readJsonBody(req);
                if (body === null || typeof body !== "object" || Array.isArray(body)) {
                  sendJson(res, 400, { ok: false, error: { code: "BAD_REQUEST", message: "请求体必须是 JSON 对象" } });
                  return;
                }
                if (typeof body.routeKey !== "string" || body.routeKey === "" || typeof body.modelId !== "string" || body.modelId === "") {
                  sendJson(res, 400, {
                    ok: false,
                    error: { code: "BAD_REQUEST", message: "routeKey 与 modelId 必填且必须为字符串" }
                  });
                  return;
                }
                await optionalReady;
                const { targetRoute } = locateTarget(body.routeKey, body.modelId);
                if (targetRoute === null) {
                  sendJson(res, 404, { ok: false, error: { code: "UNKNOWN_ROUTE", message: `未找到路由「${body.routeKey}」` } });
                  return;
                }
                if (!targetRoute.modelIds.includes(body.modelId)) {
                  sendJson(res, 400, {
                    ok: false,
                    error: { code: "UNKNOWN_MODEL", message: `路由「${body.routeKey}」未声明模型「${body.modelId}」` }
                  });
                  return;
                }

                // effort 只在目标模型确实支持时才带上：否则会写进一个该模型无法执行的挡位。
                const current = readDefaultModel(ctx);
                const selectionPayload = buildConfigPayloadForEffort();
                const effort =
                  current.available === true && current.reasoningEffort !== null &&
                  modelSupportsEffort(selectionPayload, body.routeKey, body.modelId, current.reasoningEffort)
                    ? current.reasoningEffort
                    : null;

                const out = await writeDefaultModel(ctx, {
                  routeKey: body.routeKey,
                  modelId: body.modelId,
                  reasoningEffort: effort
                });
                if (!out.ok) {
                  sendJson(res, out.httpStatus, { ok: false, error: { code: out.code, message: out.message } });
                  return;
                }
                const now = readDefaultModel(ctx);
                const mapped = selectionForRouteModel(selectionPayload, now.provider, now.model);
                sendJson(res, 200, { ok: true, written: out.written, defaultModel: { ...now, selection: mapped } });
              } catch (error) {
                logger.warn(`[model-health] POST /default 失败: ${String(error?.message ?? error)}`);
                sendJson(res, 400, { ok: false, error: { code: "BAD_REQUEST", message: "请求体不是合法 JSON" } });
              }
            }
          }),
        "model-health: POST /api/model-health/default"
      );

      didRoute = true;
      logger.info(
        "[model-health] HTTP 端点已注册: GET /config, POST /test, GET|POST /records, " +
          "POST /retry/start, GET /retry/status, POST /retry/stop, POST /default " +
          `(slowMs=${cfg.slowMs} hardTimeoutMs=${cfg.hardTimeoutMs} maxRecords=${cfg.maxRecords})`
      );
    } catch (error) {
      logger.warn(`[model-health] HTTP 端点注册失败（稍后重试）: ${String(error?.message ?? error)}`);
    }
  };

  tryRegister();
  ctx.on("internal/service", (serviceName) => {
    if (serviceName === "webServer") tryRegister();
  });

  logger.info(`[model-health] 已启动（pluginVersion=${PLUGIN_VERSION}）`);

  ctx.effect(() => () => {
    inFlight.clear();
    // 卸载时必须停掉重试会话：否则定时器会在插件已卸载后继续触发（§18.5「结束后不自动重启」）。
    retryManager.dispose();
    ring.clear();
  }, "model-health: teardown");
}

/** 读取并解析请求 JSON body（异常时返回 null，由调用方按 400 处理）。 */
async function readJsonBody(req) {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  if (raw.trim() === "") return null;
  return JSON.parse(raw);
}

/** 统一响应：UTF-8 JSON + no-store（SPEC §11）。 */
function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(body);
}

/** 密钥可发送性校验（与 probe.js 同规则，此处独立以免循环依赖）。 */
function normalizeApiKeyValue(raw) {
  const value = String(raw).trim();
  if (value.length === 0) return { ok: false, reason: "empty" };
  if (!/^[\x21-\x7E]+$/.test(value)) return { ok: false, reason: "illegalCharacters" };
  return { ok: true, value };
}
