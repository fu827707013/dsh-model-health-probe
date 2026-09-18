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
  // 目录里一个测试文件都没有：明确报错，绝不静默「0 用例 + 退出码 0」假绿。
  throw new Error(`tests/ 目录下未找到任何 *.test.mjs 文件（${here}）`);
}

for (const name of testFiles) {
  await import(pathToFileURL(join(here, name)).href);
}
