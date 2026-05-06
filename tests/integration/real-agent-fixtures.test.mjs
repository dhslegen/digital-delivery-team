// v0.9 B1：解析器对真实 agent 产出的参数化测试
//
// 背景：v0.8.0 D5 / v0.8.1 D5 / v0.8.2 D15 三轮 EARS 解析回归都是因为合成测试
// 与真实 agent 输出脱节。本测试套件直接对 tests/fixtures/real-agent-outputs/
// 下的所有真实 fixture 跑解析器，确保任何修改都不让真实数据回归。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  extractUserStories,
  extractEndpoints,
} from '../../bin/compile-design-brief.mjs';
import { parseBriefMeta, parseVisualDirection } from '../../bin/derive-channel-package.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(__dirname, '../fixtures/real-agent-outputs');

function listFixtures(subdir, ext = '.md') {
  const dir = join(FIXTURES, subdir);
  try {
    return readdirSync(dir)
      .filter(f => f.endsWith(ext))
      .map(f => ({ name: f, path: join(dir, f) }));
  } catch { return []; }
}

// ─────────────────────────────────────────────────────────────────
// PRD fixtures：每个真实 PRD 必须能抽出 user stories
// ─────────────────────────────────────────────────────────────────

const prdFixtures = listFixtures('prd');

test('B1: tests/fixtures/real-agent-outputs/prd/ 至少含 1 个真实 PRD', () => {
  assert.ok(prdFixtures.length >= 1,
    'PRD fixture 必须至少 1 个（本次实战至少 ddt-team-admin-v0.8.1）');
});

for (const fx of prdFixtures) {
  test(`B1: extractUserStories 对 fixture ${fx.name} 必须抽出 ≥ 1 条 user story`, () => {
    const text = readFileSync(fx.path, 'utf8');
    const stories = extractUserStories(text);
    assert.ok(stories.length >= 1,
      `${fx.name}: 实战 PRD 解析为 0 条 stories（解析器与 agent 输出脱节）`);
    // 每条必须含 role / want / value 三个字段非空
    for (const s of stories) {
      assert.ok(s.role && s.role.length > 0, `${fx.name}: ${s.id} role 不应为空`);
      assert.ok(s.want && s.want.length > 0, `${fx.name}: ${s.id} want 不应为空`);
      assert.ok(s.value && s.value.length > 0, `${fx.name}: ${s.id} value 不应为空`);
    }
  });
}

// ─────────────────────────────────────────────────────────────────
// arch fixtures：每个真实 OpenAPI 必须能抽出 endpoints
// ─────────────────────────────────────────────────────────────────

const archFixtures = listFixtures('arch', ''); // arch/ 下是子目录

test('B1: arch fixtures 含 OpenAPI yaml 都能抽出 ≥ 5 endpoints', () => {
  for (const sub of readdirSync(FIXTURES + '/arch')) {
    const yamlPath = join(FIXTURES, 'arch', sub, 'api-contract.yaml');
    try {
      const text = readFileSync(yamlPath, 'utf8');
      const endpoints = extractEndpoints(text);
      assert.ok(endpoints.length >= 5,
        `arch/${sub}/api-contract.yaml 仅抽出 ${endpoints.length} endpoints（< 5）`);
    } catch (e) {
      if (e.code === 'ENOENT') continue;  // 子目录无 api-contract.yaml 跳过
      throw e;
    }
  }
});

// ─────────────────────────────────────────────────────────────────
// design-brief fixtures：每个真实 brief 必须能解析 visual_direction
// ─────────────────────────────────────────────────────────────────

const briefFixtures = listFixtures('design-brief');

for (const fx of briefFixtures) {
  test(`B1: parseVisualDirection 对 fixture ${fx.name} 必须解析出 selected`, () => {
    const text = readFileSync(fx.path, 'utf8');
    const vd = parseVisualDirection(text);
    if (vd === null) {
      // 一些 brief 可能没 §8.1 块，跳过
      assert.ok(true, `${fx.name}: 无 visual_direction 块（已跳过）`);
      return;
    }
    assert.ok(vd.selected && vd.selected.length > 0,
      `${fx.name}: visual_direction.selected 解析为空（D6 风险）`);
  });

  test(`B1: parseBriefMeta 对 fixture ${fx.name} 不抛异常 + 关键字段非空`, () => {
    const text = readFileSync(fx.path, 'utf8');
    const meta = parseBriefMeta(text);
    assert.ok(meta, `${fx.name}: parseBriefMeta 返回 null`);
    // 关键字段：persona / painPoint / endpointsSummary 至少有一个非空
    const hasContent = meta.persona || meta.painPoint || (meta.endpointsSummary && meta.endpointsSummary.length > 0);
    assert.ok(hasContent, `${fx.name}: brief 解析所有关键字段都为空（怀疑解析全失败）`);
  });
}

// ─────────────────────────────────────────────────────────────────
// 体积保护：fixture 不应过大（防止仓库膨胀）
// ─────────────────────────────────────────────────────────────────

test('B1: 单个 fixture 不超 100KB（README 约定）', () => {
  function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) {
        const size = statSync(full).size;
        assert.ok(size < 100 * 1024,
          `fixture ${full} 体积 ${size} 超 100KB，请截取片段`);
      }
    }
  }
  walk(FIXTURES);
});
