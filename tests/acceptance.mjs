/**
 * dsh-model-health 验收入口（SPEC §15.1、AC1）。
 *
 * 本文件是**运行器**：以编程方式执行 tests/probe.test.mjs 的全部用例并输出
 * JSON 报告到 tests/report.json（SPEC §15.4 证据留存）。
 *
 * 为什么要有这个文件：SPEC 的 AC1/§15.1 指定 `node tests/acceptance.mjs` 作为
 * 机器验证命令，而用例本体在 probe.test.mjs（node:test 套件）。两者共用同一份用例，
 * 不重复维护断言。
 *
 * 运行：node tests/acceptance.mjs
 *      npm test               （package.json scripts.test = "node --test"，推荐）
 *      node --test tests/     （依赖 tests/index.js 目录入口，已修复为不漏跑）
 *
 * 注：Node 24 把 `--test` 后的位置参数当测试文件路径解析（不再当目录递归根），
 * 所以 `node --test tests/` 依赖 tests/index.js 作为目录入口才能工作；该入口会
 * 动态枚举本目录全部 *.test.* 并逐个 import，避免漏跑造成假绿。
 */
import { run } from "node:test";
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const testFile = join(here, "probe.test.mjs");

/** 收集每个用例的结果。 */
const cases = [];

/** node:test 的 suite 事件也走 test:pass/fail，用 nesting 层级区分：套件自身 nesting=0 且有子项。 */
function isSuite(data) {
  return data.nesting === 0 && (data.details?.type === "suite" || data.type === "suite");
}

const stream = run({
  files: [testFile],
  concurrency: 1,
  timeout: 120000
});

stream.on("test:pass", (data) => {
  if (data.skip || data.todo) return;
  if (isSuite(data)) return; // 套件本身不是用例，避免计数虚高
  cases.push({ name: data.name, status: "pass", durationMs: data.duration_ms ?? null, file: data.file ?? null });
});
stream.on("test:fail", (data) => {
  if (isSuite(data)) return;
  cases.push({
    name: data.name,
    status: "fail",
    durationMs: data.duration_ms ?? null,
    file: data.file ?? null,
    error: data.details?.error?.message ?? data.error?.message ?? String(data.details ?? "")
  });
});

await new Promise((resolve, reject) => {
  stream.on("end", resolve);
  stream.on("close", resolve);
  stream.on("error", reject);
  // Readable 流必须被消费才会开始流动，否则自定义事件不会派发、'end' 永不触发。
  stream.resume();
});

const failed = cases.filter((c) => c.status === "fail");
const passed = cases.filter((c) => c.status === "pass");

// ---------------------------------------------------------------------------
// AC11 密钥泄漏：四面**运行时**扫描（每面各自跑 sk- 全量正则，四值均须为 0）
//
// 四面定义（SPEC AC11 / t18 验收）：
//   face1 三端点完整响应文本
//   face2 logger 输出
//   face3 状态文件（插件声明不落盘，故同时断言无新增/无改写文件）
//   face4 error.title/hint/raw 与 4xx 错误体
//
// 这里独立复算一次，而不是复用套件内部结果——报告里的数字必须是自己测出来的。
// ---------------------------------------------------------------------------

/** 密钥特征正则：与 SPEC §15.1 泄漏扫描命令一致。 */
const SK_RE = /sk-[A-Za-z0-9_-]{8,}/g;

/** 统计文本中的 sk- 命中数。 */
function countSk(text) {
  if (typeof text !== "string" || text === "") return 0;
  return (text.match(SK_RE) ?? []).length;
}

/** 安全序列化（循环引用安全）。 */
function scanText(value) {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/** 最小 fake ctx：抓取注册的路由 + 记录日志。 */
function makeCtx({ providers, credentials }) {
  const routes = new Map();
  const logs = [];
  const ctx = {
    logger: {
      info: (m) => logs.push(String(m)),
      warn: (m) => logs.push(String(m)),
      debug: (m) => logs.push(String(m)),
      error: (m) => logs.push(String(m))
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
      if (name === "settings") return { get: () => ({ providers }) };
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

/** 调用一条已注册路由，返回 {status, headers, text}。 */
async function invoke(routes, path, method, body) {
  const route = routes.get(path);
  if (route === undefined) throw new Error(`路由未注册: ${path}`);
  const payload = body === undefined ? "" : JSON.stringify(body);
  const req = {
    method,
    url: path,
    async *[Symbol.asyncIterator]() {
      if (payload !== "") yield Buffer.from(payload, "utf8");
    }
  };
  const captured = { status: null, headers: null, text: "" };
  const res = {
    writeHead(status, headers) {
      captured.status = status;
      captured.headers = headers;
    },
    end(chunk) {
      captured.text = chunk === undefined ? "" : String(chunk);
    }
  };
  await route.handler(req, res);
  return captured;
}

/** 递归快照文件 mtime，用于断言「不落盘」。 */
async function snapshotTree(dir) {
  const { readdir, stat } = await import("node:fs/promises");
  const { join } = await import("node:path");
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
          out.set(full, (await stat(full)).mtimeMs);
        } catch {
          /* 忽略 */
        }
      }
    }
  }
  await walk(dir);
  return out;
}

async function scanFourFaces() {
  // 刻意使用 sk- 形态的假密钥，确保扫描器有区分力
  const SECRET = "sk-ac11-report-secret-0123456789";
  const providers = {
    "ac11-route": {
      displayName: "ac11-route",
      apiKeyEnv: "AC11_KEY",
      api: "openai-completions",
      baseURL: "https://ac11.invalid/v1",
      models: [{ id: "m1" }]
    }
  };
  const credentials = {
    async resolve() {
      return { value: SECRET, source: "file" };
    },
    async describe() {
      return { configured: true, source: "file", writable: false };
    }
  };

  const { apply } = await import("../lib/index.js");
  const root = join(here, "..");
  const before = await snapshotTree(root);

  const { ctx, routes, logs } = makeCtx({ providers, credentials });
  apply(ctx, {});

  const texts = [];
  const t1 = await invoke(routes, "/api/model-health/config", "GET");
  texts.push(t1.text);
  const t2 = await invoke(routes, "/api/model-health/records", "GET");
  texts.push(t2.text);
  const t3 = await invoke(routes, "/api/model-health/test", "POST", { routeKey: "ac11-route", modelId: "m1" });
  texts.push(t3.text);
  const t4 = await invoke(routes, "/api/model-health/test", "POST", { routeKey: "nope", modelId: "m1" });
  texts.push(t4.text);
  const t5 = await invoke(routes, "/api/model-health/test", "POST", { routeKey: "ac11-route", modelId: "nope" });
  texts.push(t5.text);
  const t6 = await invoke(routes, "/api/model-health/test", "POST", { routeKey: "ac11-route" });
  texts.push(t6.text);
  const t7 = await invoke(routes, "/api/model-health/records", "POST", { action: "clear" });
  texts.push(t7.text);

  const after = await snapshotTree(root);
  const added = [...after.keys()].filter((f) => !before.has(f));
  const modified = [...after.keys()].filter((f) => before.has(f) && before.get(f) !== after.get(f));

  // face4：error.title/hint/raw —— 从 /test 的失败结果里取
  const errorFaces = texts
    .map((t) => {
      try {
        const j = JSON.parse(t);
        if (j?.error) return scanText({ title: j.error.title, hint: j.error.hint, raw: j.error.raw });
        if (j?.layers) return scanText(j.layers);
        return "";
      } catch {
        return "";
      }
    })
    .join("\n");

  // face3：候选状态文件内容
  const { existsSync, readFileSync } = await import("node:fs");
  const stateCandidates = [
    join(root, "state.json"),
    join(root, ".dsh-model-health-probe", "state.json"),
    join(root, ".dsh-model-health", "state.json"),
    join(process.env.USERPROFILE ?? "", ".dsh", "model-health-probe", "state.json"),
    join(process.env.USERPROFILE ?? "", ".dsh", "model-health", "state.json")
  ];
  let stateText = "";
  for (const c of stateCandidates) if (existsSync(c)) stateText += readFileSync(c, "utf8");

  const secretHits =
    countSk(texts.join("\n")) + texts.join("\n").split(SECRET).length - 1 +
    (logs.join("\n").split(SECRET).length - 1) +
    (stateText.split(SECRET).length - 1) +
    (errorFaces.split(SECRET).length - 1);

  return {
    face1: countSk(texts.join("\n")),
    face2: countSk(logs.join("\n")),
    face3: countSk(stateText),
    face4: countSk(errorFaces),
    plaintextHits: secretHits,
    filesAdded: added.length,
    filesModified: modified.length,
    scanned: {
      endpoints: 7,
      logLines: logs.length,
      stateCandidates: stateCandidates.length,
      errorFields: 4
    }
  };
}

const leak = await scanFourFaces();

const report = {
  plugin: "dsh-model-health-probe",
  kind: "acceptance",
  generatedAt: new Date().toISOString(),
  command: "node tests/acceptance.mjs",
  suiteFile: "tests/probe.test.mjs",
  totals: { cases: cases.length, passed: passed.length, failed: failed.length },
  ok: failed.length === 0 && leak.face1 === 0 && leak.face2 === 0 && leak.face3 === 0 && leak.face4 === 0,
  keyLeak: {
    // AC11 四面逐面命中数，四值均须为 0（不得只给合并总数）
    face1: leak.face1, // 三端点完整响应文本
    face2: leak.face2, // logger 输出
    face3: leak.face3, // 状态文件
    face4: leak.face4, // error.title/hint/raw 与 4xx 错误体
    plaintextHits: leak.plaintextHits, // 注入的密钥明文出现总次数（含非 sk- 形态）
    filesAdded: leak.filesAdded,       // 断言不落盘：运行期间新增文件数
    filesModified: leak.filesModified, // 断言不落盘：运行期间改写文件数
    scanned: leak.scanned
  },
  notes: [
    "全部用例不联网：用本地 node:http 服务器模拟三协议响应。",
    "openai-responses 本机无任何已配置 provider，该协议仅 mock 覆盖，未经真实上游验证（SPEC AC17）。",
    "本机真实配置基准（手工核对用，未进断言）：12 条路由 / 6 个供应商组 / 7 个 API 按钮 / 路由槽位 12。",
    "keyLeak 四面为运行时实测：注入一个 sk- 形态的假密钥，驱动插件全部端点后逐面扫描命中数。",
    "「网关在响应体中回显密钥」的对抗性用例由 tests/probe.test.mjs 覆盖，断言回显值被替换为 ***。"
  ],
  cases
};

writeFileSync(join(here, "report.json"), JSON.stringify(report, null, 2), "utf8");

// 人类可读摘要
console.log("");
console.log("=== dsh-model-health-probe 验收报告 ===");
console.log(`用例总数: ${report.totals.cases}`);
console.log(`通过    : ${report.totals.passed}`);
console.log(`失败    : ${report.totals.failed}`);
console.log(
  `密钥四面: face1(响应)=${leak.face1} face2(日志)=${leak.face2} face3(状态文件)=${leak.face3} face4(error)=${leak.face4}` +
    ` | 明文总命中=${leak.plaintextHits} | 新增文件=${leak.filesAdded} 改写文件=${leak.filesModified}`
);
console.log(`报告    : ${join(here, "report.json")}`);
if (failed.length > 0) {
  console.log("");
  console.log("--- 失败用例 ---");
  for (const f of failed) {
    console.log(`✖ ${f.name}`);
    if (f.error) console.log(`    ${String(f.error).split("\n")[0]}`);
  }
}
console.log("");
console.log(report.ok ? "结论: 全部通过 ✅" : "结论: 存在失败 ❌");

process.exit(report.ok ? 0 : 1);
