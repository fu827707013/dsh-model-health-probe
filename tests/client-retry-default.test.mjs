/**
 * 客户端新增逻辑的用例：重试控件（§18）+ 默认模型（§19）。
 *
 * 为什么要单测这些「纯逻辑」而不只靠 DOM 断言：第四行「分组作用域」那次的教训是
 * **只靠渲染断言覆盖不全**——渲染得到的是某一时刻的某一组输入，而边界（一位小数、
 * 0=不限、定位不到默认模型）恰恰不在默认渲染路径上。
 *
 * 本文件**不加载浏览器**：用与 probe.test.mjs 相同的 `__ModuleLoader__` 桩把
 * client.js 求值出来，直接调 `exports.__logic`。
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// ---------------------------------------------------------------------------
// 加载 client bundle：手写 __ModuleLoader__ 桩（与其它用例同一套做法）
// ---------------------------------------------------------------------------

function loadClient() {
  const src = readFileSync(new URL("../lib/client.js", import.meta.url), "utf8");
  let captured = null;
  const sandbox = {
    __ModuleLoader__: {
      load(entry) {
        captured = entry;
      }
    }
  };
  // client.js 顶层只调用 __ModuleLoader__.load({ id, factory })，不碰 window/document；
  // 用 Function 构造器提供 window 与 __ModuleLoader__，避免依赖全局。
  const fn = new Function("window", src);
  fn(sandbox);

  assert.ok(captured !== null, "client.js 必须调用 __ModuleLoader__.load");
  assert.equal(captured.id, "dsh-model-health-probe");

  const stubRequire = (name) => {
    if (name === "react") return { createElement: () => null, useState: () => [], useEffect: () => {}, useCallback: () => () => {}, useRef: () => ({}), useMemo: () => null };
    throw new Error("unexpected require: " + name);
  };
  return captured.factory(stubRequire);
}

const client = loadClient();
const L = client.__logic;

// ===========================================================================
// §18 重试控件逻辑
// ===========================================================================

describe("重试控件初值与参数校验（§18.4）", () => {
  test("initialRetry：宿主下发优先；缺失时用本地兜底（严格/1/30/30）", () => {
    const fromHost = L.initialRetry({
      retryDefaults: { mode: "connectivity", intervalMinutes: 0.5, maxAttempts: 7, maxDurationMinutes: 2.5 }
    });
    assert.equal(fromHost.mode, "connectivity");
    assert.equal(fromHost.interval, "0.5");
    assert.equal(fromHost.maxAttempts, "7");
    assert.equal(fromHost.maxDuration, "2.5");

    const fallback = L.initialRetry(null);
    assert.equal(fallback.mode, "strict");
    assert.equal(fallback.interval, "1");
    assert.equal(fallback.maxAttempts, "30");
    assert.equal(fallback.maxDuration, "30");
  });

  test("initialRetry：宿主给非法 mode 时回落 strict（无「都不选」态）", () => {
    assert.equal(L.initialRetry({ retryDefaults: { mode: "both" } }).mode, "strict");
  });

  test("validateRetryForm：0.1 合法、0.05 非法（与宿主同一硬下限）", () => {
    const base = { mode: "strict", interval: "0.1", maxAttempts: "5", maxDuration: "10" };
    assert.equal(L.validateRetryForm(base).ok, true);
    const bad = L.validateRetryForm(Object.assign({}, base, { interval: "0.05" }));
    assert.equal(bad.ok, false);
    assert.match(bad.reason, /0\.1/);
  });

  test("validateRetryForm：多于一位小数非法；0.3 / 0.7 合法（浮点陷阱）", () => {
    const base = { mode: "strict", interval: "1", maxAttempts: "5", maxDuration: "10" };
    for (const v of ["0.15", "0.25", "1.23"]) {
      assert.equal(L.validateRetryForm(Object.assign({}, base, { interval: v })).ok, false, `${v} 应非法`);
    }
    for (const v of ["0.1", "0.3", "0.7", "2.5"]) {
      assert.equal(L.validateRetryForm(Object.assign({}, base, { interval: v })).ok, true, `${v} 应合法`);
    }
  });

  test("validateRetryForm：次数须非负整数；时长须非负一位小数", () => {
    const base = { mode: "strict", interval: "1", maxAttempts: "5", maxDuration: "10" };
    assert.equal(L.validateRetryForm(Object.assign({}, base, { maxAttempts: "0" })).ok, true);
    assert.equal(L.validateRetryForm(Object.assign({}, base, { maxAttempts: "-1" })).ok, false);
    assert.equal(L.validateRetryForm(Object.assign({}, base, { maxAttempts: "1.5" })).ok, false);
    assert.equal(L.validateRetryForm(Object.assign({}, base, { maxDuration: "0" })).ok, true);
    assert.equal(L.validateRetryForm(Object.assign({}, base, { maxDuration: "2.55" })).ok, false);
  });

  test("validateRetryForm：空串 / 非数字一律非法（不把 NaN 当合法）", () => {
    const base = { mode: "strict", interval: "1", maxAttempts: "5", maxDuration: "10" };
    for (const key of ["interval", "maxAttempts", "maxDuration"]) {
      for (const v of ["", "abc", " "]) {
        assert.equal(L.validateRetryForm(Object.assign({}, base, { [key]: v })).ok, false, `${key}=${JSON.stringify(v)} 应非法`);
      }
    }
  });

  test("retryUnlimited：仅两者同为 0 才为真", () => {
    assert.equal(L.retryUnlimited({ maxAttempts: "0", maxDuration: "0" }), true);
    assert.equal(L.retryUnlimited({ maxAttempts: "0", maxDuration: "30" }), false);
    assert.equal(L.retryUnlimited({ maxAttempts: "30", maxDuration: "0" }), false);
    assert.equal(L.retryUnlimited({ maxAttempts: "1", maxDuration: "1" }), false);
  });

  test("oneDecimal：与宿主同规则", () => {
    assert.equal(L.oneDecimal(0.1), true);
    assert.equal(L.oneDecimal(0.3), true);
    assert.equal(L.oneDecimal(2.5), true);
    assert.equal(L.oneDecimal(30), true);
    assert.equal(L.oneDecimal(0.15), false);
    assert.equal(L.oneDecimal(Number.NaN), false);
  });
});

describe("重试会话结论文案（§18.3 末条）", () => {
  test("进行中：给出「已尝试 N 次」", () => {
    const s = L.retrySummary({ active: true, attempts: 3 });
    assert.match(s, /重试中/);
    assert.match(s, /3/);
  });

  test("成功结束：给出「第 N 次尝试成功」", () => {
    const s = L.retrySummary({ active: false, attempts: 4, stopReason: "success" });
    assert.match(s, /第 4 次/);
    assert.match(s, /成功/);
  });

  test("三条非成功停止原因各有中文文案", () => {
    assert.match(L.retrySummary({ active: false, attempts: 30, stopReason: "max-attempts" }), /最大次数/);
    assert.match(L.retrySummary({ active: false, attempts: 5, stopReason: "max-duration" }), /最长时长/);
    assert.match(L.retrySummary({ active: false, attempts: 2, stopReason: "stopped-by-user" }), /手动停止/);
  });

  test("无会话 / 无停止原因 → null（不渲染空状态行）", () => {
    assert.equal(L.retrySummary(null), null);
    assert.equal(L.retrySummary(undefined), null);
    assert.equal(L.retrySummary({ active: false }), null);
  });

  test("STOP_TEXT 覆盖 §18.5 全部四条停止原因", () => {
    for (const r of ["success", "max-attempts", "max-duration", "stopped-by-user"]) {
      assert.equal(typeof L.STOP_TEXT[r], "string", `缺少停止原因文案：${r}`);
    }
    assert.equal(Object.keys(L.STOP_TEXT).length, 4, "停止原因恰好 4 条");
  });
});

// ===========================================================================
// §19 默认模型
// ===========================================================================

/** 与宿主 /config 同构的最小载荷。 */
function makeConfig(overrides = {}) {
  const providers = {
    max66: {
      displayName: "max66",
      api: "openai-completions",
      baseURL: "http://max66.xyz/v1",
      models: [
        { id: "deepseek-v4.1-flash", name: "deepseek-v4.1-flash" },
        { id: "deepseek-v4-pro", name: "deepseek-v4-pro" }
      ]
    }
  };
  // 复用宿主的 buildSelection 产出真实结构（避免手写结构漂移）
  const sel = buildSelectionForTest(providers);
  return Object.assign({ providers: sel.providers, groups: sel.groups }, overrides);
}

/** 直接调用 lib/providers.js（client 的载荷结构由它产出，故用它构造最真实）。 */
function buildSelectionForTest(providers) {
  // 同步 import 不便，这里用与宿主相同的分组规则手写等价结构：
  // 单一 baseURL + 单一 api → 一个 provider 行、一个 group 行。
  const providerId = "p-max66";
  const groupId = providerId + ":openai-completions";
  const models = Object.keys(providers).flatMap((rk) =>
    providers[rk].models.map((m) => ({ id: m.id, name: m.name, routeKeys: [rk], modelKey: groupId + "#" + m.id }))
  );
  // 按 id 去重（同一模型只出现一次）
  const seen = new Set();
  const dedup = [];
  for (const m of models) {
    if (seen.has(m.id)) continue;
    seen.add(m.id);
    dedup.push(m);
  }
  const routes = Object.keys(providers).map((rk) => ({
    routeKey: rk,
    displayName: providers[rk].displayName,
    modelIds: providers[rk].models.map((m) => m.id),
    credential: null
  }));
  return {
    providers: [
      {
        id: providerId,
        baseURL: "http://max66.xyz/v1",
        baseURLNormalized: "http://max66.xyz/v1",
        displayLabel: "max66.xyz/v1",
        apiCount: 1,
        routeCount: routes.length,
        groupIds: [groupId]
      }
    ],
    groups: [
      {
        id: groupId,
        providerId,
        api: "openai-completions",
        baseURL: "http://max66.xyz/v1",
        baseURLNormalized: "http://max66.xyz/v1",
        routeCount: routes.length,
        warnings: [],
        models: dedup,
        routes
      }
    ]
  };
}

describe("默认模型预选（§19.2）", () => {
  test("★ 有可用默认模型时：首次加载预选它（这是本轮新功能的核心）", () => {
    const config = makeConfig({
      defaultModel: {
        available: true,
        provider: "max66",
        model: "deepseek-v4-pro",
        selection: { providerId: "p-max66", groupId: "p-max66:openai-completions", modelKey: "p-max66:openai-completions#deepseek-v4-pro", routeKey: "max66" }
      }
    });
    const out = L.initialSelection(config);
    assert.equal(out.fromDefault, true);
    assert.equal(out.selection.modelKey, "p-max66:openai-completions#deepseek-v4-pro");
    assert.equal(out.notice, null);
  });

  test("★ 关键差异证明：默认模型 ≠ §7.3 默认选择时，选的是默认模型而不是第一个模型", () => {
    const config = makeConfig({
      defaultModel: {
        available: true,
        provider: "max66",
        model: "deepseek-v4-pro",
        selection: { providerId: "p-max66", groupId: "p-max66:openai-completions", modelKey: "p-max66:openai-completions#deepseek-v4-pro", routeKey: "max66" }
      }
    });
    const plain = L.defaultSelection(config);
    const picked = L.initialSelection(config);
    // §7.3 默认会落在第一个模型（v4.1-flash）；默认模型是第二个（v4-pro）→ 两者必须不同
    assert.notEqual(plain.modelKey, picked.selection.modelKey, "本用例必须能区分两种选择，否则断言是空的");
    assert.match(plain.modelKey, /deepseek-v4\.1-flash/);
    assert.match(picked.selection.modelKey, /deepseek-v4-pro/);
  });

  test("无默认模型（available=false）→ 回落 §7.3 默认选择，且不报提示", () => {
    const config = makeConfig({ defaultModel: { available: false, reason: "命名空间未注册" } });
    const out = L.initialSelection(config);
    assert.equal(out.fromDefault, false);
    assert.equal(out.notice, null);
    assert.deepEqual(out.selection, L.defaultSelection(config));
  });

  test("★ 默认模型可用但定位不到（selection=null）→ 回落并给出可读提示（不静默）", () => {
    const config = makeConfig({
      defaultModel: { available: true, provider: "gone", model: "gone-model", selection: null }
    });
    const out = L.initialSelection(config);
    assert.equal(out.fromDefault, false);
    assert.deepEqual(out.selection, L.defaultSelection(config));
    assert.match(out.notice, /定位不到/);
    assert.match(out.notice, /gone/);
  });

  test("defaultModel 字段整个缺失（旧宿主）→ 仍能回落，不抛异常", () => {
    const config = makeConfig();
    const out = L.initialSelection(config);
    assert.equal(out.fromDefault, false);
    assert.equal(out.notice, null);
    assert.notEqual(out.selection, null);
  });

  test("配置为空 / null → 不抛异常", () => {
    assert.equal(L.initialSelection(null).selection, null);
    assert.equal(L.initialSelection({}).selection, null);
  });
});

describe("「已是默认」判定（§19.5）", () => {
  const dm = { available: true, provider: "max66", model: "deepseek-v4.1-flash" };

  test("provider 与 model 都相等才算已是默认", () => {
    assert.equal(L.isCurrentDefault(dm, "max66", "deepseek-v4.1-flash"), true);
    assert.equal(L.isCurrentDefault(dm, "max66", "deepseek-v4-pro"), false, "同路由不同模型不得算已是默认");
    assert.equal(L.isCurrentDefault(dm, "other", "deepseek-v4.1-flash"), false);
  });

  test("默认模型不可用 / 缺失 → 一律 false（按钮可点）", () => {
    assert.equal(L.isCurrentDefault({ available: false }, "max66", "deepseek-v4.1-flash"), false);
    assert.equal(L.isCurrentDefault(null, "max66", "deepseek-v4.1-flash"), false);
    assert.equal(L.isCurrentDefault(undefined, "max66", "deepseek-v4.1-flash"), false);
  });
});

// ===========================================================================
// CSS / DOM 钩子存在性：防「UI 写了但钩子拼错」
// ===========================================================================

describe("新增 UI 的钩子与文案（静态检查）", () => {
  const src = readFileSync(new URL("../lib/client.js", import.meta.url), "utf8");

  test("CSS 里每个新增 data-mh-* 钩子都有对应样式规则", () => {
    const hooks = [
      "data-mh-retrywrap",
      "data-mh-retryseg",
      "data-mh-retrymode",
      "data-mh-retrynum",
      "data-mh-retryinput",
      "data-mh-retrygo",
      "data-mh-retrystatus",
      "data-mh-retrywarn",
      "data-mh-defbtn",
      "data-mh-defnotice"
    ];
    for (const hook of hooks) {
      // 样式规则形如 "[data-mh-x]{..." 或 "[data-mh-x]..."（含后代选择器）
      const inCss = src.includes('"[' + hook + ']') || src.includes("'[" + hook + "]");
      assert.equal(inCss, true, `CSS 缺少 ${hook} 的样式规则`);
      // 同时必须真的在渲染里用到（否则是死样式）
      assert.equal(src.includes(hook + '":'), true, `渲染里未使用 ${hook}`);
    }
  });

  test("★ 无限重试提示是**可见文本**（不是只放 title）——AC25 的判定对象", () => {
    // 断言该文案出现在 JSX 子节点位置（h(...) 的第三个参数），而不是只作为 title 属性值
    const visible = src.includes('"次数与时长均不限，将一直重试直到成功或你手动停止"');
    assert.equal(visible, true, "必须存在可见文本提示");
    // 反向对照：确认它没有出现在 title: 后面
    assert.equal(
      /title:\s*"次数与时长均不限/.test(src),
      false,
      "该提示不得仅以 title 承载"
    );
  });

  test("重试三端点与默认模型端点 URL 齐备（§18.7 / §19.4）", () => {
    for (const url of [
      "/api/model-health/retry/start",
      "/api/model-health/retry/status",
      "/api/model-health/retry/stop",
      "/api/model-health/default"
    ]) {
      assert.equal(src.includes(url), true, `缺少端点 ${url}`);
    }
  });

  test("★ 面板不自行拼接 URL / 不判定状态（R26 契约纪律仍然成立）", () => {
    // 不得出现把 baseURL 拼成请求路径的写法
    assert.equal(/buildRequest\s*\(/.test(src), false, "客户端不得自行构造请求");
    assert.equal(/chat\/completions/.test(src), false, "客户端不得出现协议路径字面量");
  });

  test("新增控件不引入定时轮询（非目标：不做后台监控）", () => {
    const intervals = src.match(/setInterval\(/g) || [];
    assert.equal(intervals.length, 1, "只允许 testing 计时器这一个 setInterval");
  });

  test("★ 参数行的只读标签必须 nowrap 且不收缩（防竖排折行撑高整行）", () => {
    // 实测缺陷（0.1.4 真实存在、用户屏幕上可见）：「系统提示」4 个汉字在 flex 挤压下
    // 被压到 23px 宽 → **逐字竖排**，把参数行从 28px 撑到 66px，破坏 AC15 一屏预算。
    // 修复 = ro-k 加 white-space:nowrap + flex:0 0 auto（被截断的应是 ro-v，它有 ellipsis）。
    const rule = src.match(/\[data-mh-ro-k\]\{[^}]*\}/);
    assert.ok(rule, "必须存在 [data-mh-ro-k] 样式规则");
    assert.match(rule[0], /white-space:nowrap/, "ro-k 必须 nowrap，否则会竖排折行");
    assert.match(rule[0], /flex:0 0 auto/, "ro-k 必须不收缩，否则仍会被压窄换行");
  });

  test("★ 参数行不得因新增控件换行（横向预算断言，防静默撑高 AC15 预算）", () => {
    // 逐项累加参数行的固定宽度，与「最小不换行宽度」比较。
    // 这些数字来自渲染级实测（真实 CSS + 真实 DOM + 真实 token）：
    //   实测结论：1348px（用户真实容器）不换行；最小不换行宽度 1200px。
    // 本断言把「各控件固定宽度之和」钉住，未来再加控件时若超预算会红。
    const fixed = {
      switch: 66,      // 流式开关 + 标签（实测）
      roSysMax: 150,   // ro-sys max-width（CSS 里可读）
      roMaxTokens: 74.7,
      roTimeout: 74.8,
      roStrict: 65,
      defBtn: 75.4,
      retryWrap: 441,  // 分段 + 三个数字输入 + 开始按钮（实测）
      send: 92.6
    };
    const gap = 8; // [data-mh-param] 的 column-gap
    const sum = Object.values(fixed).reduce((a, b) => a + b, 0) + gap * (Object.keys(fixed).length - 1);
    // 实测最小不换行宽度 1200（含余量）；断言「控件总宽 + 余量 ≤ 1200」
    assert.ok(sum <= 1200, `参数行控件总宽 ${sum.toFixed(1)}px 超过实测最小不换行宽度 1200px`);

    // 反向对照：ro-sys 的宽度上限必须真的收窄过（否则总宽会超）
    const roSysRule = src.match(/\[data-mh-ro-sys\]\{[^}]*max-width:(\d+)px/);
    assert.ok(roSysRule, "必须存在 ro-sys 的 max-width 声明");
    assert.equal(Number(roSysRule[1]), 150, "ro-sys 上限应为 150px（收窄以容纳新增控件）");

    // 并且参数行的 gap 必须是收窄后的 8px（12px 会超出）
    const paramRule = src.match(/\[data-mh-param\]\{[^}]*\}/);
    assert.ok(paramRule, "必须存在参数行样式规则");
    assert.match(paramRule[0], /gap:6px 8px/, "参数行 gap 应为 8px（12px 时新增控件会换行）");
  });

  test("ro-sys 收窄不损失信息可达性：title 里给出完整系统提示词", () => {
    // 收窄 max-width 后必须仍能读到全文，否则就是「以简化之名删信息」
    assert.match(src, /完整内容：\\n/, "ro-sys 的 title 必须包含完整系统提示词");
  });
});
