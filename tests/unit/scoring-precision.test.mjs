// W7.5 Block F：评分准确度测试
//
// R12.1: scoreComponentReuse 排除 markdown 表头分隔行 / placeholder 行
// R12.2: scorePolish 覆盖 11 条 anti-patterns（之前只 5 条）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../..');

const { parseInventoryComponents, scorePolish, scoreComponentReuse } =
  await import(join(repoRoot, 'bin/score-design-output.mjs'));

// ─── R12.1 parseInventoryComponents ──────────────────────────

test('R12.1: parseInventoryComponents 跳过表头与分隔行', () => {
  const text = `# Inventory

## 1. shadcn/ui 已安装组件

| 组件 | 路径 | 8 状态完备度 | 注释 |
|------|------|-------------|------|
| Button | \`web/components/ui/button.tsx\` | ✅ all | comment |
| Input | \`web/components/ui/input.tsx\` | ⚠️ | comment |
`;
  const components = parseInventoryComponents(text);
  assert.ok(components.has('Button'));
  assert.ok(components.has('Input'));
  // 不应误把 header / separator 行的内容算进来
  assert.equal(components.has(''), false);
  // "组件" 是中文 header，不是 PascalCase 标识符
  assert.equal(components.size, 2,
    `应只识别 2 个组件，实际：${[...components].join(', ')}`);
});

test('R12.1: parseInventoryComponents 跳过 placeholder _(未扫描...)_ 行', () => {
  const text = `## 2. 项目自有组件

| 组件 | 路径 | 用途 | 复用建议 |
|------|------|------|---------|
| _(未扫描到 custom 组件)_ | | | |
`;
  const components = parseInventoryComponents(text);
  assert.equal(components.size, 0,
    `placeholder 行不应产生 registered 组件，实际：${[...components].join(', ')}`);
});

test('R12.1: parseInventoryComponents 处理 <DataTable> 尖括号 + 反引号包裹', () => {
  const text = `| 组件 | 路径 |
|------|------|
| \`<DataTable>\` | \`web/components/data-table.tsx\` |
| \`<EmptyState>\` | \`web/components/empty-state.tsx\` |
`;
  const components = parseInventoryComponents(text);
  assert.ok(components.has('DataTable'));
  assert.ok(components.has('EmptyState'));
});

test('R12.1: parseInventoryComponents 处理多个表格段落', () => {
  const text = `## 1. shadcn

| 组件 | 路径 |
|------|------|
| Button | path |

## 2. custom

| 组件 | 路径 |
|------|------|
| Modal | path |
`;
  const components = parseInventoryComponents(text);
  assert.ok(components.has('Button'));
  assert.ok(components.has('Modal'));
  assert.equal(components.size, 2);
});

test('R12.1: scoreComponentReuse 集成测试 — registered 字段返回真实组件名', () => {
  const inventory = `| 组件 | 路径 |
|------|------|
| Button | path |
`;
  const result = scoreComponentReuse(inventory, []);
  assert.deepEqual(result.registered, ['Button']);
});

// ─── R12.2 scorePolish 11 条 anti-patterns ──────────────────────────

test('R12.2: scorePolish 检测 11 条 anti-patterns 的全部 ID', () => {
  // 跑一个故意 trip 全部 11 条的样本
  const eviltsx = `
import React from 'react';
export function Hero() {
  return (
    <section className="min-h-screen flex items-center justify-center bg-gradient-to-br from-purple-500 to-blue-500">
      <div className="backdrop-blur-md backdrop-blur-lg backdrop-blur-sm backdrop-blur-xl backdrop-blur-2xl backdrop-blur-3xl"></div>
      <div className="rounded-12 rounded-25 rounded-30"></div>
      <h1 className="font-sans font-mono">${'<x className="font-sans"></x>\\n'.repeat(60)}</h1>
      <p>Trusted by 1000 teams</p>
      <div className="bg-teal-500 text-sky-500 border-emerald-500 bg-amber-500 bg-teal-400 text-sky-600 bg-emerald-400 text-amber-600 bg-teal-600">x</div>
      <div className="rounded-md border p-4 rounded-lg border p-6 rounded-xl border p-8"></div>
      <div className="bg-[#a1b2c3] text-[#abc] border-[#deadbe]"></div>
      ${'<button className="transition-all"></button>\\n'.repeat(15)}
      <div style={{ scrollSnapType: 'y mandatory' }}>x</div>
      <div onClick={() => element.scrollIntoView({ behavior: 'smooth' })}></div>
      <div onClick={() => x.scrollIntoView({ behavior: 'smooth' })}></div>
      <div onClick={() => y.scrollIntoView({ behavior: 'smooth' })}></div>
    </section>
  );
}
`;
  const result = scorePolish([{ path: 'evil.tsx', content: eviltsx }]);
  // 至少应命中 7+ 条；不要求 11 条全中（启发式有边界）
  assert.ok(result.tripped.length >= 7,
    `应至少命中 7 条 anti-pattern，实际：${result.tripped.length}（${result.tripped.join(', ')}）`);
  // score 应被扣到 ≤ 3
  assert.ok(result.score <= 3,
    `严重违例时 score 应 ≤ 3，实际：${result.score}`);
});

test('R12.2: scorePolish 干净代码不误报', () => {
  const cleantsx = `
import React from 'react';
import { Button } from '@/components/ui/button';
export function Home() {
  return (
    <main className="p-4 md:p-8 lg:p-12">
      <Button variant="primary">Click</Button>
    </main>
  );
}
`;
  const result = scorePolish([{ path: 'home.tsx', content: cleantsx }]);
  assert.equal(result.score, 10,
    `干净代码应满分，实际：${result.score}（tripped: ${result.tripped.join(', ')}）`);
});

test('R12.2: scorePolish 检测 generic-emotional-color（saas 默认色调）', () => {
  // 故意用 8 处以上 teal/sky/emerald
  const tsx = Array.from({ length: 9 }, (_, i) =>
    `<div className="bg-teal-500 text-sky-500 border-emerald-500 bg-amber-${i % 2 ? 400 : 600}"></div>`
  ).join('\n');
  const result = scorePolish([{ path: 'x.tsx', content: tsx }]);
  assert.ok(result.tripped.includes('generic-emotional-color'),
    `应检出 generic-emotional-color；实际 tripped：${result.tripped.join(', ')}`);
});

test('R12.2: scorePolish 检测 random-accent-without-system（[#hex] arbitrary value）', () => {
  const tsx = `
<div className="bg-[#a1b2c3]"></div>
<div className="text-[#deadbe]"></div>
<div className="border-[#fafafa]"></div>
<div className="bg-[#000000]"></div>
`;
  const result = scorePolish([{ path: 'x.tsx', content: tsx }]);
  assert.ok(result.tripped.includes('random-accent-without-system'),
    `应检出 random-accent-without-system；实际 tripped：${result.tripped.join(', ')}`);
});

test('R12.2: scorePolish 检测 motion-without-purpose（transition-all 滥用）', () => {
  const tsx = Array.from({ length: 12 }, () =>
    `<button className="transition-all">x</button>`
  ).join('\n');
  const result = scorePolish([{ path: 'x.tsx', content: tsx }]);
  assert.ok(result.tripped.includes('motion-without-purpose'),
    `应检出 motion-without-purpose；实际 tripped：${result.tripped.join(', ')}`);
});

test('R12.2: scorePolish 检测 interchangeable-saas-hero', () => {
  const tsx = `<h2>Trusted by 500 teams worldwide</h2>`;
  const result = scorePolish([{ path: 'hero.tsx', content: tsx }]);
  assert.ok(result.tripped.includes('interchangeable-saas-hero'),
    `应检出 interchangeable-saas-hero；实际 tripped：${result.tripped.join(', ')}`);
});
