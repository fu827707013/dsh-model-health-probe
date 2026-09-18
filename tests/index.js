/**
 * 目录入口（兼容 Node 24 的 `--test` 目录参数行为）。
 *
 * 为什么需要这个文件：
 * 任务书/SPEC 的验收命令曾写作 `node --test tests/`，但 Node 24 **不再把 `--test`
 * 后的位置参数当作目录递归根**，而是当作「测试文件路径」解析；传目录会走 CJS loader
 * 并报 `Error: Cannot find module '...\tests'`，计为一次失败测试（实测 Node v24.18.0 / Windows）。
 *
 * 该目录下存在 index.js 时，Node 会把它作为该目录的入口解析，于是 `node --test tests/`
 * 能正常工作。
 *
 * ★ 关键：**必须动态导入本目录下所有 *.test.mjs**，不能只 import 一个文件。
 *   若只 import probe.test.mjs，则本目录后来新增的测试文件会被 `node --test tests/`
 *   静默跳过，产生「假绿」（用例数偏少但退出码 0）——这正是最危险的失败模式。
 *   实测：只 import 单文件时，`node --test tests/` 只跑 1 个用例，而同目录的
 *   extra.test.mjs 被完全忽略。
 *
 * 本文件不新增任何用例、不做任何断言，只是把真正的套件全部引入执行。
 *
 * 推荐写法（不依赖本文件，且无上述发现规则问题）：
 *   npm test                        # scripts.test = "node --test"
 *   node --test                     # 无参数，递归发现仍正常
 *   node --test "tests/**\/*.test.mjs"
 *   node tests/probe.test.mjs
 */
import { readdirSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

const testFiles = readdirSync(here)
  .filter((name) => /\.test\.(mjs|cjs|js)$/.test(name))
  .sort();

if (testFiles.length === 0) {
  /*
   * 仓库里**故意**不含测试套件：主要用例（probe / default-model / host-endpoints /
   * client-retry-default）内嵌了本机真实供应商配置（真实域名、路由名、密钥环境变量名），
   * 属本地开发资产，由 .gitignore 排除、仅本地保留。
   *
   * 因此「0 个测试文件」在**别人 clone 下来**时是正常状态，不能抛错（否则 npm test
   * 直接崩，看起来像仓库坏了）。但也绝不能静默返回退出码 0 —— 那会被读成
   * 「测试全过」，是更危险的假绿。
   *
   * 折中：打印明确的跳过说明 + 用退出码 0 结束（因为「无测试可跑」本身不是失败）。
   */
  console.log(
    "[model-health] 未发现测试套件 —— 本仓库不含 tests/*.test.mjs。\n" +
      "  原因：主要用例内嵌本机真实供应商配置，属本地开发资产，未随仓库发布。\n" +
      "  本机开发时这些文件应当存在；若你刚 clone 下来，这是预期状态。"
  );
} else {
  for (const name of testFiles) {
    await import(pathToFileURL(join(here, name)).href);
  }
}
