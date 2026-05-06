// v0.9 A2-T3：13 个 phase / 编排命令的 --dry-run 契约
//
// 验证每个命令含 --dry-run 分支：
//   - 调用 print-dry-run.mjs（grep 命令 markdown）
//   - 在 emit-phase --action start 之前判断
//   - 不实际跑 emit-phase / 不创建 staging
//
// 这是"命令文本契约"测试，不真正 spawn 命令（命令是 markdown，由 LLM 解释执行）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');
const COMMANDS = join(ROOT, 'commands');

// 必须含 --dry-run 分支的命令清单（v0.9 A2 范围）
// kickoff / verify / ship 是纯编排（无 emit-phase 自身），暂不强制 dry-run（v0.9.x 候选）
const PHASE_COMMANDS_WITH_DRY_RUN = [
  'prd', 'wbs', 'design',
  'design-brief', 'design-execute',
  'build-web', 'build-api',
  'test', 'review', 'fix', 'package', 'report',
  'impl',  // 编排但有 emit-phase --phase impl
];

for (const cmd of PHASE_COMMANDS_WITH_DRY_RUN) {
  test(`A2-T3: commands/${cmd}.md 必须含 --dry-run 分支`, () => {
    const text = readFileSync(join(COMMANDS, `${cmd}.md`), 'utf8');
    // 必须 grep --dry-run
    assert.match(text, /grep -q -- '--dry-run'/,
      `commands/${cmd}.md 必须有 \`grep -q -- '--dry-run'\` 检查段`);
    // 必须调用 print-dry-run.mjs
    assert.match(text, /print-dry-run\.mjs/,
      `commands/${cmd}.md 必须调用 print-dry-run.mjs`);
    // 必须传 --phase 参数
    assert.match(text, new RegExp(`print-dry-run\\.mjs.*--phase ${cmd}`),
      `commands/${cmd}.md 的 print-dry-run 调用必须含 --phase ${cmd}`);
  });
}

test(`A2-T3: dry-run 分支必须在 emit-phase --action start 之前`, () => {
  for (const cmd of PHASE_COMMANDS_WITH_DRY_RUN) {
    const text = readFileSync(join(COMMANDS, `${cmd}.md`), 'utf8');
    const dryRunIdx = text.indexOf('--dry-run');
    // emit-phase 调用实际形式：emit-phase.mjs" --phase X --action start
    const emitStartIdx = text.search(/emit-phase\.mjs"?\s+--phase\s+\S+\s+--action\s+start/);
    assert.ok(dryRunIdx >= 0 && emitStartIdx >= 0,
      `${cmd}.md 缺 --dry-run（${dryRunIdx}）或 emit-phase start（${emitStartIdx}）`);
    assert.ok(dryRunIdx < emitStartIdx,
      `${cmd}.md 中 --dry-run 检查必须在 emit-phase --action start 之前（避免 dry-run 仍发事件）`);
  }
});

test(`A2-T3: dry-run 分支必须含 exit 0（避免继续走完命令）`, () => {
  for (const cmd of PHASE_COMMANDS_WITH_DRY_RUN) {
    const text = readFileSync(join(COMMANDS, `${cmd}.md`), 'utf8');
    // 抓 dry-run if 段：grep 行后到 fi 之间必须含 exit 0
    const m = text.match(/grep -q -- '--dry-run'[\s\S]*?\bfi\b/);
    assert.ok(m, `${cmd}.md dry-run if 段抓不到`);
    assert.match(m[0], /exit 0/, `${cmd}.md dry-run 段必须含 exit 0（防止继续跑）`);
  }
});

test(`A2-T3: dry-run helper print-dry-run.mjs 输出 4 段固定结构`, async () => {
  const { renderDryRun } = await import('../../bin/print-dry-run.mjs');
  for (const cmd of PHASE_COMMANDS_WITH_DRY_RUN) {
    const out = renderDryRun({
      phase: cmd,
      inputs: ['test-input.md'],
      outputs: ['test-output.md'],
      next: '/next-cmd',
    });
    assert.match(out, /📥 读取：/, `${cmd} dry-run 必须含"读取"段`);
    assert.match(out, /📤 写入：/, `${cmd} dry-run 必须含"写入"段`);
    assert.match(out, /📊 emit phase 事件：/, `${cmd} dry-run 必须含"emit phase"段`);
    assert.match(out, /👉 下一步建议：/, `${cmd} dry-run 必须含"下一步"段`);
  }
});
