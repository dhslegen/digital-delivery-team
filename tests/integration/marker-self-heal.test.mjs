// v0.9.3 D20 / D21：persistPluginRoot 优先扫描 cache 选最新版本
//
// 实战 v0.9.2 暴露：用户跑 /plugin install digital-delivery-team@0.9.x 安装新版本，
// 但 marker 仍指向首次会话写入的旧版（如 0.8.1），导致新功能用不上。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');
const HOOK = join(ROOT, 'hooks', 'handlers', 'session-start.js');

const require = createRequire(import.meta.url);
const { pickLatestPluginRoot, persistPluginRoot, semverCompare } = require(HOOK);

// 在临时 home 目录里搭"假 cache"——含多版本，每个版本含 bin/aggregate.mjs
function setupFakeHome(versions, options = {}) {
  const fakeHome = mkdtempSync(join(tmpdir(), 'ddt-d20-'));
  const cacheDir = join(fakeHome, '.claude', 'plugins', 'cache',
    'digital-delivery-team', 'digital-delivery-team');
  mkdirSync(cacheDir, { recursive: true });
  for (const v of versions) {
    const dir = join(cacheDir, v);
    mkdirSync(join(dir, 'bin'), { recursive: true });
    if (!options.skipAggregate?.includes(v)) {
      writeFileSync(join(dir, 'bin', 'aggregate.mjs'), '// fake aggregate');
    }
  }
  return fakeHome;
}

function readMarker(fakeHome) {
  const markerPath = join(fakeHome, '.claude', 'delivery-metrics', '.ddt-plugin-root');
  try { return readFileSync(markerPath, 'utf8'); }
  catch { return null; }
}

function withFakeEnv(fakeHome, envOverride, fn) {
  const saved = {
    HOME: process.env.HOME,
    DDT_METRICS_DIR: process.env.DDT_METRICS_DIR,
    DDT_PLUGIN_ROOT: process.env.DDT_PLUGIN_ROOT,
    CLAUDE_PLUGIN_ROOT: process.env.CLAUDE_PLUGIN_ROOT,
  };
  try {
    process.env.HOME = fakeHome;
    process.env.DDT_METRICS_DIR = join(fakeHome, '.claude', 'delivery-metrics');
    delete process.env.DDT_PLUGIN_ROOT;
    delete process.env.CLAUDE_PLUGIN_ROOT;
    if (envOverride.DDT_PLUGIN_ROOT) process.env.DDT_PLUGIN_ROOT = envOverride.DDT_PLUGIN_ROOT;
    return fn();
  } finally {
    Object.entries(saved).forEach(([k, v]) => {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    });
  }
}

// ─── pickLatestPluginRoot 单元测试 ─────────────────────────────────

test('D20: pickLatestPluginRoot 多版本时挑最新', () => {
  const fakeHome = setupFakeHome(['0.7.3', '0.8.0', '0.8.1', '0.9.0', '0.9.2']);
  try {
    const picked = pickLatestPluginRoot(fakeHome);
    assert.ok(picked);
    assert.match(picked, /0\.9\.2$/, `应挑 0.9.2，实际 ${picked}`);
  } finally { rmSync(fakeHome, { recursive: true, force: true }); }
});

test('D20: pickLatestPluginRoot 跳过缺 bin/aggregate.mjs 的版本', () => {
  const fakeHome = setupFakeHome(['0.9.0', '0.9.2'], { skipAggregate: ['0.9.2'] });
  try {
    const picked = pickLatestPluginRoot(fakeHome);
    assert.match(picked, /0\.9\.0$/, '0.9.2 缺 aggregate 应跳过回退到 0.9.0');
  } finally { rmSync(fakeHome, { recursive: true, force: true }); }
});

test('D20: pickLatestPluginRoot 忽略非 semver 目录', () => {
  const fakeHome = setupFakeHome(['0.8.1', '0.9.2', 'tmp', 'backup']);
  try {
    const picked = pickLatestPluginRoot(fakeHome);
    assert.match(picked, /0\.9\.2$/);
  } finally { rmSync(fakeHome, { recursive: true, force: true }); }
});

test('D20: pickLatestPluginRoot cache 不存在返回 null', () => {
  const fakeHome = mkdtempSync(join(tmpdir(), 'ddt-d20-no-cache-'));
  try {
    assert.equal(pickLatestPluginRoot(fakeHome), null);
  } finally { rmSync(fakeHome, { recursive: true, force: true }); }
});

// ─── semverCompare 行为测试 ─────────────────────────────────

test('D20: semverCompare 处理 10.0 > 9.9（数字而非字符串排序）', () => {
  const versions = ['0.9.9', '0.10.0', '0.8.1'];
  versions.sort(semverCompare);
  assert.deepEqual(versions, ['0.8.1', '0.9.9', '0.10.0']);
});

test('D20: semverCompare 数字部分大于字符串部分（0.9.3 > 0.9.3-beta）', () => {
  const versions = ['0.9.3-beta', '0.9.3'];
  versions.sort(semverCompare);
  assert.deepEqual(versions, ['0.9.3-beta', '0.9.3']);
});

// ─── persistPluginRoot 集成测试（写真 marker 文件）─────────────────────────────────

test('D20: persistPluginRoot 多版本 cache 写最新版到 marker', () => {
  const fakeHome = setupFakeHome(['0.7.3', '0.8.1', '0.9.2']);
  try {
    withFakeEnv(fakeHome, {}, () => persistPluginRoot());
    const marker = readMarker(fakeHome);
    assert.ok(marker, 'marker 应被写入');
    assert.match(marker, /0\.9\.2$/, `marker 必须指向最新 0.9.2，实际 ${marker}`);
  } finally { rmSync(fakeHome, { recursive: true, force: true }); }
});

test('D20: env DDT_PLUGIN_ROOT 指旧版时 cache 最新版仍优先', () => {
  const fakeHome = setupFakeHome(['0.8.1', '0.9.2']);
  try {
    const oldRoot = join(fakeHome, '.claude', 'plugins', 'cache',
      'digital-delivery-team', 'digital-delivery-team', '0.8.1');
    withFakeEnv(fakeHome, { DDT_PLUGIN_ROOT: oldRoot }, () => persistPluginRoot());
    const marker = readMarker(fakeHome);
    assert.match(marker, /0\.9\.2$/, `cache 最新优于 env 旧版，实际 ${marker}`);
  } finally { rmSync(fakeHome, { recursive: true, force: true }); }
});

test('D20: cache 不存在时 fallback 到 env DDT_PLUGIN_ROOT', () => {
  const fakeHome = mkdtempSync(join(tmpdir(), 'ddt-d20-no-cache-'));
  try {
    // 用本仓库根作 env（含 bin/aggregate.mjs）
    withFakeEnv(fakeHome, { DDT_PLUGIN_ROOT: ROOT }, () => persistPluginRoot());
    const marker = readMarker(fakeHome);
    assert.equal(marker, ROOT);
  } finally { rmSync(fakeHome, { recursive: true, force: true }); }
});

test('D20: 既无 cache 又无 env 时不写 marker（degraded mode）', () => {
  const fakeHome = mkdtempSync(join(tmpdir(), 'ddt-d20-empty-'));
  try {
    withFakeEnv(fakeHome, {}, () => persistPluginRoot());
    assert.equal(readMarker(fakeHome), null, '无候选时不写 marker，避免污染');
  } finally { rmSync(fakeHome, { recursive: true, force: true }); }
});
