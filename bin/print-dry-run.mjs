#!/usr/bin/env node
// v0.9 A2：--dry-run 共用 helper
//
// 让每个 phase 命令都能预览"读什么 / 写什么 / 发什么 emit / 下一步是什么"，
// 而不实际跑命令。让用户的试错成本归零。
//
// 用法（在 commands/<phase>.md::Phase 1 顶部调用）：
//   if printf '%s' "$ARGUMENTS" | grep -q -- '--dry-run'; then
//     node "$DDT_PLUGIN_ROOT/bin/print-dry-run.mjs" \
//       --phase prd \
//       --inputs "project-brief.md,docs/prd.md(if exists)" \
//       --outputs "docs/prd.md" \
//       --next "/wbs"
//     exit 0
//   fi
//
// 设计原则：
//   - 不读不写实际文件（即使 inputs 列表里某文件不存在也不报错）
//   - 不发 emit-phase / emit-decision 事件
//   - 不创建临时目录
//   - 4 段固定结构：📥 读取 / 📤 写入 / 📊 emit / 👉 下一步
//   - 输出格式稳定（让契约测试能 grep 验证）

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) { args[key] = next; i++; }
      else args[key] = true;
    } else args._.push(a);
  }
  return args;
}

function splitList(value) {
  if (!value) return [];
  return String(value).split(',').map(s => s.trim()).filter(Boolean);
}

export function renderDryRun({ phase, inputs = [], outputs = [], next = null, notes = [] }) {
  const lines = [];
  lines.push(`## /${phase} --dry-run 预览（不会实际执行）`);
  lines.push('');
  lines.push('📥 读取：');
  if (inputs.length === 0) lines.push('   （无）');
  else for (const f of inputs) lines.push(`   - ${f}`);
  lines.push('');
  lines.push('📤 写入：');
  if (outputs.length === 0) lines.push('   （无）');
  else for (const f of outputs) lines.push(`   - ${f}`);
  lines.push('');
  lines.push('📊 emit phase 事件：');
  lines.push(`   - phase_start (phase=${phase})`);
  lines.push(`   - phase_end   (phase=${phase})`);
  lines.push(`   - decision_point + decision_resolved（除非 --auto）`);
  lines.push('');
  lines.push('👉 下一步建议：');
  if (next) lines.push(`   ${next}`);
  else lines.push('   （由 phase 完成时根据上下文动态决定）');
  if (notes.length > 0) {
    lines.push('');
    lines.push('📝 备注：');
    for (const n of notes) lines.push(`   - ${n}`);
  }
  return lines.join('\n');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.phase) {
    console.error('❌ 缺 --phase 参数。用法：bin/print-dry-run.mjs --phase <name> [--inputs a,b] [--outputs c,d] [--next /xxx] [--notes ...]');
    process.exit(1);
  }
  const out = renderDryRun({
    phase: String(args.phase),
    inputs: splitList(args.inputs),
    outputs: splitList(args.outputs),
    next: args.next ? String(args.next) : null,
    notes: splitList(args.notes),
  });
  console.log(out);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
