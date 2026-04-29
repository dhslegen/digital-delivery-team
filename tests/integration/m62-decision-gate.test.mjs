// M6.2: decision-gate skill / emit-decision / 10 commands 注入决策门 / preview / kickoff interactive
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, rmSync, mkdirSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { DeliveryStore } from '../../bin/lib/store.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');

test('decision-gate skill 已建立 + 含核心要求', () => {
  const path = join(ROOT, 'skills', 'decision-gate', 'SKILL.md');
  assert.ok(existsSync(path));
  const text = readFileSync(path, 'utf8');
  assert.ok(text.includes('AskUserQuestion'));
  assert.ok(text.includes('接受并继续'));
  assert.ok(text.includes('修改某条具体内容'));
  assert.ok(text.includes('新增内容'));
  assert.ok(text.includes('重新生成'));
  assert.ok(text.includes('--auto'));
  assert.ok(text.includes('emit-decision.mjs'));
});

test('emit-decision 写入 events.jsonl + .ddt/decisions.jsonl', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'ddt-decision-'));
  try {
    mkdirSync(join(tmp, '.ddt'), { recursive: true });
    writeFileSync(join(tmp, '.ddt/project-id'), 'p-dec-001');

    const env = { ...process.env, DDT_METRICS_DIR: join(tmp, '.metrics') };

    // emit point
    const r1 = spawnSync(process.execPath,
      [join(ROOT, 'bin/emit-decision.mjs'), '--phase', 'prd', '--action', 'point',
       '--options', 'accept|modify|add|regenerate'],
      { cwd: tmp, env, encoding: 'utf8' });
    assert.equal(r1.status, 0);

    // emit resolved
    const r2 = spawnSync(process.execPath,
      [join(ROOT, 'bin/emit-decision.mjs'), '--phase', 'prd', '--action', 'resolved',
       '--user-action', 'accept', '--note', 'looks good'],
      { cwd: tmp, env, encoding: 'utf8' });
    assert.equal(r2.status, 0);

    // 全局 events.jsonl 含 2 条
    const globalEvents = readFileSync(join(tmp, '.metrics', 'events.jsonl'), 'utf8')
      .split('\n').filter(Boolean).map(JSON.parse);
    assert.equal(globalEvents.length, 2);
    assert.equal(globalEvents[0].event, 'decision_point');
    assert.equal(globalEvents[1].event, 'decision_resolved');
    assert.equal(globalEvents[1].data.user_action, 'accept');
    assert.equal(globalEvents[1].data.note, 'looks good');

    // 项目本地 .ddt/decisions.jsonl 也含 2 条
    const localEvents = readFileSync(join(tmp, '.ddt', 'decisions.jsonl'), 'utf8')
      .split('\n').filter(Boolean);
    assert.equal(localEvents.length, 2);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('store 处理 decision_point/resolved 事件入 decisions 表', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'ddt-dec-store-'));
  try {
    const events = [
      { event: 'decision_point', project_id: 'p1', ts: '2026-04-29T00:01:00Z',
        data: { session_id: 's1', phase: 'prd', options: 'accept|modify' } },
      { event: 'decision_resolved', project_id: 'p1', ts: '2026-04-29T00:01:30Z',
        data: { session_id: 's1', phase: 'prd', user_action: 'accept', note: 'OK' } },
    ];
    writeFileSync(join(tmp, 'events.jsonl'),
      events.map(e => JSON.stringify(e)).join('\n') + '\n');

    const env = { ...process.env, DDT_METRICS_DIR: tmp };
    const r = spawnSync(process.execPath,
      [join(ROOT, 'bin/aggregate.mjs'), '--project', 'p1'],
      { cwd: ROOT, env, encoding: 'utf8' });
    assert.equal(r.status, 0);

    const store = new DeliveryStore(join(tmp, 'metrics.db'));
    await store.openOrCreate();
    const rows = store._db.prepare('SELECT * FROM decisions WHERE project_id=?').all('p1');
    assert.equal(rows.length, 1, '应配对成 1 行（point + resolved 合并）');
    assert.equal(rows[0].user_action, 'accept');
    assert.equal(rows[0].note, 'OK');
    assert.ok(rows[0].point_ts);
    assert.ok(rows[0].resolved_ts);
    store.close();
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('emit-decision 拒绝无效参数', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'ddt-dec-bad-'));
  try {
    const env = { ...process.env, DDT_METRICS_DIR: join(tmp, '.metrics') };
    const r1 = spawnSync(process.execPath,
      [join(ROOT, 'bin/emit-decision.mjs'), '--phase', 'bad', '--action', 'point'],
      { cwd: tmp, env, encoding: 'utf8' });
    assert.equal(r1.status, 1);
    const r2 = spawnSync(process.execPath,
      [join(ROOT, 'bin/emit-decision.mjs'), '--phase', 'prd', '--action', 'resolved'],
      { cwd: tmp, env, encoding: 'utf8' });
    assert.equal(r2.status, 1, 'resolved 必须搭配 --user-action');
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('10 个 phase command 都注入了完整决策门段落', () => {
  const phases = ['prd', 'wbs', 'design', 'build-api', 'build-web',
    'test', 'review', 'fix', 'package', 'report'];
  for (const phase of phases) {
    const text = readFileSync(join(ROOT, 'commands', `${phase}.md`), 'utf8');
    assert.ok(text.includes('## Phase 决策门 — M6.2'),
      `${phase}.md 必须含决策门段落`);
    assert.ok(text.includes('decision-gate'),
      `${phase}.md 必须引用 decision-gate skill`);
    assert.ok(text.includes('AskUserQuestion'),
      `${phase}.md 必须引用 AskUserQuestion`);
    assert.ok(text.includes(`--phase ${phase}`),
      `${phase}.md 必须传正确 --phase`);
    assert.ok(text.includes('--auto'),
      `${phase}.md 必须支持 --auto 跳过`);
  }
});

// H9: impl.md 走"委托式决策门"（引用 skill 而非内嵌 AskUserQuestion 模板）
test('impl.md 委托式决策门：引用 skill + emit-decision + --auto', () => {
  const text = readFileSync(join(ROOT, 'commands', 'impl.md'), 'utf8');
  assert.ok(text.includes('## Phase 决策门 — M6.2'),
    'impl.md 必须含决策门段落');
  assert.ok(text.includes('decision-gate'),
    'impl.md 必须引用 decision-gate skill');
  assert.ok(text.includes('--phase impl'),
    'impl.md 必须传 --phase impl');
  assert.ok(text.includes('--auto'),
    'impl.md 必须支持 --auto 跳过');
});

// H9: 19 命令分类完整性 — 防止未来增删命令时偷偷绕过决策门契约
test('全 19 commands 按"决策门 / 编排聚合 / 辅助"分类无遗漏', () => {
  const allCmds = readdirSync(join(ROOT, 'commands'))
    .filter(f => f.endsWith('.md'))
    .map(f => f.replace(/\.md$/, ''))
    .sort();

  // 分类：含完整决策门段落 / 编排聚合（派发别的命令）/ 辅助（只读或工具型）
  const HAS_DECISION_GATE = new Set([
    'prd', 'wbs', 'design', 'build-api', 'build-web',
    'test', 'review', 'fix', 'package', 'report', 'impl',
  ]);
  const ORCHESTRATION_AGGREGATE = new Set([
    'kickoff', 'verify', 'ship',  // kickoff 走"interactive 模式"非 phase 决策门；verify/ship 是聚合派发
  ]);
  const AUXILIARY = new Set([
    'doctor', 'import-design', 'preview', 'relay', 'resume',
  ]);

  // 全 19 命令必须落入恰好一类
  for (const cmd of allCmds) {
    const inOne = [HAS_DECISION_GATE, ORCHESTRATION_AGGREGATE, AUXILIARY]
      .filter(s => s.has(cmd)).length;
    assert.equal(inOne, 1,
      `命令 ${cmd} 必须恰好属于一类（决策门/编排/辅助）；当前命中 ${inOne} 类`);
  }
  // 三类合并必须覆盖全部命令
  const known = new Set([...HAS_DECISION_GATE, ...ORCHESTRATION_AGGREGATE, ...AUXILIARY]);
  for (const cmd of allCmds) {
    assert.ok(known.has(cmd), `${cmd} 未在分类中；新增命令需同步更新此测试`);
  }
  assert.equal(allCmds.length, known.size,
    `commands/ 实际 ${allCmds.length} 个 vs 分类总数 ${known.size}（重复或遗漏）`);

  // 辅助命令禁止冒名顶替决策门契约 — 防止未来误加 emit-decision 调用
  for (const cmd of AUXILIARY) {
    const text = readFileSync(join(ROOT, 'commands', `${cmd}.md`), 'utf8');
    assert.ok(!text.includes('## Phase 决策门 — M6.2'),
      `辅助命令 ${cmd}.md 不应有决策门段落（如需用户确认，请改归"决策门"分类）`);
  }
});

test('kickoff.md 默认 interactive + 支持 --auto 跳过', () => {
  const text = readFileSync(join(ROOT, 'commands', 'kickoff.md'), 'utf8');
  assert.ok(text.includes('M6.2 执行模式'),
    'kickoff.md 必须有 M6.2 执行模式段');
  assert.ok(text.includes('--auto'),
    'kickoff.md 必须支持 --auto');
  assert.ok(text.includes('interactive'),
    'kickoff.md 必须说明默认 interactive');
  assert.ok(text.includes('未传 --auto 时'),
    'kickoff.md 必须明确未传 --auto 时的行为');
});

test('preview.mjs 支持 9 个 phase + all', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'ddt-preview-'));
  try {
    // 准备一些假产物
    mkdirSync(join(tmp, 'docs'), { recursive: true });
    writeFileSync(join(tmp, 'docs/prd.md'), '# PRD\n## F1\n### F1.1\nGiven foo\nWhen bar\nThen baz\n');
    writeFileSync(join(tmp, 'docs/api-contract.yaml'),
      'openapi: 3.0.3\nsecurity: []\npaths:\n  /tasks:\n    get:\n      summary: list\n');

    for (const phase of ['prd', 'design', 'all']) {
      const r = spawnSync(process.execPath,
        [join(ROOT, 'bin/preview.mjs'), phase],
        { cwd: tmp, encoding: 'utf8' });
      assert.equal(r.status, 0, `preview ${phase} failed: ${r.stderr}`);
      assert.ok(r.stdout.includes('==='),
        `preview ${phase} 应输出标题`);
    }

    // prd 输出应含用户故事 / AC 数
    const r = spawnSync(process.execPath,
      [join(ROOT, 'bin/preview.mjs'), 'prd'],
      { cwd: tmp, encoding: 'utf8' });
    assert.ok(r.stdout.includes('用户故事'));
    assert.ok(r.stdout.includes('Given/When/Then'));
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('preview 拒绝无效 phase', () => {
  const r = spawnSync(process.execPath,
    [join(ROOT, 'bin/preview.mjs'), 'invalid-phase'],
    { encoding: 'utf8' });
  assert.equal(r.status, 1);
});

test('manifest 接受 preview 命令', () => {
  const r = spawnSync(process.execPath,
    [join(ROOT, 'bin/manifest.mjs'), '--check'],
    { encoding: 'utf8', cwd: ROOT });
  assert.equal(r.status, 0, `manifest --check failed: ${r.stderr}`);
});
