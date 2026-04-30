// W1: design-brief 模板与 schema 校验
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { VISUAL_DIRECTIONS, ANTI_PATTERNS } from '../../bin/compile-design-brief.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');

const TEMPLATE_BRIEF     = join(ROOT, 'templates', 'design-brief.template.md');
const TEMPLATE_TOKENS    = join(ROOT, 'templates', 'design-tokens.template.json');
const TEMPLATE_INVENTORY = join(ROOT, 'templates', 'components-inventory.template.md');

test('design-brief 模板含 10 字段必备段落', () => {
  const text = readFileSync(TEMPLATE_BRIEF, 'utf8');
  const required = [
    '## 1. Problem Alignment',
    '## 2. User Stories',
    '## 3. Information Architecture',
    '## 4. Screen Inventory',
    '## 5. Component States',
    '## 6. Data & API Contract',
    '## 7. Validation & Error',
    '## 8. Visual Direction & Design Tokens',
    '## 9. References',
    '## 10. Constraints',
  ];
  for (const heading of required) {
    assert.ok(text.includes(heading), `模板必含段落 "${heading}"`);
  }
});

test('design-brief 模板 §8.1 含 9 种 visual_direction 选项', () => {
  const text = readFileSync(TEMPLATE_BRIEF, 'utf8');
  assert.equal(VISUAL_DIRECTIONS.length, 9, 'VISUAL_DIRECTIONS 必须正好 9 项');
  for (const dir of VISUAL_DIRECTIONS) {
    assert.ok(text.includes(`\`${dir}\``),
      `模板必含 visual direction "${dir}"`);
  }
});

test('design-brief 模板 §8.3 含 11 条 anti-patterns 矩阵', () => {
  const text = readFileSync(TEMPLATE_BRIEF, 'utf8');
  assert.equal(ANTI_PATTERNS.length, 11, 'ANTI_PATTERNS 必须正好 11 条');

  // 模板表格的第 1 列编号 1..11 都必须出现（| 1 | / | 11 |）
  for (let i = 1; i <= 11; i++) {
    assert.match(text, new RegExp(`\\|\\s*${i}\\s*\\|`),
      `anti-patterns 表必含编号 ${i}`);
  }

  // 关键 anti-pattern 关键词必须在模板中出现
  const phrases = [
    '紫蓝默认渐变',
    'glass morphism',
    '居中 hero',
    '通用 sans-serif',
    'interchangeable SaaS hero',
    'random accent without system',
  ];
  for (const p of phrases) {
    assert.ok(text.includes(p), `anti-patterns 必含关键描述 "${p}"`);
  }
});

test('design-tokens 模板是合法 JSON 且含必备段落', () => {
  const text = readFileSync(TEMPLATE_TOKENS, 'utf8');
  const tokens = JSON.parse(text);
  for (const key of ['color', 'spacing', 'radius', 'typography', 'shadow', 'motion', 'breakpoint']) {
    assert.ok(tokens[key], `tokens 必含 ${key} 段`);
  }
  // color 段含品牌色 + 中性色阶 + 语义色
  assert.ok(tokens.color.primary, 'color.primary 必填');
  assert.ok(tokens.color['neutral-900'], '中性色阶必含 neutral-900');
  assert.ok(tokens.color.danger, '语义色必含 danger');
  // typography scale 至少 4 档
  assert.ok(tokens.typography.scale.length >= 4, 'typography.scale 至少 4 档');
  // spacing 至少 6 档
  assert.ok(tokens.spacing.length >= 6, 'spacing 至少 6 档');
});

test('components-inventory 模板含 5 个区段（含红线）', () => {
  const text = readFileSync(TEMPLATE_INVENTORY, 'utf8');
  const required = [
    '## 1. shadcn/ui',
    '## 2. 项目自有组件',
    '## 3. 内部 monorepo',
    '## 4. 第三方依赖',
    '## 5. 红线',
  ];
  for (const h of required) {
    assert.ok(text.includes(h), `inventory 模板必含 "${h}"`);
  }
  // 红线段必含强栈约束（禁用 antd / mui / chakra）
  assert.match(text, /antd|mui|chakra-ui/i, '红线段必须列出禁用 UI 库');
});
