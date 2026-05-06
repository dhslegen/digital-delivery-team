// v0.8.2 D14：ingest-claude-design.mjs 加 --url 支持
//
// 实战 ddt-team-admin-v0.8.1 暴露：claude.ai/design 的 Handoff URL 是推荐回贴方式
// （commands/design-execute.md 里写了），但 ingest-claude-design.mjs 之前只支持
// --bundle <zip>。用户实战中 main thread 被迫手动 WebFetch + tar.gz 解压。
//
// 安全要求：
//   - 仅 https:// 协议
//   - SSRF 防御（拒 localhost / 10.* / 192.168.* / 169.254.* 等）
//   - 体积上限 100MB（防压缩炸弹）
//   - magic bytes 校验（仅 gzip 1F8B / zip 504B）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');
const SCRIPT = join(ROOT, 'bin', 'ingest-claude-design.mjs');

function run(args, env = {}) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: 'utf8', env: { ...process.env, ...env },
  });
}

test('v0.8.2 D14: 缺 --bundle 与 --url 时 exit 1', () => {
  const r = run([]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /必填其一/);
});

test('v0.8.2 D14: --url 必须 https://（拒 http）', async () => {
  const { fetchBundleFromUrl } = await import('../../bin/ingest-claude-design.mjs');
  await assert.rejects(
    () => fetchBundleFromUrl('http://example.com/bundle.zip'),
    /仅支持 https/
  );
});

test('v0.8.2 D14: --url 必须 https://（拒 file://）', async () => {
  const { fetchBundleFromUrl } = await import('../../bin/ingest-claude-design.mjs');
  await assert.rejects(
    () => fetchBundleFromUrl('file:///etc/passwd'),
    /仅支持 https/
  );
});

test('v0.8.2 D14: SSRF 防御拒 localhost', async () => {
  const { fetchBundleFromUrl } = await import('../../bin/ingest-claude-design.mjs');
  await assert.rejects(
    () => fetchBundleFromUrl('https://localhost:8080/bundle.zip'),
    /SSRF 防御.*localhost/
  );
});

test('v0.8.2 D14: SSRF 防御拒 127.0.0.1', async () => {
  const { fetchBundleFromUrl } = await import('../../bin/ingest-claude-design.mjs');
  await assert.rejects(
    () => fetchBundleFromUrl('https://127.0.0.1/secret'),
    /SSRF 防御/
  );
});

test('v0.8.2 D14: SSRF 防御拒 10.x.x.x', async () => {
  const { fetchBundleFromUrl } = await import('../../bin/ingest-claude-design.mjs');
  await assert.rejects(
    () => fetchBundleFromUrl('https://10.0.0.1/admin'),
    /SSRF 防御/
  );
});

test('v0.8.2 D14: SSRF 防御拒 192.168.x.x', async () => {
  const { fetchBundleFromUrl } = await import('../../bin/ingest-claude-design.mjs');
  await assert.rejects(
    () => fetchBundleFromUrl('https://192.168.1.1/router'),
    /SSRF 防御/
  );
});

test('v0.8.2 D14: SSRF 防御拒 AWS metadata 169.254.169.254', async () => {
  const { fetchBundleFromUrl } = await import('../../bin/ingest-claude-design.mjs');
  await assert.rejects(
    () => fetchBundleFromUrl('https://169.254.169.254/latest/meta-data/'),
    /SSRF 防御/
  );
});

test('v0.8.2 D14: 非法 URL 字符串拒绝', async () => {
  const { fetchBundleFromUrl } = await import('../../bin/ingest-claude-design.mjs');
  await assert.rejects(
    () => fetchBundleFromUrl('not-a-url'),
    /URL 无法解析/
  );
});

test('v0.8.2 D14: spawn --url 含 http:// 时 exit 6（拒非 https）', () => {
  const r = run(['--url', 'http://example.com/bundle.zip']);
  assert.equal(r.status, 6);
  assert.match(r.stderr, /仅支持 https/);
});

test('v0.8.2 D14: spawn --url 含 SSRF 主机时 exit 6', () => {
  const r = run(['--url', 'https://127.0.0.1/bundle']);
  assert.equal(r.status, 6);
  assert.match(r.stderr, /SSRF/);
});

test('v0.8.2 D14: design-execute.md case 分支应让 claude-design 支持 --url', async () => {
  const { readFileSync } = await import('node:fs');
  const text = readFileSync(join(ROOT, 'commands', 'design-execute.md'), 'utf8');
  // 必须含 claude-design) 走 ingest-claude-design.mjs --url
  assert.match(text, /claude-design\)[\s\S]*?ingest-claude-design\.mjs[\s\S]*?--url/,
    'design-execute.md 必须让 claude-design 走 ingest-claude-design.mjs --url 路径');
  // 旧的拒绝消息应消失
  assert.ok(!/claude-design.*?用.*?--bundle.*?不用.*?--url/.test(text),
    'design-execute.md 不应再含旧的"claude-design 不支持 --url"拒绝消息');
});
