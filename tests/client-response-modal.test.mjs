/**
 * 响应内容视图的用例：JSON 格式化、请求详情分块、放大弹窗的钩子与无障碍。
 *
 * 为什么要单测这些「纯逻辑」：用户明确要求「原始响应 / 请求详情可弹出显示 + JSON 格式化」，
 * 并特别指出**请求详情不是一个完整 JSON，是分块内容**。分块判断与「截断后必然解析失败」
 * 这两条边界都不在默认渲染路径上——只靠 DOM 断言会漏掉它们（此前第四行「分组作用域」
 * 那次的教训同源）。
 *
 * 本文件**不加载浏览器**：用与 client-retry-default.test.mjs 相同的 `__ModuleLoader__`
 * 桩把 client.js 求值出来，直接调 `exports.__logic`。
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

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
  const fn = new Function("window", src);
  fn(sandbox);

  assert.ok(captured !== null, "client.js 必须调用 __ModuleLoader__.load");
  assert.equal(captured.id, "dsh-model-health-probe");

  const stubRequire = (name) => {
    if (name === "react") {
      return {
        createElement: () => null,
        useState: () => [],
        useEffect: () => {},
        useCallback: () => () => {},
        useRef: () => ({}),
        useMemo: () => null
      };
    }
    // react-dom 缺失：验证 client.js 的 try/catch 回退分支不会炸（见「portal 回退」用例）
    throw new Error("unexpected require: " + name);
  };
  return captured.factory(stubRequire);
}

const client = loadClient();
const L = client.__logic;

// ===========================================================================
// JSON 格式化
// ===========================================================================

describe("tryFormatJson：只认对象与数组，绝不改语义", () => {
  test("对象与数组可格式化，缩进默认 2 空格", () => {
    const o = L.tryFormatJson('{"a":1,"b":[2,3]}');
    assert.equal(o.ok, true);
    assert.equal(o.kind, "object");
    assert.equal(o.text, '{\n  "a": 1,\n  "b": [\n    2,\n    3\n  ]\n}');

    const a = L.tryFormatJson("[1,2]");
    assert.equal(a.ok, true);
    assert.equal(a.kind, "array");
    assert.equal(a.text, "[\n  1,\n  2\n]");
  });

  test("★ 裸标量不算可格式化（JSON.parse 接受它们，但会剥掉引号改变语义）", () => {
    for (const raw of ["123", '"OK"', "true", "null"]) {
      const r = L.tryFormatJson(raw);
      assert.equal(r.ok, false, `${raw} 不应被判为可格式化`);
      assert.equal(typeof r.reason, "string");
    }
  });

  test("非法 JSON 返回原因而不是抛异常", () => {
    for (const raw of ["{", '{"a":}', "not json at all", ""]) {
      let r;
      assert.doesNotThrow(() => {
        r = L.tryFormatJson(raw);
      }, `${JSON.stringify(raw)} 不得抛异常`);
      assert.equal(r.ok, false);
      assert.equal(typeof r.reason, "string");
      assert.ok(r.reason.length > 0, "必须给出非空原因");
    }
  });

  test("缩进参数可调；非法缩进回退 2", () => {
    assert.equal(L.tryFormatJson('{"a":1}', 0).text, '{"a":1}');
    assert.equal(L.tryFormatJson('{"a":1}', 4).text, '{\n    "a": 1\n}');
    assert.equal(L.tryFormatJson('{"a":1}', "x").text, '{\n  "a": 1\n}');
  });

  test("null / undefined 输入不抛", () => {
    assert.equal(L.tryFormatJson(null).ok, false);
    assert.equal(L.tryFormatJson(undefined).ok, false);
  });
});

// ===========================================================================
// 分块视图模型：请求详情不是一个完整 JSON
// ===========================================================================

const RESULT = {
  responseText: "OK",
  responseRaw: '[{"event":"message","data":"{\\"content\\":\\"OK\\"}"}]',
  requestHeaders: { authorization: "Bearer ***", "content-type": "application/json" },
  requestBodyPreview: '{"model":"gpt-x","messages":[{"role":"user","content":"ping"}]}',
  usageSource: "openai",
  truncated: false
};

describe("viewModel：请求详情按块渲染（用户明确指出它不是完整 JSON）", () => {
  test("★ 请求详情 = 三块（系统提示 / 请求头 / 请求体），不是一整块", () => {
    const vm = L.viewModel(RESULT, "req", "你是助手", false);
    assert.equal(vm.view, "req");
    assert.equal(vm.title, "请求详情");
    assert.deepEqual(
      vm.blocks.map((b) => b.key),
      ["sys", "headers", "body"]
    );
    assert.deepEqual(
      vm.blocks.map((b) => b.label),
      ["系统提示", "请求头", "请求体"]
    );
  });

  test("★ 对请求详情整体做 JSON.parse 必然失败（证明分块是必需的）", () => {
    const vm = L.viewModel(RESULT, "req", "你是助手", false);
    const joined = vm.blocks.map((b) => b.text).join("\n\n");
    assert.equal(L.tryFormatJson(joined).ok, false, "拼接后的整体不得是可解析 JSON");
  });

  test("各块独立判断能否美化：请求体可以，系统提示不行", () => {
    const vm = L.viewModel(RESULT, "req", "你是助手", true);
    const byKey = Object.fromEntries(vm.blocks.map((b) => [b.key, b]));
    assert.equal(byKey.body.canPretty, true, "请求体是 JSON，应可美化");
    assert.equal(byKey.body.pretty, true, "美化开启时请求体应已缩进");
    assert.match(byKey.body.text, /\n  "model"/, "缩进应为 2 空格");
    assert.equal(byKey.sys.canPretty, false, "系统提示是自然语言，不可美化");
    assert.equal(byKey.sys.pretty, false);
    // 美化开启但该块不可解析 → 必须给出原因（否则用户不知道「为什么没缩进」）
    assert.equal(typeof byKey.sys.reason, "string");
    assert.ok(byKey.sys.reason.length > 0);

    // 反向对照：美化**关闭**时不该带原因，避免给原文渲染加无谓噪音
    const plain = L.viewModel(RESULT, "req", "你是助手", false);
    assert.equal(plain.blocks.find((b) => b.key === "sys").reason, null);
    assert.equal(plain.blocks.find((b) => b.key === "body").reason, null);
  });

  test("★ 美化开启但某块不可解析时给出原因（不静默保持原文）", () => {
    const vm = L.viewModel(RESULT, "req", "你是助手", true);
    const sys = vm.blocks.find((b) => b.key === "sys");
    assert.equal(typeof sys.reason, "string");
    assert.ok(sys.reason.length > 0);
  });

  test("★ 被截断的请求体：原因优先说「已截断」，不误导成用户写错了 JSON", () => {
    const truncatedBody = '{"model":"gpt-x","messages":[{"role":"user","conte';
    const r = Object.assign({}, RESULT, { requestBodyPreview: truncatedBody });
    const vm = L.viewModel(r, "req", "sys", true);
    const body = vm.blocks.find((b) => b.key === "body");
    assert.equal(body.canPretty, false);
    assert.match(body.reason, /截断/, "原因必须点名截断");
    assert.equal(body.text, truncatedBody, "原文必须原样保留，不得截断展示");
  });

  test("原始响应：数组可美化；模型文本永不美化（规格：模型文本不是代码）", () => {
    const raw = L.viewModel(RESULT, "raw", "sys", true);
    assert.equal(raw.blocks.length, 1);
    assert.equal(raw.blocks[0].canPretty, true);
    assert.equal(raw.blocks[0].pretty, true);
    assert.equal(raw.canPretty, true);

    // 模型文本即使内容是 JSON 也不美化
    const jsonText = Object.assign({}, RESULT, { responseText: '{"a":1}' });
    const model = L.viewModel(jsonText, "model", "sys", true);
    assert.equal(model.blocks[0].pretty, false, "模型文本档不得美化");
    assert.equal(model.blocks[0].text, '{"a":1}', "应原样渲染");
  });

  test("请求详情的复制文本是**原文**（不是美化后的排版）", () => {
    const vm = L.viewModel(RESULT, "req", "你是助手", true);
    assert.match(vm.copyText, /^系统提示：\n你是助手/);
    assert.match(vm.copyText, /请求体：\n\{"model"/, "复制内容应是单行原文");
  });

  test("空响应：blocks 单块且 empty 为真", () => {
    const empty = Object.assign({}, RESULT, { responseText: "", responseRaw: null });
    const m = L.viewModel(empty, "model", "sys", false);
    assert.equal(m.blocks[0].empty, true);
    assert.equal(m.copyText, "");
    const r = L.viewModel(empty, "raw", "sys", false);
    assert.equal(r.blocks[0].empty, true);
  });

  test("liveResult 为 null（未测试）：返回空模型而不抛", () => {
    for (const v of ["model", "raw", "req"]) {
      const vm = L.viewModel(null, v, "sys", true);
      assert.deepEqual(vm.blocks, []);
      assert.equal(vm.copyText, "");
      assert.equal(vm.canPretty, false);
      assert.ok(vm.title.length > 0);
    }
  });

  test("view 取值非法时回落到 model（不产生空白面板）", () => {
    assert.equal(L.viewModel(RESULT, "bogus", "sys", false).view, "model");
    assert.equal(L.viewModel(RESULT, null, "sys", false).view, "model");
    assert.equal(L.viewModel(RESULT, undefined, "sys", false).view, "model");
  });

  test("requestBodyPreview 为 null 时该块为空而不抛", () => {
    const r = Object.assign({}, RESULT, { requestBodyPreview: null });
    const vm = L.viewModel(r, "req", "sys", false);
    const body = vm.blocks.find((b) => b.key === "body");
    assert.equal(body.empty, true);
    assert.equal(body.text, "");
  });
});

// ===========================================================================
// 计量
// ===========================================================================

describe("textMetrics：字符 / 行 / UTF-8 字节", () => {
  test("ASCII 三计量一致", () => {
    assert.deepEqual(L.textMetrics("abc"), { chars: 3, lines: 1, bytes: 3 });
  });

  test("中文按 UTF-8 算 3 字节（不是 length）", () => {
    const m = L.textMetrics("中文");
    assert.equal(m.chars, 2);
    assert.equal(m.bytes, 6);
  });

  test("emoji 代理对按 4 字节且不重复计数", () => {
    const m = L.textMetrics("\u{1F600}");
    assert.equal(m.chars, 2, "JS length 为 2（代理对）");
    assert.equal(m.bytes, 4, "UTF-8 为 4 字节");
  });

  test("空串 0 行（不是 1 行）", () => {
    assert.deepEqual(L.textMetrics(""), { chars: 0, lines: 0, bytes: 0 });
  });

  test("多行计数正确", () => {
    assert.equal(L.textMetrics("a\nb\nc").lines, 3);
  });

  test("metricsText 是给用户看的一行中文", () => {
    assert.equal(L.metricsText("ab"), "2 字符 · 1 行 · 2 字节");
  });

  test("null / undefined 不抛", () => {
    assert.deepEqual(L.textMetrics(null), { chars: 0, lines: 0, bytes: 0 });
    assert.deepEqual(L.textMetrics(undefined), { chars: 0, lines: 0, bytes: 0 });
  });
});

// ===========================================================================
// CSS / DOM 钩子存在性：防「UI 写了但钩子拼错」
// ===========================================================================

describe("放大弹窗的钩子与无障碍（静态检查）", () => {
  const src = readFileSync(new URL("../lib/client.js", import.meta.url), "utf8");

  test("★ 弹窗的每个 data-mh-* 钩子都有对应样式规则，且渲染里真的用到", () => {
    const hooks = [
      "data-mh-modal-overlay",
      "data-mh-modal",
      "data-mh-modal-head",
      "data-mh-modal-title",
      "data-mh-modal-sub",
      "data-mh-modal-meta",
      "data-mh-modal-tools",
      "data-mh-modal-body",
      "data-mh-modal-empty",
      "data-mh-modal-foot",
      "data-mh-modal-hint",
      "data-mh-pretty",
      "data-mh-zoom",
      "data-mh-section",
      "data-mh-section-head",
      "data-mh-section-k",
      "data-mh-section-meta",
      "data-mh-section-text",
      "data-mh-modal-close"
    ];
    for (const hook of hooks) {
      const inCss = src.includes('"[' + hook + ']') || src.includes("'[" + hook + "]");
      assert.equal(inCss, true, `CSS 缺少 ${hook} 的样式规则`);
      assert.equal(src.includes(hook + '":'), true, `渲染里未使用 ${hook}`);
    }
  });

  test("★ token 块必须同时覆盖 overlay（弹窗 portal 到 body，不在 [data-mh-root] 内）", () => {
    // 否则弹窗内所有 var(--mh-*) 失效 → 颜色/字号/圆角一起崩，且 DOM 文本断言看不见
    assert.ok(
      src.includes('"[" + "data-mh-root],[data-mh-modal-overlay]{') ||
        src.includes('data-mh-root],[data-mh-modal-overlay]{'),
      "token 选择器必须包含 [data-mh-modal-overlay]"
    );
  });

  test("★ 弹窗是无障碍 dialog：role + aria-modal + aria-labelledby 齐备", () => {
    assert.match(src, /role:\s*"dialog"/, "必须有 role=dialog");
    assert.match(src, /"aria-modal":\s*"true"/, "必须有 aria-modal=true");
    assert.match(src, /"aria-labelledby":\s*titleId/, "必须有 aria-labelledby");
  });

  test("★ Escape 必须在捕获阶段 stopPropagation（否则会同时触发「返回当前」）", () => {
    assert.match(
      src,
      /addEventListener\("keydown",\s*onKey,\s*true\)/,
      "Esc 监听必须在捕获阶段"
    );
    assert.match(src, /e\.stopPropagation\(\)/, "必须阻断冒泡，避免与面板既有 Esc 处理器叠加");
  });

  test("★ 弹窗必须锁背景滚动并在关闭时还原", () => {
    assert.match(src, /document\.body\.style\.overflow\s*=\s*"hidden"/);
    assert.match(src, /document\.body\.style\.overflow\s*=\s*prevOverflow/);
  });

  test("★ 关闭后焦点必须回到触发按钮", () => {
    assert.match(src, /const prevFocus\s*=/, "必须记录打开前的焦点");
    assert.match(src, /prevFocus\.focus\(\)/, "必须归还焦点");
  });

  test("★ 弹窗必须有 Tab 焦点循环（不能 Tab 出去到背景）", () => {
    assert.match(src, /e\.key\s*!==\s*"Tab"/);
    assert.match(src, /lastEl\.focus\(\)/, "末尾 Tab 应回到首个");
    assert.match(src, /firstEl\.focus\(\)/, "首个 Shift+Tab 应回到末尾");
  });

  test("★ react-dom 缺失时必须回退而不是白屏", () => {
    assert.match(src, /try\s*\{[\s\S]*?require\("react-dom"\)/, "require 必须包在 try 里");
    assert.match(src, /createPortal\s*=\s*null/, "失败时必须有 null 回退");
  });

  test("★ overlay 子树必须自带 box-sizing:border-box（portal 逃出了 root 的全局规则）", () => {
    // 实测缺陷：`width:80vw` 在 content-box 下渲染成 82.2vw（1403/1707），与「占屏 80%」不符。
    assert.match(
      src,
      /\[data-mh-modal-overlay\],\[data-mh-modal-overlay\] \*\{box-sizing:border-box;\}/,
      "overlay 子树必须重新声明 box-sizing"
    );
  });

  test("★ 放大按钮只在原始响应 / 请求详情出现（模型文本不出现）", () => {
    assert.match(src, /view === "model"\s*\n?\s*\?\s*null/, "模型文本档不得渲染放大按钮");
  });

  test("★ 不新增定时器（非目标：不做后台监控）", () => {
    const intervals = src.match(/setInterval\(/g) || [];
    assert.equal(intervals.length, 1, "只允许 testing 计时器这一个 setInterval");
  });

  test("★ 请求详情的容器不再整体套等宽 pre-wrap（分块各自排版）", () => {
    // 旧写法把 raw 与 req 合并成一条规则，会让分块头也被当代码排版
    assert.equal(
      /\[data-mh-tabpanel\]\[data-view='raw'\],\[data-mh-tabpanel\]\[data-view='req'\]/.test(src),
      false,
      "不得再出现把 raw 与 req 合并的样式规则"
    );
    assert.match(src, /\[data-mh-tabpanel\]\[data-view='req'\]\{/, "req 必须有独立规则");
  });

  test("★ 客户端的格式化逻辑不得发请求（纯本地）", () => {
    assert.equal(/buildRequest\s*\(/.test(src), false, "客户端不得自行构造请求");
    assert.equal(/chat\/completions/.test(src), false, "客户端不得出现协议路径字面量");
  });

  test("★ 内联块恒用 pretty=false（保住既有 48px 一屏预算），美化只加在弹窗里", () => {
    assert.match(
      src,
      /const vm = viewModel\(liveResult, view, templates\.systemPrompt, false\)/,
      "内联视图必须显式关闭美化"
    );
    assert.match(
      src,
      /const modalVm =\s*\n?\s*modal === null \? null : viewModel\(liveResult, modal\.view, templates\.systemPrompt, pretty\)/,
      "弹窗视图必须受美化开关控制"
    );
  });
});
