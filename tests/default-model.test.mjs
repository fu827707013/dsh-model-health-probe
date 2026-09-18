/**
 * 「当前默认模型」读写与映射的验收用例（SPEC §19）。
 *
 * 本文件**不联网、不碰真实 settings**：用一个内存假 settings 服务注入 ctx，
 * 因此可以精确断言「读了什么、写了什么、写的是哪一节」。
 *
 * 覆盖：
 *   - 读：命名空间缺失/为空/字段不全/正常；source 的 user vs base 判定
 *   - 映射：routeKey+modelId → 四层选择状态（含同 baseURL 多 api 分组的易错点）
 *   - 映射：AC23 不变式（所选路由必须声明所选模型）
 *   - 写：replace 语义（不是 update）、只写 agent-default-model 一节、effort 取舍
 *   - 写：settings 不可用/不可写时的降级（不抛异常）
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  readDefaultModel,
  writeDefaultModel,
  selectionForRouteModel,
  modelSupportsEffort,
  DEFAULT_MODEL_NAMESPACE
} from "../lib/default-model.js";
import { buildSelection, normalizeEfforts } from "../lib/providers.js";

// ---------------------------------------------------------------------------
// 假 settings 服务：只实现本模块用到的四个成员
// ---------------------------------------------------------------------------

function createFakeSettings({ value, user = undefined, writable = true } = {}) {
  const state = { value, user, writes: [], failWith: null };
  return {
    state,
    get(ns) {
      if (ns !== DEFAULT_MODEL_NAMESPACE) return undefined;
      return state.value;
    },
    describe() {
      const d = { ns: DEFAULT_MODEL_NAMESPACE, value: state.value, revision: 1, applies: "live" };
      if (state.user !== undefined) d.user = state.user;
      return [d];
    },
    async replace(ns, section) {
      if (state.failWith !== null) throw new Error(state.failWith);
      if (!writable) throw new Error("read-only provider");
      state.writes.push({ ns, section: JSON.parse(JSON.stringify(section)) });
      state.value = section;
    },
    async update() {
      throw new Error("update 不应被调用（本模块只用 replace）");
    }
  };
}

const ctxWith = (settings) => ({ get: (name) => (name === "settings" ? settings : undefined) });

// ---------------------------------------------------------------------------
// 读
// ---------------------------------------------------------------------------

describe("默认模型读取（§19.2）", () => {
  test("正常读取：provider/model/reasoningEffort 齐备，available=true", () => {
    const settings = createFakeSettings({
      value: { provider: "max66", model: "deepseek-v4.1-flash", reasoningEffort: "max" }
    });
    const out = readDefaultModel(ctxWith(settings));
    assert.equal(out.available, true);
    assert.equal(out.provider, "max66");
    assert.equal(out.model, "deepseek-v4.1-flash");
    assert.equal(out.reasoningEffort, "max");
    assert.equal(out.reason, null);
  });

  test("reasoningEffort 缺省时为 null（不是 undefined）", () => {
    const settings = createFakeSettings({ value: { provider: "max66", model: "m" } });
    const out = readDefaultModel(ctxWith(settings));
    assert.equal(out.reasoningEffort, null);
    assert.equal(out.available, true);
  });

  test("source=user：用户层显式含 provider 时判 user", () => {
    const settings = createFakeSettings({
      value: { provider: "max66", model: "m" },
      user: { provider: "max66", model: "m" }
    });
    assert.equal(readDefaultModel(ctxWith(settings)).source, "user");
  });

  test("source=base：只有 composition 默认值（user 层缺省）时判 base", () => {
    const settings = createFakeSettings({ value: { provider: "deepseek-official", model: "deepseek-flash" } });
    assert.equal(readDefaultModel(ctxWith(settings)).source, "base");
  });

  test("settings 服务缺失 → available=false + 中文原因（不抛异常）", () => {
    const out = readDefaultModel({ get: () => undefined });
    assert.equal(out.available, false);
    assert.match(out.reason, /settings/);
  });

  test("get 抛异常（命名空间未注册）→ available=false + 中文原因", () => {
    const out = readDefaultModel({ get: () => ({ get: () => { throw new TypeError("bad namespace"); } }) });
    assert.equal(out.available, false);
    assert.match(out.reason, /未注册/);
  });

  test("值非对象 / provider 或 model 缺失 → available=false", () => {
    for (const value of [null, undefined, "x", 42, {}, { provider: "p" }, { model: "m" }]) {
      const settings = createFakeSettings({ value });
      const out = readDefaultModel(ctxWith(settings));
      assert.equal(out.available, false, `${JSON.stringify(value)} 应不可用`);
    }
  });
});

// ---------------------------------------------------------------------------
// 映射：routeKey + modelId → 四层选择状态
// ---------------------------------------------------------------------------

/** 本机形态的缩小样本：max66 的 baseURL 同时有 openai 与 anthropic 两个分组。 */
function makeConfig() {
  const providers = {
    max66: {
      displayName: "max66",
      api: "openai-completions",
      baseURL: "http://max66.xyz/v1",
      models: [
        { id: "deepseek-v4.1-flash", name: "deepseek-v4.1-flash", reasoningEfforts: { off: null, low: "low", max: "max" } },
        { id: "deepseek-v4-pro", name: "deepseek-v4-pro", reasoningEfforts: { low: "low" } }
      ]
    },
    "aimax66-anthropic": {
      displayName: "aimax66",
      api: "anthropic-messages",
      baseURL: "http://max66.xyz/v1",
      models: [{ id: "deepseek-v4.1-flash", name: "deepseek-v4.1-flash", reasoningEfforts: { max: "max" } }]
    },
    happycodeai: {
      displayName: "happycodeai",
      api: "openai-completions",
      baseURL: "https://happycodeai.com/v1",
      models: [{ id: "gpt-image-2", name: "gpt-image-2" }]
    }
  };
  const sel = buildSelection(providers, {});
  return { providers: sel.providers, groups: sel.groups };
}

describe("默认模型 → 选择状态映射（§19.2）", () => {
  test("★ 同 baseURL 下多 api 分组：必须逐分组查找，不能只看第一个", () => {
    const config = makeConfig();
    // aimax66-anthropic 落在同一 baseURL 的第二个分组里
    const sel = selectionForRouteModel(config, "aimax66-anthropic", "deepseek-v4.1-flash");
    assert.notEqual(sel, null, "必须能在第二个分组里定位到");
    const group = config.groups.find((g) => g.id === sel.groupId);
    assert.equal(group.api, "anthropic-messages");
    assert.equal(sel.routeKey, "aimax66-anthropic");
    assert.equal(sel.modelKey, group.id + "#deepseek-v4.1-flash");
  });

  test("映射结果必须自洽：routeKey 属于该模型、modelKey 属于该分组（AC23 不变式）", () => {
    const config = makeConfig();
    for (const routeKey of ["max66", "aimax66-anthropic", "happycodeai"]) {
      const modelId = routeKey === "happycodeai" ? "gpt-image-2" : "deepseek-v4.1-flash";
      const sel = selectionForRouteModel(config, routeKey, modelId);
      assert.notEqual(sel, null, `${routeKey}/${modelId} 应可定位`);
      const group = config.groups.find((g) => g.id === sel.groupId);
      const model = group.models.find((m) => m.modelKey === sel.modelKey);
      assert.equal(model.id, modelId);
      assert.ok(model.routeKeys.includes(sel.routeKey), "所选路由必须声明所选模型");
      assert.ok(group.routes.some((r) => r.routeKey === sel.routeKey));
    }
  });

  test("路由存在但该分组不声明这个模型 → null（不得张冠李戴）", () => {
    const config = makeConfig();
    // max66 分组没有 gpt-image-2
    assert.equal(selectionForRouteModel(config, "max66", "gpt-image-2"), null);
  });

  test("路由或模型不存在 / 参数畸形 → null（不抛异常）", () => {
    const config = makeConfig();
    assert.equal(selectionForRouteModel(config, "no-such-route", "deepseek-v4.1-flash"), null);
    assert.equal(selectionForRouteModel(config, "max66", "no-such-model"), null);
    assert.equal(selectionForRouteModel(null, "max66", "x"), null);
    assert.equal(selectionForRouteModel(config, "", "x"), null);
    assert.equal(selectionForRouteModel(config, 123, "x"), null);
  });
});

// ---------------------------------------------------------------------------
// reasoningEfforts 归一化 + effort 支持判定
// ---------------------------------------------------------------------------

describe("推理挡位归一化与支持判定（§19.3）", () => {
  test("对象形态（键即挡位名）与数组形态都归一成字符串数组", () => {
    assert.deepEqual(normalizeEfforts({ off: null, low: "low", max: "max" }), ["off", "low", "max"]);
    assert.deepEqual(normalizeEfforts(["low", "high"]), ["low", "high"]);
    assert.deepEqual(normalizeEfforts(undefined), []);
    assert.deepEqual(normalizeEfforts(null), []);
    assert.deepEqual(normalizeEfforts("max"), []);
  });

  test("modelSupportsEffort：按真实配置判定", () => {
    const config = makeConfig();
    assert.equal(modelSupportsEffort(config, "max66", "deepseek-v4.1-flash", "max"), true);
    assert.equal(modelSupportsEffort(config, "max66", "deepseek-v4.1-flash", "xhigh"), false, "该模型无 xhigh");
    assert.equal(modelSupportsEffort(config, "max66", "deepseek-v4-pro", "max"), false, "pro 只声明了 low");
    assert.equal(modelSupportsEffort(config, "happycodeai", "gpt-image-2", "max"), false, "未声明挡位");
    assert.equal(modelSupportsEffort(config, "max66", "deepseek-v4.1-flash", null), false);
    assert.equal(modelSupportsEffort(config, "max66", "deepseek-v4.1-flash", ""), false);
  });
});

// ---------------------------------------------------------------------------
// 写
// ---------------------------------------------------------------------------

describe("默认模型写入（§19.3）", () => {
  test("只写 agent-default-model 一节，且用 replace（不是 update）", async () => {
    const settings = createFakeSettings({ value: { provider: "old", model: "old" } });
    const out = await writeDefaultModel(ctxWith(settings), { routeKey: "max66", modelId: "deepseek-v4.1-flash" });
    assert.equal(out.ok, true);
    assert.equal(settings.state.writes.length, 1);
    assert.equal(settings.state.writes[0].ns, DEFAULT_MODEL_NAMESPACE);
    assert.deepEqual(settings.state.writes[0].section, { provider: "max66", model: "deepseek-v4.1-flash" });
  });

  test("effort 合法时一并写入", async () => {
    const settings = createFakeSettings({ value: { provider: "old", model: "old" } });
    await writeDefaultModel(ctxWith(settings), { routeKey: "max66", modelId: "m", reasoningEffort: "max" });
    assert.deepEqual(settings.state.writes[0].section, { provider: "max66", model: "m", reasoningEffort: "max" });
  });

  test("★ effort 为空/null 时不写入该键（replace 语义 = 回落宿主默认，不残留旧挡位）", async () => {
    const settings = createFakeSettings({ value: { provider: "old", model: "old", reasoningEffort: "max" } });
    await writeDefaultModel(ctxWith(settings), { routeKey: "max66", modelId: "m", reasoningEffort: null });
    assert.deepEqual(settings.state.writes[0].section, { provider: "max66", model: "m" });
    assert.equal("reasoningEffort" in settings.state.writes[0].section, false, "不得残留旧 effort");
  });

  test("写入后回读得到新值（闭环）", async () => {
    const settings = createFakeSettings({ value: { provider: "old", model: "old" } });
    await writeDefaultModel(ctxWith(settings), { routeKey: "max66", modelId: "deepseek-v4-pro" });
    const now = readDefaultModel(ctxWith(settings));
    assert.equal(now.provider, "max66");
    assert.equal(now.model, "deepseek-v4-pro");
  });

  test("routeKey / modelId 缺失或非字符串 → 400，且不发起任何写入", async () => {
    const settings = createFakeSettings({ value: {} });
    for (const bad of [{}, { routeKey: "a" }, { modelId: "b" }, { routeKey: "", modelId: "b" }, { routeKey: 1, modelId: 2 }]) {
      const out = await writeDefaultModel(ctxWith(settings), bad);
      assert.equal(out.ok, false);
      assert.equal(out.httpStatus, 400);
    }
    assert.equal(settings.state.writes.length, 0, "非法入参不得写入");
  });

  test("settings 不可用 / 不可写 → 明确失败（不抛异常、不谎报成功）", async () => {
    const missing = await writeDefaultModel({ get: () => undefined }, { routeKey: "a", modelId: "b" });
    assert.equal(missing.ok, false);
    assert.equal(missing.code, "SETTINGS_READONLY");

    const settings = createFakeSettings({ value: {}, writable: false });
    const denied = await writeDefaultModel(ctxWith(settings), { routeKey: "a", modelId: "b" });
    assert.equal(denied.ok, false);
    assert.equal(denied.code, "SETTINGS_WRITE_FAILED");
    assert.match(denied.message, /read-only/);
  });

  test("写入异常被捕获为结构化失败，不冒泡成未处理拒绝", async () => {
    const settings = createFakeSettings({ value: {} });
    settings.state.failWith = "磁盘只读";
    const out = await writeDefaultModel(ctxWith(settings), { routeKey: "a", modelId: "b" });
    assert.equal(out.ok, false);
    assert.equal(out.code, "SETTINGS_WRITE_FAILED");
    assert.match(out.message, /磁盘只读/);
  });
});
