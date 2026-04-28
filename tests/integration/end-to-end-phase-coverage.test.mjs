// M1-9: 端到端模拟一个完整交付（/kickoff → /impl → /verify → /ship → /report）
//       通过 phase_start/phase_end 事件链路，验证 efficiency-report.raw.md
//       的阶段级对比表 6 个 phase 全部非空（这是 P0 核心验收）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');

function buildEvents() {
  const events = [];
  const ts = (mins) => new Date(Date.UTC(2026, 3, 25, 0, mins, 0)).toISOString();
  const sess = 'sess-e2e-001';
  const proj = 'proj-e2e-coverage';

  events.push({ event: 'session_start', project_id: proj, ts: ts(0),
    data: { session_id: sess, cwd: '/tmp/e2e' } });

  // 6 个 phase 各自跑：phase_start + phase_end
  const phases = [
    { name: 'prd',       start: 0,   end: 5  },
    { name: 'wbs',       start: 5,   end: 10 },
    { name: 'design',    start: 10,  end: 25 },
    { name: 'build-web', start: 25,  end: 80 },
    { name: 'build-api', start: 25,  end: 90 },
    { name: 'verify',    start: 90,  end: 130 },
    { name: 'package',   start: 130, end: 145 },
    { name: 'report',    start: 145, end: 152 },
  ];

  for (const p of phases) {
    events.push({ event: 'phase_start', project_id: proj, ts: ts(p.start),
      data: { session_id: sess, phase: p.name, args: '' } });
    events.push({ event: 'phase_end', project_id: proj, ts: ts(p.end),
      data: { session_id: sess, phase: p.name,
              duration_ms: (p.end - p.start) * 60 * 1000 } });
  }

  // 同时附带 quality_metrics（验证 report.mjs 不会因为质量缺失走 missing 分支）
  events.push({ event: 'quality_metrics', project_id: proj, ts: ts(120),
    source: 'tests/test-report.md', stage: 'verify',
    metrics: { coverage_pct: 92.5, tests_total: 30, tests_passed: 30, tests_failed: 0,
               acceptance_pass_pct: 100, defects_critical: 0, defects_major: 0,
               defects_minor: 0, rework_count: 0 } });
  events.push({ event: 'quality_metrics', project_id: proj, ts: ts(125),
    source: 'docs/review-report.md', stage: 'verify',
    metrics: { blocker_count: 0, warning_count: 2, suggestion_count: 5 } });

  events.push({ event: 'session_end', project_id: proj, ts: ts(155),
    data: { session_id: sess, tokens_input: 100000, tokens_output: 50000 } });

  return { events, projectId: proj };
}

test('完整六阶段链路：efficiency-report.raw.md 各 stage 有非空实际工时', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'ddt-e2e-'));
  try {
    const { events, projectId } = buildEvents();
    writeFileSync(join(tmp, 'events.jsonl'),
      events.map(e => JSON.stringify(e)).join('\n') + '\n');

    const env = { ...process.env, DDT_METRICS_DIR: tmp };

    // aggregate
    const agg = spawnSync(process.execPath,
      [join(ROOT, 'bin', 'aggregate.mjs'), '--project', projectId],
      { cwd: ROOT, env, encoding: 'utf8' });
    assert.equal(agg.status, 0, `aggregate failed: ${agg.stderr}`);

    // baseline lock（必须先 lock 才能跑 report）
    const baselineOut = join(tmp, 'baseline.locked.json');
    const base = spawnSync(process.execPath,
      [join(ROOT, 'bin', 'baseline.mjs'), '--out', baselineOut],
      { cwd: ROOT, env, encoding: 'utf8' });
    assert.equal(base.status, 0, `baseline failed: ${base.stderr}`);

    // report
    const reportOut = join(tmp, 'efficiency-report.raw.md');
    const rep = spawnSync(process.execPath,
      [join(ROOT, 'bin', 'report.mjs'),
       '--project', projectId,
       '--baseline', baselineOut,
       '--out', reportOut],
      { cwd: ROOT, env, encoding: 'utf8' });
    assert.equal(rep.status, 0, `report failed: ${rep.stderr}`);

    const raw = readFileSync(reportOut, 'utf8');

    // 关键断言：六个 stage 在阶段对比表里都不应该是 "—"
    //   表格行格式：`| <stage> | <base> | <act> | <delta> | <status> |`
    const stagesUnderTest = ['requirements', 'architecture', 'frontend', 'backend', 'testing', 'docs'];
    for (const stage of stagesUnderTest) {
      const re = new RegExp(`\\| ${stage} \\|[^|]+\\|\\s*([0-9.]+|—)\\s*\\|`);
      const m = raw.match(re);
      assert.ok(m, `阶段 ${stage} 未出现在报告中`);
      assert.notEqual(m[1], '—',
        `🔴 P0 回归：阶段 ${stage} 实际工时仍为 — (raw report 片段：${m[0]})`);
      const hours = Number(m[1]);
      assert.ok(Number.isFinite(hours) && hours > 0,
        `阶段 ${stage} 工时应 > 0，实测 ${m[1]}`);
    }

    // 第 4 节（阶段与编排原始工时）应输出表格，不应为 "_（暂无 phase 工时数据..."
    assert.ok(raw.includes('## 4. 阶段与编排原始工时'),
      'raw report 第 4 节缺失');
    assert.ok(!raw.includes('暂无 phase 工时数据'),
      'phase 工时数据不能为空');
    // 至少看到 prd / build-web / build-api / verify 出现
    for (const phase of ['prd', 'build-web', 'build-api', 'verify']) {
      assert.ok(raw.includes(`| ${phase} |`),
        `phase ${phase} 必须出现在原始工时表`);
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
