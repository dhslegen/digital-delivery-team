// v0.8.1 D11: aggregate --bootstrap 应自动复制 .gitignore 模板，
// 让新项目根有"Untitled / .DS_Store / staging/"等兜底忽略项。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');
const SCRIPT = join(ROOT, 'bin', 'aggregate.mjs');

function bootstrap(cwd, env = {}) {
  return spawnSync(process.execPath, [SCRIPT, '--bootstrap', '--name', 'd11-test'], {
    cwd, encoding: 'utf8',
    env: { ...process.env, DDT_METRICS_DIR: cwd, ...env },
  });
}

test('v0.8.1 D11: --bootstrap 在项目根无 .gitignore 时直接复制模板', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'd11-fresh-'));
  try {
    const r = bootstrap(tmp);
    assert.equal(r.status, 0, `bootstrap failed: ${r.stderr}`);
    assert.ok(existsSync(join(tmp, '.gitignore')), '.gitignore 必须被创建');
    const content = readFileSync(join(tmp, '.gitignore'), 'utf8');
    assert.match(content, /Untitled/, '必含 Untitled 兜底');
    assert.match(content, /\.DS_Store/, '必含 .DS_Store 兜底');
    assert.match(content, /staging\//, '必含 staging/ 兜底');
    assert.match(content, /\.ddt\/locks/, '必含 .ddt/locks 兜底');
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('v0.8.1 D11: --bootstrap 在已有 .gitignore 时追加缺失项（不重复，不破坏自定义）', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'd11-merge-'));
  try {
    // 用户已有自定义 .gitignore
    const customLine = '# 用户的自定义\nMY_SECRET_FILE\nbuild/  # 已存在不应追加\n';
    writeFileSync(join(tmp, '.gitignore'), customLine);

    const r = bootstrap(tmp);
    assert.equal(r.status, 0);
    const content = readFileSync(join(tmp, '.gitignore'), 'utf8');

    // 用户自定义保留
    assert.match(content, /MY_SECRET_FILE/, '用户自定义不应被覆盖');
    // 模板新条目追加
    assert.match(content, /Untitled/, '应追加 Untitled');
    assert.match(content, /\.DS_Store/, '应追加 .DS_Store');
    // 已存在的不应重复（build/ 已在用户文件里）
    const buildOccurrences = (content.match(/^build\/$/gm) || []).length;
    assert.ok(buildOccurrences <= 1, `build/ 不应重复（出现 ${buildOccurrences} 次）`);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('v0.8.1 D11: 模板文件存在于 templates/.gitignore.template', () => {
  const tplPath = join(ROOT, 'templates', '.gitignore.template');
  assert.ok(existsSync(tplPath), 'templates/.gitignore.template 必须存在');
  const content = readFileSync(tplPath, 'utf8');
  assert.match(content, /Untitled/);
  assert.match(content, /\.DS_Store/);
});
