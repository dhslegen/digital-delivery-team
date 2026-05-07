// v0.9.6 D23：check-brief-quality.mjs 跑真实 LLM 产出 brief 必须 pass
//
// 实战暴露：v0.9.4 / v0.9.5 SKILL.md 例子里的"§N 编号 + 独立技术栈章节"格式
// 让 LLM 自动产出的 brief 在自检时**全部失败**——脚本与 brief 风格脱节。
//
// 修复后 fixture 必须验证：
// - alv-ops 风格（LLM 自动产出，§N 编号 + ## 技术栈预设 独立章节）
// - team-admin 风格（手写，## 技术栈选型 → **技术栈预设**：xxx inline）
// 两种合法风格都能跑通自检（fill_rate ≥ 70 且 pass=true）

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');
const SCRIPT = join(ROOT, 'skills', 'ddt-brief-builder', 'scripts', 'check-brief-quality.mjs');
const FIXTURES = join(ROOT, 'tests', 'fixtures', 'real-agent-outputs', 'brief');

function runQuality(briefPath) {
  const r = spawnSync(process.execPath, [SCRIPT, briefPath, '--json'], {
    encoding: 'utf8',
  });
  // 抓 JSON 部分（脚本默认前面有"人话"段，--json 仍含；从 stdout 找 JSON 起始 `{`）
  const jsonStart = r.stdout.indexOf('{');
  const json = JSON.parse(r.stdout.slice(jsonStart));
  return { exitCode: r.status, json };
}

const fixtures = readdirSync(FIXTURES).filter(f => f.endsWith('.md'));

test('D23: 真实 brief fixture 至少 1 个', () => {
  assert.ok(fixtures.length >= 1, '至少需要 1 个真实 brief fixture');
});

for (const fixture of fixtures) {
  test(`D23: fixture ${fixture} 必须 pass（fill_rate ≥ 70 且必填全填）`, () => {
    const path = join(FIXTURES, fixture);
    const { exitCode, json } = runQuality(path);
    assert.equal(json.pass, true,
      `${fixture} 自检失败：fill_rate=${json.fill_rate_pct}% / blockers=${JSON.stringify(json.blockers)}`);
    assert.ok(json.fill_rate_pct >= 70,
      `${fixture} fill_rate=${json.fill_rate_pct}% < 70%（合法 brief 风格不应被误判）`);
    assert.equal(exitCode, 0, `${fixture} exit code 应为 0`);
  });
}

test('D23: alv-ops 风格 LLM 自动产出（§N + 独立章节）填充率 = 100%', () => {
  const path = join(FIXTURES, 'alv-ops-llm-generated.md');
  const { json } = runQuality(path);
  assert.equal(json.fill_rate_pct, 100,
    `alv-ops fixture 应填满 10/10 字段，实际 ${json.fill_rate_pct}%`);
});

test('D23: team-admin 风格手写版（## 技术栈选型 → inline）填充率 ≥ 90%', () => {
  const path = join(FIXTURES, 'team-admin-handwritten.md');
  const { json } = runQuality(path);
  assert.ok(json.fill_rate_pct >= 90,
    `team-admin fixture 填充率应 ≥ 90%，实际 ${json.fill_rate_pct}%`);
});

// 反向防御：旧严格正则的"未带 §N"风格不应误判已加 §N 的合法 brief
test('D23: 标题含 §N 编号不应被识别为"段落标题缺失"', () => {
  // 构造一个最小 brief 用 §N 风格
  const tmp = '/tmp/test-brief-' + Date.now() + '.md';
  const minimal = `# Test\n\n## §1 项目背景\n这是一个测试项目，验证 §N 编号能被识别。\n\n## §2 目标用户\n- 主要：开发者\n- 次要：测试人员\n\n## §3 成功标准\n- [ ] 测试通过 100%\n\n## §4 核心功能\n1. 功能 A\n2. 功能 B\n3. 功能 C\n\n## §5 关键约束\n- 截止日期：2026-12-31\n\n## 技术栈预设\nnode-modern\n`;
  writeFileSync(tmp, minimal);
  try {
    const { json } = runQuality(tmp);
    // 必填 6 个全应识别（项目背景 / 用户 / 成功标准 / 核心功能 / 关键约束 / 技术栈）
    assert.equal(json.filled_required.split('/')[0], '6',
      `§N 编号风格应识别 6/6 必填，实际 ${json.filled_required}`);
  } finally { try { unlinkSync(tmp); } catch {} }
});
