// M5-6: 验证 find-plugin-root.mjs 与 hooks 在 marketplaces/ 目录布局下能正确解析
// 复现 v0.5.0 真实安装路径 ~/.claude/plugins/marketplaces/digital-delivery-team
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync, symlinkSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');
const FIND_SCRIPT = join(ROOT, 'bin', 'find-plugin-root.mjs');

// 构造一个伪 ~/.claude 目录布局，把插件文件软链过去
function setupFakeClaudeDir(layout) {
  const fakeHome = mkdtempSync(join(tmpdir(), 'ddt-fake-home-'));
  mkdirSync(join(fakeHome, '.claude', 'plugins'), { recursive: true });
  for (const [relPath, mode] of Object.entries(layout)) {
    const target = join(fakeHome, '.claude', 'plugins', relPath);
    mkdirSync(dirname(target), { recursive: true });
    if (mode === 'link') {
      symlinkSync(ROOT, target);
    } else if (mode === 'fake') {
      mkdirSync(target, { recursive: true });
    }
  }
  return fakeHome;
}

function runFind(env) {
  return spawnSync(process.execPath, [FIND_SCRIPT], { encoding: 'utf8', env });
}

test('marketplaces/digital-delivery-team 直接路径解析（v0.5.0 真实场景）', () => {
  const fakeHome = setupFakeClaudeDir({
    'marketplaces/digital-delivery-team': 'link',
  });
  try {
    const env = { HOME: fakeHome, PATH: process.env.PATH };
    delete env.DDT_PLUGIN_ROOT;
    delete env.CLAUDE_PLUGIN_ROOT;
    const r = runFind(env);
    assert.equal(r.status, 0, `应找到插件: ${r.stderr}`);
    assert.equal(r.stdout.trim(), join(fakeHome, '.claude', 'plugins', 'marketplaces', 'digital-delivery-team'));
  } finally { rmSync(fakeHome, { recursive: true, force: true }); }
});

test('marketplaces/<other-marketplace>/digital-delivery-team 嵌套路径解析', () => {
  const fakeHome = setupFakeClaudeDir({
    'marketplaces/some-other-marketplace/digital-delivery-team': 'link',
  });
  try {
    const env = { HOME: fakeHome, PATH: process.env.PATH };
    delete env.DDT_PLUGIN_ROOT;
    delete env.CLAUDE_PLUGIN_ROOT;
    const r = runFind(env);
    assert.equal(r.status, 0);
    assert.ok(r.stdout.trim().endsWith('/digital-delivery-team'));
  } finally { rmSync(fakeHome, { recursive: true, force: true }); }
});

test('env DDT_PLUGIN_ROOT 指向无效路径时 fallback 到 marketplaces', () => {
  const fakeHome = setupFakeClaudeDir({
    'marketplaces/digital-delivery-team': 'link',
  });
  try {
    const env = {
      HOME: fakeHome,
      PATH: process.env.PATH,
      DDT_PLUGIN_ROOT: '/Users/nonexistent/old-path',  // 模拟用户 shell 残留旧路径
    };
    const r = runFind(env);
    assert.equal(r.status, 0, '无效 env 应被跳过，fallback 到 marketplaces');
    assert.notEqual(r.stdout.trim(), '/Users/nonexistent/old-path');
    assert.ok(r.stdout.trim().endsWith('/digital-delivery-team'));
  } finally { rmSync(fakeHome, { recursive: true, force: true }); }
});

test('plugin-hook-bootstrap.js 也加了 marketplaces 路径', () => {
  const text = readFileSync(join(ROOT, 'hooks', 'plugin-hook-bootstrap.js'), 'utf8');
  assert.ok(text.includes("'marketplaces', 'digital-delivery-team'"),
    'plugin-hook-bootstrap.js 必须包含 marketplaces 路径（复数）');
  assert.ok(text.includes("'plugins', 'marketplaces'"),
    'plugin-hook-bootstrap.js 必须包含 marketplaces 通配扫描');
});

test('hooks.json inline 已加 marketplaces 路径与 null fallback', () => {
  const text = readFileSync(join(ROOT, 'hooks', 'hooks.json'), 'utf8');
  assert.ok(text.includes('marketplaces\\",\\"digital-delivery-team'),
    'hooks.json inline 必须包含 marketplaces 路径');
  assert.ok(text.includes('return null'),
    'hooks.json inline 找不到时应返回 null（不再 fallback 到 cwd）');
  assert.ok(text.includes('Plugin root not found'),
    'hooks.json inline 必须有失败时的 stderr 提示');
});

test('SessionStart persistPluginRoot 验证 root 有效性', () => {
  const text = readFileSync(join(ROOT, 'hooks', 'handlers', 'session-start.js'), 'utf8');
  assert.ok(text.includes("path.join(root, 'bin', 'aggregate.mjs')"),
    'persistPluginRoot 必须验证 bin/aggregate.mjs 存在才写 marker');
});

test('commands marker fallback 都加了硬编码 marketplaces 兜底', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const commandsDir = join(ROOT, 'commands');
  const filesNeedingFallback = ['wbs.md', 'prd.md', 'design.md', 'design-brief.md', 'design-execute.md',
    'package.md', 'report.md', 'fix.md', 'doctor.md', 'resume.md'];
  for (const file of filesNeedingFallback) {
    const text = fs.readFileSync(path.join(commandsDir, file), 'utf8');
    assert.ok(text.includes('plugins/marketplaces/digital-delivery-team'),
      `${file} 必须含 marketplaces 兜底路径`);
    assert.ok(text.includes('aggregate.mjs'),
      `${file} 必须验证 bin/aggregate.mjs 存在`);
  }
});

// 让 createRequire 可用
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
