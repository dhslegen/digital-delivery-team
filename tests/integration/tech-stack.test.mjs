// M3-9: tech-stack-presets / resolve-tech-stack 优先级链
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');
const SCRIPT = join(ROOT, 'bin', 'resolve-tech-stack.mjs');

function runResolve(cwd, args = []) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: 'utf8' });
}

test('preset 文件存在且 default_preset = java-modern', () => {
  const path = join(ROOT, 'templates', 'tech-stack-presets.yaml');
  const text = readFileSync(path, 'utf8');
  assert.ok(text.includes('default_preset: java-modern'));
  for (const preset of ['java-modern', 'java-traditional', 'node-modern', 'go-modern', 'python-fastapi']) {
    assert.ok(text.includes(`${preset}:`), `预设 ${preset} 缺失`);
  }
  for (const aiOpt of ['claude-design', 'figma', 'v0']) {
    assert.ok(text.includes(`${aiOpt}:`), `ai-design ${aiOpt} 选项缺失`);
  }
  // v0.8 W3：lovable 通道已删除
  assert.ok(!text.includes('lovable:'),
    'v0.8 W3 已删除 lovable 通道，tech-stack-presets.yaml 不应再含 lovable');
});

// v0.8.2 D13：claude-design 通道语义统一——必须是"外部 claude.ai/design 工具"
// 不能是 v0.5 残留的 "internal web-artifacts-builder 直接生成" 描述。
// 实战 ddt-team-admin-v0.8.1 暴露：tech-stack yaml 与 SKILL/commands 描述冲突
// 让 main thread 行为不一致（先派发，又试图直接生成）。
test('v0.8.2 D13: claude-design::requires_external 必须是外部工具语义', () => {
  for (const filename of ['tech-stack-presets.yaml', 'tech-stack-options.yaml']) {
    const text = readFileSync(join(ROOT, 'templates', filename), 'utf8');
    // 找到 claude-design 段——抓到下一个同级 sibling key（2 空格缩进）或下一个 root key
    const block = text.match(/^\s{2}claude-design:\s*\n([\s\S]*?)(?=^\s{2}[a-z]|^[a-z])/m);
    assert.ok(block, `${filename} 必须含 claude-design 段`);
    // 不能是 false（v0.5 旧语义）
    assert.ok(!/requires_external:\s*false/.test(block[0]),
      `${filename}::claude-design::requires_external 不应为 false（v0.5 旧语义）。` +
      `v0.8 起 claude-design 是外部 claude.ai/design 工具，需用户去外部完成设计后回贴 bundle 或 Handoff URL`);
    // 必须显式标注 claude.ai 或类似外部依赖
    assert.match(block[0], /requires_external:\s*claude\.ai/,
      `${filename}::claude-design::requires_external 应为 "claude.ai/design"，与 figma / v0 同语义`);
  }
});

test('v0.8.2 D13: claude-design 通道描述与 SKILL.md 一致（外部工具 + bundle/Handoff）', () => {
  const skillPath = join(ROOT, 'skills', 'ai-native-design', 'SKILL.md');
  const skill = readFileSync(skillPath, 'utf8');
  // SKILL 应描述"用户在外部工具完成迭代"
  assert.match(skill, /用户在外部工具完成迭代/,
    'ai-native-design SKILL 必须明确"用户去外部工具完成"工作流');
  // claude-design 段必须含 "claude.ai/design"
  assert.match(skill, /claude\.ai\/design/,
    'ai-native-design SKILL 必须引用 claude.ai/design 外部产品');
});

test('优先级 1：CLI flag --preset 覆盖一切', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'ddt-stack-cli-'));
  try {
    // 即使有干扰 manifest（package.json）也应被 CLI flag 覆盖
    writeFileSync(join(tmp, 'package.json'), '{"dependencies": {"@nestjs/core": "*"}}');
    const r = runResolve(tmp, ['--preset', 'go-modern']);
    assert.equal(r.status, 0);
    const stack = JSON.parse(r.stdout);
    assert.equal(stack.preset, 'go-modern');
    assert.equal(stack.source, 'cli-flag');
    assert.equal(stack.backend.language, 'go');
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('优先级 2：project-brief.md 技术栈预设', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'ddt-stack-brief-'));
  try {
    writeFileSync(join(tmp, 'project-brief.md'),
      '# Brief\n\n## 关键约束\n\n- **技术栈预设**: node-modern\n');
    const r = runResolve(tmp);
    assert.equal(r.status, 0);
    const stack = JSON.parse(r.stdout);
    assert.equal(stack.preset, 'node-modern');
    assert.equal(stack.source, 'project-brief');
    assert.equal(stack.backend.framework, 'nestjs');
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('优先级 3：已存在的 .ddt/tech-stack.json', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'ddt-stack-existing-'));
  try {
    mkdirSync(join(tmp, '.ddt'), { recursive: true });
    writeFileSync(join(tmp, '.ddt', 'tech-stack.json'),
      JSON.stringify({ preset: 'python-fastapi', ai_design: { type: 'figma' } }));
    const r = runResolve(tmp);
    assert.equal(r.status, 0);
    const stack = JSON.parse(r.stdout);
    assert.equal(stack.preset, 'python-fastapi');
    assert.equal(stack.source, 'existing-tech-stack-json');
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('优先级 4：manifest 自动检测', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'ddt-stack-manifest-'));
  try {
    writeFileSync(join(tmp, 'pom.xml'), '<project/>');
    const r = runResolve(tmp);
    assert.equal(r.status, 0);
    const stack = JSON.parse(r.stdout);
    assert.equal(stack.preset, 'java-modern');
    assert.equal(stack.source, 'manifest-detect');
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('优先级 5：默认 java-modern', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'ddt-stack-default-'));
  try {
    const r = runResolve(tmp);
    assert.equal(r.status, 0);
    const stack = JSON.parse(r.stdout);
    assert.equal(stack.preset, 'java-modern');
    assert.equal(stack.source, 'default');
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('--write 写入 .ddt/tech-stack.json', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'ddt-stack-write-'));
  try {
    const r = runResolve(tmp, ['--preset', 'node-modern', '--write']);
    assert.equal(r.status, 0);
    const path = join(tmp, '.ddt', 'tech-stack.json');
    assert.ok(existsSync(path));
    const stack = JSON.parse(readFileSync(path, 'utf8'));
    assert.equal(stack.preset, 'node-modern');
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('无效 preset 退出码 2', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'ddt-stack-bad-'));
  try {
    const r = runResolve(tmp, ['--preset', 'no-such-preset']);
    assert.equal(r.status, 2);
    assert.ok(r.stderr.includes('不存在'));
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('node-modern manifest 检测：next.js / nest.js', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'ddt-stack-node-'));
  try {
    writeFileSync(join(tmp, 'package.json'), JSON.stringify({
      dependencies: { '@nestjs/core': '*' }
    }));
    const r = runResolve(tmp);
    assert.equal(r.status, 0);
    const stack = JSON.parse(r.stdout);
    assert.equal(stack.preset, 'node-modern');
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});
