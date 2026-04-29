// M2-9: 防止 commands 退化回 80 行 inline node-e
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');
const COMMANDS = join(ROOT, 'commands');

test('commands 不含 inline node -e plugin-root 解析（M2-3 回归）', () => {
  const files = readdirSync(COMMANDS).filter(f => f.endsWith('.md'));
  const offenders = [];
  for (const file of files) {
    const text = readFileSync(join(COMMANDS, file), 'utf8');
    if (text.includes('node -e') && text.includes('plugins')) {
      offenders.push(file);
    }
  }
  assert.deepEqual(offenders, [],
    `以下命令仍含 inline plugin-root 解析（应改用 .ddt-plugin-root marker）：${offenders.join(', ')}`);
});

test('commands 全部使用 .ddt-plugin-root marker fallback', () => {
  const expectedSnippet = '.claude/delivery-metrics/.ddt-plugin-root';
  // 仅检查需要 plugin root 的 commands（含 DDT_PLUGIN_ROOT 引用的）
  const files = readdirSync(COMMANDS).filter(f => f.endsWith('.md'));
  for (const file of files) {
    const text = readFileSync(join(COMMANDS, file), 'utf8');
    if (!text.includes('DDT_PLUGIN_ROOT')) continue;
    assert.ok(text.includes(expectedSnippet),
      `commands/${file} 引用了 DDT_PLUGIN_ROOT 但未使用 marker fallback`);
  }
});

test('commands 平均行数 ≤ 140（M6.2 决策门后基线）', () => {
  // M2-3 瘦身后基线 ~80（无决策门）
  // M6.2 给 10 个 phase 加决策门段落 ~50 行/个，平均 ≈ 117
  // 设 140 留余量给后续 M6.4 改造
  const files = readdirSync(COMMANDS).filter(f => f.endsWith('.md'));
  const totalLines = files.reduce((sum, f) =>
    sum + readFileSync(join(COMMANDS, f), 'utf8').split('\n').length, 0);
  const avg = totalLines / files.length;
  assert.ok(avg <= 140,
    `commands 平均行数 ${avg.toFixed(1)} 超过基线 140 行（M6.2 后允许 ≤ 140，再涨说明可能膨胀）`);
});

test('M2 新增的 fix.md 与 doctor.md 已就位', () => {
  for (const cmd of ['fix.md', 'doctor.md']) {
    const text = readFileSync(join(COMMANDS, cmd), 'utf8');
    assert.ok(text.includes('description:'), `${cmd} 缺 frontmatter description`);
    assert.ok(text.includes('## '), `${cmd} 缺正文标题段`);
  }
});

test('fix-agent.md 符合 invariants 6 条', () => {
  const fixAgent = readFileSync(join(ROOT, 'agents/fix-agent.md'), 'utf8');
  for (const phrase of [
    '禁止猜测', '禁止自我汇报度量', '输出前自检',
    '禁用糊弄词', '可重入', '单一产物'
  ]) {
    assert.ok(fixAgent.includes(phrase), `fix-agent 缺少 invariants: ${phrase}`);
  }
});

test('metrics-agent 含 M2-7 工时不可证明刚性约束', () => {
  const text = readFileSync(join(ROOT, 'agents/metrics-agent.md'), 'utf8');
  assert.ok(text.includes('工时不可证明'),
    'metrics-agent 必须包含 M2-7 工时不可证明约束（防止用 WBS 预估替代实际工时）');
  assert.ok(text.includes('严格禁止'),
    'metrics-agent 必须明确"严格禁止"用 WBS 预估替代');
});
