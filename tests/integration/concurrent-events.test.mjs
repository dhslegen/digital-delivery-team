// H1: 100 并发 appendEvent 不丢/不交错
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');

// 注意：node -e <script> arg1 arg2 时，process.argv = [node, arg1, arg2]
// 第一个 arg 在 argv[1]（不是 [2]），与脚本文件模式不同
const SMALL_EVENT_WRITER = `
const path = require('node:path');
const root = ${JSON.stringify(ROOT)};
process.env.DDT_METRICS_DIR = process.argv[1];
const { appendEvent } = require(path.join(root, 'hooks/handlers/lib/events.js'));
const id = process.argv[2];
for (let i = 0; i < 50; i++) {
  appendEvent('concurrent_test', 'p-stress', { worker: id, seq: i });
}
`;

const LARGE_EVENT_WRITER = `
const path = require('node:path');
const root = ${JSON.stringify(ROOT)};
process.env.DDT_METRICS_DIR = process.argv[1];
const { appendEvent } = require(path.join(root, 'hooks/handlers/lib/events.js'));
const id = process.argv[2];
const big = 'x'.repeat(800); // 强制走 lock 路径（>512B）
for (let i = 0; i < 20; i++) {
  appendEvent('concurrent_large', 'p-stress', { worker: id, seq: i, payload: big });
}
`;

function spawnWorkers(script, metricsDir, workerCount) {
  const children = [];
  for (let i = 0; i < workerCount; i++) {
    const child = spawn(process.execPath, ['-e', script, metricsDir, `w${i}`],
      { stdio: 'ignore' });
    children.push(new Promise(resolve => {
      child.on('exit', code => resolve(code));
      child.on('error', () => resolve(1));
    }));
  }
  return Promise.all(children);
}

test('100 个小事件并发写入：所有事件保留且每行可解析（O_APPEND 原子性）', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'ddt-concurrent-small-'));
  try {
    const codes = await spawnWorkers(SMALL_EVENT_WRITER, tmp, 10);
    assert.deepEqual(codes, Array(10).fill(0), '所有 worker 必须成功退出');

    const eventsFile = join(tmp, 'events.jsonl');
    assert.ok(existsSync(eventsFile));
    const lines = readFileSync(eventsFile, 'utf8').split('\n').filter(Boolean);
    assert.equal(lines.length, 10 * 50, '应有 500 条事件，无丢失');

    // 每行必须是合法 JSON
    let badLines = 0;
    for (const line of lines) {
      try { JSON.parse(line); } catch { badLines++; }
    }
    assert.equal(badLines, 0, `${badLines} 条事件 JSON 不合法（说明并发交错）`);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('大事件并发写入：lock 路径不交错', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'ddt-concurrent-large-'));
  try {
    const codes = await spawnWorkers(LARGE_EVENT_WRITER, tmp, 10);
    assert.deepEqual(codes, Array(10).fill(0));

    const eventsFile = join(tmp, 'events.jsonl');
    const lines = readFileSync(eventsFile, 'utf8').split('\n').filter(Boolean);
    assert.equal(lines.length, 10 * 20, '应有 200 条大事件，无丢失');

    let badLines = 0;
    let workerCounts = new Map();
    for (const line of lines) {
      try {
        const ev = JSON.parse(line);
        const w = ev.data && ev.data.worker;
        if (w) workerCounts.set(w, (workerCounts.get(w) || 0) + 1);
      } catch { badLines++; }
    }
    assert.equal(badLines, 0, `${badLines} 条大事件 JSON 不合法（lock 失败）`);
    assert.equal(workerCounts.size, 10, '10 个 worker 都应有事件入档');
    for (const [w, count] of workerCounts) {
      assert.equal(count, 20, `worker ${w} 应有 20 条事件，实际 ${count}`);
    }
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('lock 文件在写入完成后被清理', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'ddt-lock-cleanup-'));
  try {
    await spawnWorkers(LARGE_EVENT_WRITER, tmp, 5);
    const lockFile = join(tmp, 'events.jsonl.lock');
    assert.ok(!existsSync(lockFile), 'lock 文件必须在写入完成后清理');
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('ATOMIC_WRITE_THRESHOLD = 512 暴露给消费者', () => {
  const result = spawnSync(process.execPath, ['-e',
    `const m = require('${ROOT}/hooks/handlers/lib/events.js');
     console.log(m.ATOMIC_WRITE_THRESHOLD);`],
    { encoding: 'utf8' });
  assert.equal(result.stdout.trim(), '512');
});
