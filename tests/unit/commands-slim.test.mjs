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

test('commands 平均行数 ≤ 150（v0.9 流程可见性后基线）', () => {
  // M2-3 瘦身后基线 ~80（无决策门）
  // M6.2 给 10 个 phase 加决策门段落 ~50 行/个，平均 ≈ 117
  // v0.8.1 hotfix：D1 / D7 / D12 给 design.md / build-web.md / prd.md 加分支
  // v0.9 A2：13 个命令加 --dry-run 段（4 行/命令），D16/D17 加 progress 实时
  //   同步段，整体涨到 ~146；基线提到 150 留余量给 v0.10。
  const files = readdirSync(COMMANDS).filter(f => f.endsWith('.md'));
  const totalLines = files.reduce((sum, f) =>
    sum + readFileSync(join(COMMANDS, f), 'utf8').split('\n').length, 0);
  const avg = totalLines / files.length;
  assert.ok(avg <= 150,
    `commands 平均行数 ${avg.toFixed(1)} 超过基线 150 行（v0.9 后允许 ≤ 150，再涨说明可能膨胀）`);
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

// v0.8.1 D1 + D10：/design 完成后必须按 frontend.type 分支建议下一步，
// 让 design-brief / design-execute 在 spa 项目中是流程一等公民。
test('v0.8.1 D1: /design Phase 5 必须按 frontend.type 分支给出下一步建议', () => {
  const text = readFileSync(join(COMMANDS, 'design.md'), 'utf8');
  assert.ok(text.includes('FRONT_TYPE') || text.includes('frontend.type'),
    'design.md::Phase 5 必须读取 frontend.type 分支建议');
  assert.ok(text.includes('/design-brief'),
    'design.md::Phase 5 必须在 spa 分支建议 /design-brief（D1 修复）');
  assert.ok(text.includes('get-frontend-type.mjs'),
    'design.md 必须用 get-frontend-type.mjs 读取 frontend.type（D10：来源透明）');
  // D10：frontend.type 来源（.ddt/tech-stack.json）必须显式标注
  assert.ok(text.match(/frontend\.type[^\n]*\n[^\n]*tech-stack\.json/i)
         || (text.includes('frontend.type:') && text.includes('.ddt/tech-stack.json')),
    'design.md::Phase 5 输出必须显式标注 frontend.type 来源 .ddt/tech-stack.json（D10）');
});

// v0.8.1 D1：/design 不应再硬编码"建议下一步：/impl"作为唯一选项
test('v0.8.1 D1: /design 不应硬编码"/impl"为唯一下一步（v0.8.0 BUG 回归保护）', () => {
  const text = readFileSync(join(COMMANDS, 'design.md'), 'utf8');
  // 旧 v0.8.0 文案"建议下一步：/impl 或 /build-web / /build-web / /build-api"是 D1 BUG，跳过 design-brief
  // 新文案应是分支表，含 spa → /design-brief
  const hasOldHardcode = /^建议下一步[：:]\s*\/impl\s*或\s*\/build-web/m.test(text);
  assert.ok(!hasOldHardcode,
    'design.md 不应再含硬编码"建议下一步：/impl 或 /build-web / /build-api"（v0.8.0 D1 BUG）');
});

// v0.8.1 D7：/build-web 在 frontend.type=spa 时必须前置校验 docs/design-brief.md，
// 避免跳过 design-brief 直接 build-web 留下 brief 缺失的隐患。
test('v0.8.1 D7: /build-web Phase 1 必须在 spa 类型强校验 docs/design-brief.md', () => {
  const text = readFileSync(join(COMMANDS, 'build-web.md'), 'utf8');
  // 必须含 design-brief 前置校验
  assert.ok(text.includes('docs/design-brief.md'),
    'build-web.md::Phase 1 必须前置校验 docs/design-brief.md（D7）');
  // 必须仅在 spa 时强校验（避免 server-side / none 类型误拦截）
  assert.match(text, /FRONT_TYPE.*spa[\s\S]*?design-brief\.md/,
    'build-web.md 必须仅在 FRONT_TYPE=spa 时校验 design-brief（避免 server-side 类型误拦截）');
  // 必须支持 --skip-brief 逃生口
  assert.ok(text.includes('--skip-brief'),
    'build-web.md 必须支持 --skip-brief 逃生口（D7：尊重用户显式声明）');
});
