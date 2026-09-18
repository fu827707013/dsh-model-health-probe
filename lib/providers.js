/**
 * 配置读取与四层选择器分组（SPEC §5、§7）。
 *
 * 职责：把 `ctx.settings.get("llm-pi-ai").providers` 这张
 * `Record<routeKey, PiAiProviderProfile>` 推导成
 * 「供应商 → API 类型 → 模型 → 路由」四行按钮的数据结构。
 *
 * 两条不可动摇的规则（SPEC §7.1、R3）：
 *   1. 只扫描 `llm-pi-ai.providers`，不看 describe-image / llm-deepseek 等其它命名空间；
 *   2. 归一化**只去尾部斜杠**，绝不补全或裁剪 `/v1` 段。
 *      证据：本机 `https://api-alpha.example.com/`(anthropic) 与
 *      `https://api-alpha.example.com/v1`(openai) 必须是两个不同的供应商组。
 *
 * 任何数字都不硬编码：组数、API 类型数、路由数全部由配置动态得出。
 */
import { createHash } from "node:crypto";
import { buildRequest, previewRequest, buildWarnings, SUPPORTED_APIS } from "./probe.js";

/** 归一化 baseURL：仅去除尾部一个或多个 `/`。绝不增删 `/v1` 等路径段。 */
export function normalizeBaseURL(baseURL) {
  if (typeof baseURL !== "string") return "";
  return baseURL.trim().replace(/\/+$/, "");
}

/** 稳定 id：只用于前端选择保持与 DOM key，不参与协议逻辑。 */
function stableId(seed) {
  return createHash("sha1").update(String(seed)).digest("hex").slice(0, 12);
}

/** 供应商按钮展示文本：host + 路径（已去尾斜杠）。 */
export function displayLabelOf(normalized) {
  try {
    const u = new URL(normalized);
    const path = u.pathname === "/" ? "" : u.pathname.replace(/\/+$/, "");
    return u.host + path;
  } catch {
    return normalized;
  }
}

function displayHostOf(normalized) {
  try {
    return new URL(normalized).host;
  } catch {
    return normalized;
  }
}

/**
 * 归一化推理挡位为字符串数组。
 *
 * 配置里有两种真实形态：数组 `["low","high"]`，或对象 `{ off: null, low: "low", max: "max" }`
 * （对象形态**键**是挡位名、值是该挡位映射到的上游值）。两种都归一成挡位名数组；
 * 缺失/畸形一律返回空数组（表示「本插件无从得知」，调用方据此保守处理）。
 */
export function normalizeEfforts(raw) {
  if (Array.isArray(raw)) {
    return raw.filter((x) => typeof x === "string" && x !== "");
  }
  if (raw !== null && raw !== undefined && typeof raw === "object") {
    return Object.keys(raw).filter((k) => k !== "");
  }
  return [];
}

/**
 * 纯函数：providers 字典 → { providers, groups, warnings }。
 *
 * 保持首次出现顺序（SPEC §7.1「顺序稳定性要求」）：同一份配置连续两次调用，
 * providers[] / groups[] / models[] / routes[] 的顺序必须完全一致。
 *
 * @param {Record<string, object>} providers - llm-pi-ai.providers
 * @param {object} cfg - 插件配置（templates / thresholds）
 * @returns {{providers: object[], groups: object[], warnings: object[]}}
 */
export function buildSelection(providers, cfg) {
  const routeKeys = Object.keys(providers ?? {});
  /** @type {Map<string, object>} providerId → provider 行 */
  const providerMap = new Map();
  /** @type {Map<string, object>} groupId → group 行 */
  const groupMap = new Map();
  const globalWarnings = [];

  for (const routeKey of routeKeys) {
    const profile = providers[routeKey] ?? {};
    const rawBaseURL = typeof profile.baseURL === "string" ? profile.baseURL : null;
    const normalized = normalizeBaseURL(rawBaseURL);

    // baseURL 缺失：仍让该路由可见（SPEC §5.2「可选中但测试必失败并给出说明」），
    // 归入一个显式的占位供应商组，避免路由凭空消失。
    const providerSeed = normalized === "" ? "__no-baseurl__" : normalized;
    const providerId = stableId(providerSeed);

    if (!providerMap.has(providerId)) {
      providerMap.set(providerId, {
        id: providerId,
        baseURL: rawBaseURL,
        baseURLNormalized: normalized,
        displayHost: normalized === "" ? "(未配置 Base URL)" : displayHostOf(normalized),
        displayLabel: normalized === "" ? "(未配置 Base URL)" : displayLabelOf(normalized),
        apiCount: 0,
        routeCount: 0,
        groupIds: []
      });
    }
    const providerRow = providerMap.get(providerId);

    // api 值原样保留（可能是 null 或 "azure-openai-responses"），SPEC §7.1 步骤 3
    const api = typeof profile.api === "string" && profile.api !== "" ? profile.api : null;
    const groupId = providerId + ":" + String(api);

    if (!groupMap.has(groupId)) {
      const group = {
        id: groupId,
        providerId,
        api,
        apiSupported: api !== null && SUPPORTED_APIS.has(api),
        baseURL: rawBaseURL,
        baseURLNormalized: normalized,
        previewUrl: null,
        routeCount: 0,
        warnings: [],
        models: [],
        routes: [],
        requestPreview: null
      };
      groupMap.set(groupId, group);
      providerRow.groupIds.push(groupId);
      providerRow.apiCount += 1;
    }
    const group = groupMap.get(groupId);

    const displayName =
      typeof profile.displayName === "string" && profile.displayName !== ""
        ? profile.displayName
        : routeKey;
    const modelList = Array.isArray(profile.models) ? profile.models : [];
    const modelIds = [];
    for (const m of modelList) {
      const id = m && typeof m.id === "string" && m.id !== "" ? m.id : null;
      if (id === null) continue;
      modelIds.push(id);

      // 模型并集：分组内按 modelId 去重，保留首个出现项的名称与容量（SPEC §7.1 步骤 4）
      let modelRow = group.models.find((x) => x.id === id);
      if (modelRow === undefined) {
        modelRow = {
          modelKey: groupId + "#" + id,
          id,
          name: typeof m.name === "string" && m.name !== "" ? m.name : id,
          contextWindow: Number.isFinite(m.contextWindow) ? m.contextWindow : null,
          maxTokens: Number.isFinite(m.maxTokens) ? m.maxTokens : null,
          /* 可用的推理挡位（SPEC §19.3）：写默认模型时要判断目标模型支不支持现有 effort，
             不支持就必须丢掉，否则会写入一个该模型无法执行的挡位。
             配置里既可能是数组，也可能是 `{ off: null, low: "low", … }` 这种对象
             （对象形态的键才是挡位名），两种都归一成字符串数组。 */
          reasoningEfforts: normalizeEfforts(m.reasoningEfforts),
          routeKeys: [],
          routeCount: 0
        };
        group.models.push(modelRow);
      }
      modelRow.routeKeys.push(routeKey);
      modelRow.routeCount = modelRow.routeKeys.length;
    }

    group.routes.push({
      routeKey,
      displayName,
      modelIds,
      credential: null // 由 index.js 用凭据服务回填（只回引用名与状态，永不回值）
    });
    group.routeCount = group.routes.length;
    providerRow.routeCount += 1;
  }

  // 分组级警告（非阻断，SPEC §7.5）——**必须在 per-route 循环之外**按分组构建一次。
  //
  // buildWarnings 的三个输入（api / baseURLNormalized / rawBaseURL）全部是分组级常量：
  // api 与 baseURLNormalized 就是 groupId 的两个组成部分，rawBaseURL 只用于判断
  // 「是否缺失」——而 baseURLNormalized === "" 当且仅当该组所有路由的 baseURL 都缺失
  // （缺失路由会落到 "__no-baseurl__" 哨兵组，不会与有效 baseURL 混组）。
  // 因此每组至多一条警告；若把构建放进 per-route 循环，N 条路由就会产生 N 条逐字
  // 相同的警告（F-DC-24：N×18px 撑爆面板高度预算，打破 AC15 A 档硬约束）。
  for (const group of groupMap.values()) {
    // 防御性去重：仅合并 (code, message) 逐字相同项；不同 code 或不同 message 一律保留
    // （SPEC §7.5 语义保留要求）。即使将来 buildWarnings 增加「同一分组多条不同警告」的
    // 场景，也不会误合并；而任何重复项都会被这一层拦住。
    const seen = new Set();
    for (const warn of buildWarnings({
      api: group.api,
      baseURLNormalized: group.baseURLNormalized,
      rawBaseURL: group.baseURL
    })) {
      // 用 JSON 数组做键：分隔无歧义，且不引入任何控制字符（源码保持纯可打印 ASCII）
      const key = JSON.stringify([warn.code, warn.message]);
      if (seen.has(key)) continue;
      seen.add(key);
      group.warnings.push(warn);
    }
  }

  // 预览：用与真实请求**同一个** buildRequest 产出（SPEC §11.1 契约要点）
  for (const group of groupMap.values()) {
    const firstModel = group.models[0];
    if (firstModel !== undefined && group.apiSupported && group.baseURLNormalized !== "") {
      group.previewUrl = buildRequest({
        baseURL: group.baseURLNormalized,
        api: group.api,
        modelId: firstModel.id,
        stream: false,
        cfg
      }).url;
      group.requestPreview = {
        nonStream: previewRequest({
          baseURL: group.baseURLNormalized,
          api: group.api,
          modelId: firstModel.id,
          stream: false,
          cfg
        }),
        stream: previewRequest({
          baseURL: group.baseURLNormalized,
          api: group.api,
          modelId: firstModel.id,
          stream: true,
          cfg
        })
      };
    }
  }

  if (routeKeys.length === 0) {
    globalWarnings.push({
      code: "SETTINGS_UNAVAILABLE",
      message: "未读取到 llm-pi-ai 配置（命名空间不可用或 providers 为空）"
    });
  }

  return {
    providers: [...providerMap.values()],
    groups: [...groupMap.values()],
    warnings: globalWarnings
  };
}

/**
 * 读取配置（SPEC §5.1）。只读，不做跨请求缓存——用户改完 settings.yaml
 * 刷新面板即可看到新值。
 *
 * 任何一步失败都降级为 available:false 的空结果，绝不抛异常、绝不让插件纤维失败。
 *
 * @param {object} ctx - cordis 上下文
 * @returns {{namespace: string, available: boolean, providerCount: number, providers: object, warnings: object[]}}
 */
export function readProviders(ctx) {
  const empty = {
    namespace: "llm-pi-ai",
    available: false,
    providerCount: 0,
    providers: {},
    warnings: [
      {
        code: "SETTINGS_UNAVAILABLE",
        message: "未读取到 llm-pi-ai 配置（settings 服务缺失或命名空间未注册）"
      }
    ]
  };
  try {
    const settings = ctx.get("settings");
    if (!settings || typeof settings.get !== "function") return empty;
    const section = settings.get("llm-pi-ai");
    if (!section || typeof section !== "object") return empty;
    const providers = section.providers;
    if (!providers || typeof providers !== "object" || Array.isArray(providers)) return empty;
    return {
      namespace: "llm-pi-ai",
      available: true,
      providerCount: Object.keys(providers).length,
      providers,
      warnings: []
    };
  } catch {
    // 命名空间未注册时 settings.get 会抛 TypeError（非 lowercase 标识符另论）；
    // 一律降级为可提示的空结果。
    return empty;
  }
}
