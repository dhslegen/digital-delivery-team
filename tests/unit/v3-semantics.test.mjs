import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');

function read(relPath) {
  return readFileSync(join(ROOT, relPath), 'utf8');
}

test('delivery context lists every v3 agent-owned deliverable', () => {
  const text = read('contexts/delivery.md');
  for (const required of [
    'docs/prd.md',
    'docs/wbs.md',
    'docs/risks.md',
    'docs/arch.md',
    'docs/api-contract.yaml',
    'docs/data-model.md',
    'web/__tests__/',
    'server/tests/',
    'server/migrations/',
    'tests/test-plan.md',
    'tests/**/*.spec.*',
    'tests/test-report.md',
    'docs/review-report.md',
    'docs/deploy.md',
    'docs/demo-script.md',
    'docs/efficiency-report.md',
  ]) {
    assert.ok(text.includes(required), `contexts/delivery.md missing ${required}`);
  }
});

test('metrics integrity keeps baseline independent from actual metrics', () => {
  const text = read('rules/delivery/metrics-integrity.md');
  const context = read('contexts/delivery.md');
  assert.match(text, /historical-projects\.csv \+ estimation-rules\.md/);
  assert.match(text, /`baseline\.mjs` 不得读取 metrics\.db、events\.jsonl/);
  assert.doesNotMatch(text, /metrics\.db → baseline\.mjs/);
  assert.doesNotMatch(text, /baseline\.mjs` 只读 metrics\.db/);
  assert.match(context, /baseline 封盘链彼此独立/);
  assert.doesNotMatch(context, /aggregate\.mjs` → `baseline\.mjs` → `report\.mjs/);
});

test('contract integrity uses the canonical API contract path and hard lint exits', () => {
  const text = read('rules/delivery/contract-integrity.md');
  assert.ok(text.includes('docs/api-contract.yaml'));
  assert.ok(!text.includes('docs/openapi.yaml'));
  assert.ok(text.includes('exit 4'));
  assert.ok(text.includes('退出 5'));
});

test('command refresh semantics remain incremental and reentrant', () => {
  const commandsDir = join(ROOT, 'commands');
  const files = readdirSync(commandsDir).filter(file => file.endsWith('.md'));
  const forbidden = [
    '全量重写 `',
    '覆盖已有',
    '删除 `',
    '删除上述',
    '重新执行全流程',
  ];

  for (const file of files) {
    const text = read(`commands/${file}`);
    if (!text.includes('## --refresh')) continue;
    const refreshSection = text.slice(text.indexOf('## --refresh'));
    assert.ok(refreshSection.includes('增量'), `commands/${file}: --refresh must say incremental`);
    assert.ok(refreshSection.includes('禁止'), `commands/${file}: --refresh must include a prohibition`);
    for (const phrase of forbidden) {
      assert.ok(
        !refreshSection.includes(phrase),
        `commands/${file}: --refresh still contains forbidden phrase ${phrase}`
      );
    }
  }
});
