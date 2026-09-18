/**
 * 「当前默认模型」读写（本轮新增功能，SPEC §19）。
 *
 * 用户的诉求：**每次打开面板，默认就选中我平时用的那个模型**，点一下即可测它；
 * 反过来也能把当前选中的模型设为新的默认。
 *
 * 数据来源是宿主自己的默认模型命名空间 `agent-default-model`
 * （`{ provider, model, reasoningEffort? }`，由 `@deepseek-ai/dsh-agent-default-model`
 * 注册进 settings，见 dsh-base 的 cordis.patch.yml）。**不新增任何自有存储**：
 * 该命名空间是「新建 Agent 的默认模型」的既有唯一真相，写它就等于真正改变了默认模型，
 * 而不是只在本插件里记一个私有偏好。
 *
 * 关键映射（易错点）：命名空间里的 `provider` 是 **llm-pi-ai 的 provider 路由名**
 * （即本插件术语里的 `routeKey`，如 `route-gamma`），**不是**本插件 `providers[].id`
 * （那是归一化 baseURL 的 sha1 前缀）。故必须按 routeKey 反查所在分组与模型。
 *
 * 本模块只做纯逻辑与 settings 读写；不做 HTTP、不碰 RingBuffer。
 */

/** 宿主默认模型的 settings 命名空间（与 dsh-agent-default-model 的常量一致）。 */
export const DEFAULT_MODEL_NAMESPACE = "agent-default-model";

/** 只接受 llm-pi-ai 的三协议路由（与 probe.js 的 SUPPORTED_APIS 同源语义）。 */
const REASONING_EFFORT_MAX = 64;

/**
 * 读取当前默认模型（只读，绝不写）。
 *
 * @param {object} ctx - cordis 上下文
 * @returns {{available:boolean, provider:string|null, model:string|null, reasoningEffort:string|null, source:"user"|"base"|null, reason:string|null}}
 *   `source`：`user` = 用户在 settings.yaml 里显式设过；`base` = 只有 composition 默认值。
 *   `available:false` 时 `reason` 说明原因（中文，可直接展示）。
 */
export function readDefaultModel(ctx) {
  const blank = { available: false, provider: null, model: null, reasoningEffort: null, source: null, reason: null };
  let settings;
  try {
    settings = ctx.get("settings");
  } catch {
    return { ...blank, reason: "settings 服务不可用" };
  }
  if (!settings || typeof settings.get !== "function") {
    return { ...blank, reason: "settings 服务不可用" };
  }

  let value;
  try {
    value = settings.get(DEFAULT_MODEL_NAMESPACE);
  } catch {
    return { ...blank, reason: `命名空间 ${DEFAULT_MODEL_NAMESPACE} 未注册` };
  }
  if (value === null || value === undefined || typeof value !== "object") {
    return { ...blank, reason: `命名空间 ${DEFAULT_MODEL_NAMESPACE} 未注册或为空` };
  }
  const provider = typeof value.provider === "string" && value.provider !== "" ? value.provider : null;
  const model = typeof value.model === "string" && value.model !== "" ? value.model : null;
  if (provider === null || model === null) {
    return { ...blank, reason: "默认模型未配置 provider / model" };
  }
  const reasoningEffort =
    typeof value.reasoningEffort === "string" && value.reasoningEffort !== "" ? value.reasoningEffort : null;

  // source：看 describe() 的 user 层是否显式含这两个字段（presence = 用户覆盖过）。
  let source = null;
  try {
    if (typeof settings.describe === "function") {
      const descriptor = settings.describe().find((d) => d !== null && d !== undefined && d.ns === DEFAULT_MODEL_NAMESPACE);
      const user = descriptor === undefined ? undefined : descriptor.user;
      source = user !== null && user !== undefined && typeof user === "object" && typeof user.provider === "string" ? "user" : "base";
    }
  } catch {
    source = null;
  }

  return { available: true, provider, model, reasoningEffort, source, reason: null };
}

/**
 * 把 (routeKey, modelId) 反查为四层选择器的选择状态（SPEC §7 的结构）。
 *
 * 之所以要这一步：默认模型给的是 routeKey，而面板的选择状态是
 * `{providerId, groupId, modelKey, routeKey}`。routeKey 可能落在同一 baseURL 下的
 * **任一** API 分组里（例如 route-gamma 同时有 openai 与 anthropic 两个分组），
 * 故必须逐分组查找，不能只看第一个。
 *
 * @param {object} config - GET /config 的载荷
 * @param {string} routeKey
 * @param {string} modelId
 * @returns {object|null} 选择状态；无法定位时返回 null（调用方回落默认选择）
 */
export function selectionForRouteModel(config, routeKey, modelId) {
  if (config === null || config === undefined || typeof config !== "object") return null;
  if (typeof routeKey !== "string" || routeKey === "") return null;
  const groups = Array.isArray(config.groups) ? config.groups : [];
  for (const group of groups) {
    const routes = Array.isArray(group.routes) ? group.routes : [];
    const route = routes.find((r) => r !== null && r !== undefined && r.routeKey === routeKey);
    if (route === undefined) continue;
    // 该分组里必须真有这个模型（模型是按分组去重的并集）
    const modelRow = (group.models || []).find((m) => m !== null && m !== undefined && m.id === modelId);
    if (modelRow === undefined) continue;
    // 不变式（AC23）：所选路由必须声明了所选模型
    const modelIds = Array.isArray(route.modelIds) ? route.modelIds : [];
    if (modelId !== null && modelId !== undefined && !modelIds.includes(modelId)) continue;
    return {
      providerId: group.providerId,
      groupId: group.id,
      modelKey: modelRow.modelKey,
      routeKey
    };
  }
  return null;
}

/**
 * 目标模型是否支持给定的 reasoning effort。
 *
 * 用途：写默认模型时决定要不要把现有的 `reasoningEffort` 一起带过去。
 * 若目标模型不支持当前 effort，**必须丢掉它**——否则会写进一个该模型无法执行的挡位，
 * 让「默认模型」在下次开新会话时带着一个非法参数。
 *
 * @param {object} config - GET /config 的载荷
 * @param {string} routeKey
 * @param {string} modelId
 * @param {string|null} effort
 * @returns {boolean}
 */
export function modelSupportsEffort(config, routeKey, modelId, effort) {
  if (typeof effort !== "string" || effort === "") return false;
  if (config === null || config === undefined || typeof config !== "object") return false;
  const groups = Array.isArray(config.groups) ? config.groups : [];
  for (const group of groups) {
    const routes = Array.isArray(group.routes) ? group.routes : [];
    if (!routes.some((r) => r !== null && r !== undefined && r.routeKey === routeKey)) continue;
    const modelRow = (group.models || []).find((m) => m !== null && m !== undefined && m.id === modelId);
    if (modelRow === undefined) continue;
    const list = Array.isArray(modelRow.reasoningEfforts) ? modelRow.reasoningEfforts : [];
    return list.includes(effort);
  }
  return false;
}

/**
 * 写入默认模型（SPEC §19.3）。**唯一的写路径**，且只写 `agent-default-model` 命名空间。
 *
 * 用 `replace` 而非 `update`：`update` 是合并语义，无法移除字段。若目标模型不支持
 * 现有的 `reasoningEffort`，合并会把那个非法挡位留在用户层（见 modelSupportsEffort）。
 * `replace` 写整节，缺席键回落 composition base 与 schema 默认值 —— 正是
 * 「默认选择 = 该路由 + 该模型，effort 交给宿主决定」这一语义。
 *
 * @param {object} ctx - cordis 上下文
 * @param {{routeKey:string, modelId:string, reasoningEffort?:string|null}} next
 * @returns {Promise<{ok:true, written:object} | {ok:false, httpStatus:number, code:string, message:string}>}
 */
export async function writeDefaultModel(ctx, next) {
  const routeKey = next === null || next === undefined ? null : next.routeKey;
  const modelId = next === null || next === undefined ? null : next.modelId;
  if (typeof routeKey !== "string" || routeKey === "" || typeof modelId !== "string" || modelId === "") {
    return { ok: false, httpStatus: 400, code: "BAD_REQUEST", message: "routeKey 与 modelId 必填且必须为字符串" };
  }

  let settings;
  try {
    settings = ctx.get("settings");
  } catch {
    settings = undefined;
  }
  if (!settings || typeof settings.replace !== "function") {
    return {
      ok: false,
      httpStatus: 503,
      code: "SETTINGS_READONLY",
      message: "settings 服务不可写，无法设置默认模型"
    };
  }

  const written = { provider: routeKey, model: modelId };
  const effort = next.reasoningEffort;
  if (typeof effort === "string" && effort !== "" && effort.length <= REASONING_EFFORT_MAX) {
    written.reasoningEffort = effort;
  }

  try {
    await settings.replace(DEFAULT_MODEL_NAMESPACE, written);
  } catch (error) {
    return {
      ok: false,
      httpStatus: 500,
      code: "SETTINGS_WRITE_FAILED",
      message: `写入默认模型失败：${String(error?.message ?? error)}`
    };
  }
  return { ok: true, written };
}
