#!/usr/bin/env node
// v0.8.1 D12: agent 产出校验 + blocker 上报
//
// 背景：v0.8.0 commands/prd.md / wbs.md / design.md 在 Task 工具派发 agent 后
//   不验证 agent 是否成功落盘产物。实战 ddt-team-admin-v0.8 中 product-agent
//   遭遇网络错误，main thread 静默 fallback 自写——丢失 agent 携带的专门 prompt
//   与历史校准约束（违反 DDT agent 边界）。
//
// 修复：派发后调用本脚本验证产物。
//   - 文件不存在 → exit 1（提示重试或 blocker）
//   - 文件存在但行数 < min-lines（默认 50） → exit 2（"agent 异常截断"）
//   - 文件已含字面占位（<persona>/<待填>） → exit 3（"agent 未实际填充"）
//   - 全部检查通过 → exit 0
//
// 用法：
//   node bin/check-agent-output.mjs --file docs/prd.md [--min-lines 50] [--name product-agent]
//   node bin/check-agent-output.mjs --file docs/wbs.md --min-lines 30 --name pm-agent
//
// 配套（在 commands/*.md 内调用）：
//   if ! node "$DDT_PLUGIN_ROOT/bin/check-agent-output.mjs" --file docs/prd.md --name product-agent; then
//     # 写 blocker，让用户决策（不静默 fallback）
//     {
//       echo "- [BLOCK-AGENT-PRD] product-agent 产出异常，需人工选择："
//       echo "    (a) 重试 /prd"
//       echo "    (b) main thread fallback 手动撰写"
//       echo "    (c) 暂停"
//     } >> docs/blockers.md
//     exit 1
//   fi
//
// 退出码：0 通过；1 文件缺失；2 行数不足；3 含字面占位；4 参数错误

import { existsSync, readFileSync, statSync } from 'node:fs';

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) { args[key] = next; i++; }
      else { args[key] = true; }
    } else { args._.push(a); }
  }
  return args;
}

const PLACEHOLDER_PATTERNS = [
  /<persona>/i,
  /<pain[ -]?point>/i,
  /<待填>/i,
  /<未填(写)?>/i,
  /\{\{[A-Z_]+\}\}/,        // 模板未替换的 {{TOKEN}}
  /^TODO[： :]/m,            // TODO 标记
];

export function checkAgentOutput(filePath, opts = {}) {
  const minLines = opts.minLines ?? 50;
  const name = opts.name || 'agent';

  if (!existsSync(filePath)) {
    return { ok: false, code: 1, reason: `${name} 产出 ${filePath} 不存在（agent 可能 crash 或未派发）` };
  }
  const stat = statSync(filePath);
  if (stat.size === 0) {
    return { ok: false, code: 1, reason: `${name} 产出 ${filePath} 为空文件（agent 异常退出）` };
  }
  const text = readFileSync(filePath, 'utf8');
  const lineCount = text.split('\n').length;
  if (lineCount < minLines) {
    return {
      ok: false, code: 2,
      reason: `${name} 产出 ${filePath} 仅 ${lineCount} 行（< 期望 ${minLines}），agent 可能截断或网络错误`
    };
  }
  for (const pat of PLACEHOLDER_PATTERNS) {
    const m = text.match(pat);
    if (m) {
      return {
        ok: false, code: 3,
        reason: `${name} 产出 ${filePath} 含字面占位 "${m[0]}"，agent 未实际填充内容`
      };
    }
  }
  return { ok: true, code: 0, lineCount };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.file) {
    console.error('❌ 缺 --file 参数。用法：bin/check-agent-output.mjs --file <path> [--min-lines 50] [--name <agent-name>]');
    process.exit(4);
  }
  const result = checkAgentOutput(args.file, {
    minLines: args['min-lines'] ? Number(args['min-lines']) : 50,
    name: args.name,
  });
  if (result.ok) {
    console.log(`✅ ${args.name || 'agent'} 产出校验通过：${args.file}（${result.lineCount} 行）`);
    process.exit(0);
  }
  console.error(`❌ ${result.reason}`);
  process.exit(result.code);
}

// 仅在直接执行时跑 main（被 import 时不触发，便于测试）
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
