// W7.5 Block E：用户体验修复测试
//
// R7: derive-channel-package.mjs fillTemplate 不解释 $1 / $& backreference
// R9: design-execute.md bundle / url 解析支持含空格路径与引号
// R11: design-execute.md Phase 4 按 lockfile 选包管理器
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../..');

// ─── R7: fillTemplate 防 $-序列被当 backreference ──────────────────────

test('R7: derive-channel-package 端到端 — visualRationale 含 "$10" 字面保留', () => {
  // 构造一个真实的 sandbox，跑 derive-channel-package --channel claude-design
  const sandbox = mkdtempSync(join(tmpdir(), 'ddt-r7-'));
  try {
    mkdirSync(join(sandbox, 'docs'), { recursive: true });
    mkdirSync(join(sandbox, '.ddt', 'design', 'assets'), { recursive: true });

    writeFileSync(join(sandbox, 'docs/prd.md'), '# PRD\n\n**用户故事**：As a user, I want X, so that Y.\n');
    writeFileSync(join(sandbox, 'docs/api-contract.yaml'),
      'openapi: 3.0.0\ninfo:\n  title: t\n  version: "1"\npaths:\n  /foo:\n    get:\n      responses:\n        "200":\n          description: ok\n');
    // 关键：在 visualRationale 写 "$10 起步" — 旧版 String.replace 会把 $1 当 capture group
    writeFileSync(join(sandbox, 'docs/design-brief.md'), `# Design Brief
## 1. Problem Alignment
- **用户**：A
- **痛点**：B

## 2. User Stories

## 3. Information Architecture

## 8. Visual Direction

\`\`\`yaml
visual_direction:
  selected: industrial
  rationale: $10 起步成本，含 \\路径
\`\`\`

## 9. References
- **风格关键词**：$50 主导色
`);
    writeFileSync(join(sandbox, '.ddt/tech-stack.json'),
      '{"preset":"node-modern","frontend":{"type":"spa"},"ai_design":{"type":"claude-design"}}');
    writeFileSync(join(sandbox, '.ddt/design/tokens.json'),
      '{"color":{"primary":"#2C3F4C"},"spacing":[2,4,8]}');
    writeFileSync(join(sandbox, '.ddt/design/components-inventory.md'), '# Inventory\n');

    const r = spawnSync(process.execPath,
      [join(repoRoot, 'bin/derive-channel-package.mjs'), '--channel', 'claude-design'],
      { cwd: sandbox, encoding: 'utf8' });

    assert.equal(r.status, 0, `derive 应 exit 0；stderr: ${r.stderr}`);

    const promptPath = join(sandbox, '.ddt/design/claude-design/prompt.md');
    const prompt = readFileSync(promptPath, 'utf8');

    // "$10" 应字面出现 — 不被解释为"capture group 1 + 0"
    assert.match(prompt, /\$10 起步成本/,
      `visualRationale "$10 起步" 应字面保留；prompt 实际：${prompt.slice(0, 800)}`);
    // "\路径" 反斜杠应保留（旧版 \\ 会被 replace 转义吃掉）
    assert.match(prompt, /\\路径/,
      `visualRationale "\\路径" 反斜杠应字面保留`);
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});

// ─── R9: bundle/url 解析支持含空格路径与引号 ──────────────────────

// 调用真实的 bin/parse-cli-flag.mjs 做集成测试
function parseFlag(argString, flag) {
  const r = spawnSync(process.execPath,
    [join(repoRoot, 'bin/parse-cli-flag.mjs'), '--flag', flag, '--', argString],
    { encoding: 'utf8' });
  return r.stdout;
}

test('R9: parseFlag 处理无引号路径', () => {
  assert.equal(parseFlag('--bundle /tmp/foo.zip', 'bundle'), '/tmp/foo.zip');
});

test('R9: parseFlag 处理双引号包裹的含空格路径', () => {
  assert.equal(parseFlag('--bundle "/Users/me/Downloads/My Design.zip"', 'bundle'),
    '/Users/me/Downloads/My Design.zip');
});

test('R9: parseFlag 处理单引号包裹的含空格路径', () => {
  assert.equal(parseFlag("--bundle '/path with space/foo.zip'", 'bundle'),
    '/path with space/foo.zip');
});

test('R9: parseFlag 多 flag 共存时不互相干扰', () => {
  const args = '--channel claude-design --bundle "/path/foo.zip" --refresh';
  assert.equal(parseFlag(args, 'bundle'), '/path/foo.zip');
  assert.equal(parseFlag(args, 'channel'), 'claude-design');
});

test('R9: design-execute.md Phase 2 调 bin/parse-cli-flag.mjs（不再用 grep [^ ]+）', () => {
  const text = readFileSync(join(repoRoot, 'commands/design-execute.md'), 'utf8');
  assert.match(text, /W7\.5 R9/, 'Phase 2 必须有 W7.5 R9 注释');
  const phase2 = text.match(/## Phase 2[\s\S]*?## Phase 3/);
  assert.ok(phase2, '找不到 Phase 2');
  assert.match(phase2[0], /BUNDLE_PATH=\$\(node "\$DDT_PLUGIN_ROOT\/bin\/parse-cli-flag\.mjs"/);
  assert.match(phase2[0], /URL=\$\(node "\$DDT_PLUGIN_ROOT\/bin\/parse-cli-flag\.mjs"/);
  // 不应再用脆的 grep [^ ]+
  assert.doesNotMatch(phase2[0], /--bundle\s+\[\^\s\]\+/);
});

// ─── R11: Phase 4 按 lockfile 选包管理器 ──────────────────────

test('R11: design-execute.md Phase 4 含 lockfile 检测', () => {
  const text = readFileSync(join(repoRoot, 'commands/design-execute.md'), 'utf8');
  const phase4 = text.match(/## Phase 4[\s\S]*?## Phase 5/);
  assert.ok(phase4, '找不到 Phase 4');
  // 必须按顺序检测 yarn.lock → pnpm-lock.yaml，否则默认 npm
  assert.match(phase4[0], /yarn\.lock/, 'Phase 4 必须检测 yarn.lock');
  assert.match(phase4[0], /pnpm-lock\.yaml/, 'Phase 4 必须检测 pnpm-lock.yaml');
  assert.match(phase4[0], /PM=npm/, 'Phase 4 必须有 npm fallback');
  assert.match(phase4[0], /\$PM run build/, 'Phase 4 必须用 $PM 变量调脚本');
  // 不应再硬编码 npm run build
  const phase4Text = phase4[0];
  const hardcodedNpm = phase4Text.match(/\bnpm run (build|lint|test)/g) || [];
  assert.equal(hardcodedNpm.length, 0,
    `Phase 4 不应再硬编码 npm run；实际：${JSON.stringify(hardcodedNpm)}`);
});
