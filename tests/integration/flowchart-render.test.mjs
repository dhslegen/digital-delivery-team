// v0.9 A1-T3：render-flowchart.mjs 集成测试
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

import {
  renderFlowchart,
  extractDescription,
  extractNextSteps,
} from '../../bin/render-flowchart.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');
const SCRIPT = join(ROOT, 'bin', 'render-flowchart.mjs');
const COMMANDS_DIR = join(ROOT, 'commands');

test('A1: extractDescription 抽 frontmatter description 字段', () => {
  const text = `---
description: 产品经理命令 · 生成或刷新 PRD
argument-hint: ""
---

# /prd
`;
  assert.equal(extractDescription(text), '产品经理命令 · 生成或刷新 PRD');
});

test('A1: extractNextSteps 抽简单"建议下一步：/xxx"格式', () => {
  const text = '> ✅ 建议下一步：`/wbs`';
  const steps = extractNextSteps(text);
  assert.deepEqual(steps.map(s => s.to), ['/wbs']);
});

test('A1: extractNextSteps 抽分支表（spa / server-side）', () => {
  const text = `frontend.type 分支：
| spa | \`/design-brief\` |
| server-side | \`/impl\` |
\`spa\` → \`/design-brief\` ；\`server-side\` → \`/impl\`；
`;
  const steps = extractNextSteps(text);
  const conds = steps.filter(s => s.condition).map(s => `${s.condition}|${s.to}`);
  assert.ok(conds.includes('spa|/design-brief'), `spa 分支: ${conds.join(',')}`);
  assert.ok(conds.includes('server-side|/impl'), `server-side 分支: ${conds.join(',')}`);
});

test('A1: extractNextSteps 抽 print-dry-run.mjs --next 参数', () => {
  const text = `node "$DDT_PLUGIN_ROOT/bin/print-dry-run.mjs" --phase build-web --inputs "..." --outputs "web/" --next "/verify"`;
  const steps = extractNextSteps(text);
  assert.ok(steps.some(s => s.to === '/verify'), '应从 dry-run --next 抽 /verify');
});

test('A1: renderFlowchart 输出 mermaid 流程图（含主链路）', () => {
  const out = renderFlowchart(COMMANDS_DIR);
  assert.match(out, /^```mermaid/m);
  assert.match(out, /flowchart LR/);
  // 主链路必含的边
  for (const expected of [
    'prd --> wbs',
    'wbs --> design',
    'design-brief --> design-execute',
    'design-execute --> build-web',
    'build-web --> verify',
    'build-api --> verify',
    'verify --> ship',
  ]) {
    assert.ok(out.includes(expected), `flowchart 必须含边: ${expected}`);
  }
  // design 三态分支
  assert.match(out, /design -- spa --> design-brief/);
});

test('A1: spawn render-flowchart.mjs --output 写文件', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'ddt-flow-'));
  try {
    const out = join(tmp, 'flowchart.md');
    const r = spawnSync(process.execPath, [SCRIPT, '--output', out], { encoding: 'utf8' });
    assert.equal(r.status, 0);
    const content = readFileSync(out, 'utf8');
    assert.match(content, /# DDT 命令依赖图/);
    assert.match(content, /flowchart LR/);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('A1: 主仓库 docs/architecture/flowchart.md 应已生成且与 commands 一致', () => {
  const path = join(ROOT, 'docs', 'architecture', 'flowchart.md');
  const content = readFileSync(path, 'utf8');
  // 当前 commands 状态再渲染一次
  const fresh = '# DDT 命令依赖图\n\n' +
    '> v0.9 A1：从 `commands/*.md` 自动派生（frontmatter description + 建议下一步段落）。\n' +
    '> 重新生成：`node bin/render-flowchart.mjs --output <path>`\n\n' +
    renderFlowchart(COMMANDS_DIR) + '\n\n## 节点形状说明\n\n' +
    '- `phase` 类（蓝色矩形）：单一职责的开发阶段命令\n' +
    '- `orch` 类（橙色虚线圆角）：编排命令，串/并行调下游 phase 命令\n' +
    '- `utility` 类（doctor / preview / relay / resume）不在本图（无 phase 关系）\n';
  // 内容必须一致——否则 commands 改了但 flowchart 没重新生成
  assert.equal(content, fresh,
    '主仓库 docs/architecture/flowchart.md 与 commands/ 不一致，请跑 `node bin/render-flowchart.mjs --output docs/architecture/flowchart.md` 重新生成');
});

test('A1: 自定义 commands-dir 参数生效', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'ddt-flow-custom-'));
  try {
    const cmdDir = join(tmp, 'cmds');
    mkdirSync(cmdDir);
    writeFileSync(join(cmdDir, 'foo.md'), '---\ndescription: 测试\n---\n\n建议下一步：/bar\n');
    writeFileSync(join(cmdDir, 'bar.md'), '---\ndescription: bar 测试\n---\n');
    const r = spawnSync(process.execPath, [SCRIPT, '--commands-dir', cmdDir], { encoding: 'utf8' });
    assert.equal(r.status, 0);
    assert.match(r.stdout, /foo --> bar/);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});
