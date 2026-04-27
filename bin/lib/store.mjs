// T-M01: DeliveryStore — SQLite 封装；Node 22+ 使用内置 node:sqlite，保持零 npm 依赖。
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openSqliteDatabase } from './sqlite-driver.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

export class DeliveryStore {
  constructor(dbPath) {
    this._path = dbPath;
    this._db = null;
  }

  async openOrCreate() {
    this._db = await openSqliteDatabase(this._path);
    this._migrateQualityMetrics();
    const schema = readFileSync(join(__dirname, 'schema.sql'), 'utf8');
    this._db.exec(schema);
  }

  close() {
    if (this._db && typeof this._db.close === 'function') {
      this._db.close();
    }
  }

  _migrateQualityMetrics() {
    try {
      const cols = this._db.prepare('PRAGMA table_info(quality_metrics)').all();
      if (!cols.length) return;
      const existing = new Set(cols.map(c => c.name));
      const additions = {
        session_id: 'TEXT',
        stage: 'TEXT',
        source: 'TEXT',
        coverage_pct: 'REAL',
        tests_total: 'INTEGER',
        tests_passed: 'INTEGER',
        tests_failed: 'INTEGER',
        defects_critical: 'INTEGER',
        defects_major: 'INTEGER',
        defects_minor: 'INTEGER',
        rework_count: 'INTEGER',
        acceptance_pass_pct: 'REAL',
        blocker_count: 'INTEGER',
        warning_count: 'INTEGER',
        suggestion_count: 'INTEGER',
        created_at: 'TEXT',
      };
      for (const [column, type] of Object.entries(additions)) {
        if (!existing.has(column)) {
          this._db.exec(`ALTER TABLE quality_metrics ADD COLUMN ${column} ${type};`);
        }
      }
      if (existing.has('captured_at') && !existing.has('created_at')) {
        this._db.exec('UPDATE quality_metrics SET created_at = captured_at WHERE created_at IS NULL;');
      }
    } catch (_) { /* 表不存在时正常忽略 */ }
  }

  createProject(id, name) {
    this._db.prepare(
      'INSERT OR IGNORE INTO projects(project_id, name, created_at) VALUES(?, ?, ?)'
    ).run(id, name, new Date().toISOString());
  }

  ingestEvent(ev) {
    const d = ev.data || {};
    const ts = ev.ts || new Date().toISOString();
    const pid = ev.project_id || 'unknown';
    const sessionId = ev.session_id || d.session_id || 'unknown';

    switch (ev.event || ev.type) {
      case 'session_start':
        this._db.prepare(
          'INSERT OR IGNORE INTO sessions(session_id, project_id, started_at) VALUES(?, ?, ?)'
        ).run(sessionId, pid, ts);
        break;

      case 'session_end':
        this._db.prepare(
          'UPDATE sessions SET ended_at=?, total_input_tokens=?, total_output_tokens=? WHERE session_id=?'
        ).run(ts, d.tokens_input || 0, d.tokens_output || 0, sessionId);
        break;

      case 'pre_tool_use':
        this._db.prepare(
          'INSERT INTO tool_calls(session_id, project_id, tool_name, started_at, file_path, bash_head) VALUES(?, ?, ?, ?, ?, ?)'
        ).run(sessionId, pid, d.tool_name || '', ts, d.file_path || '', d.bash_head || '');
        break;

      case 'post_tool_use':
        // 更新同项目同工具最近一条未关闭的记录
        this._db.prepare(
          'UPDATE tool_calls SET ended_at=?, duration_ms=?, success=? WHERE id=(SELECT MAX(id) FROM tool_calls WHERE project_id=? AND session_id=? AND tool_name=? AND ended_at IS NULL)'
        ).run(ts, toNullableNumber(d.duration_ms), d.success ? 1 : 0, pid, sessionId, d.tool_name || '');
        break;

      case 'subagent_stop':
        this._db.prepare(
          'INSERT INTO subagent_runs(session_id, project_id, subagent_name, ended_at, duration_ms, input_tokens, output_tokens, success) VALUES(?, ?, ?, ?, ?, ?, ?, ?)'
        ).run(sessionId, pid, d.subagent_name || 'unknown', ts,
          d.duration_ms || 0, d.tokens_input || 0, d.tokens_output || 0, d.success === false ? 0 : 1);
        break;

      case 'quality_metrics': {
        const source    = ev.source    || d.source    || 'unknown';
        const stage     = ev.stage     || d.stage     || 'verify';
        const metrics   = ev.metrics   || d;
        this._upsertQualityRow(pid, sessionId, stage, source, metrics, ts);
        break;
      }
    }
  }

  // --capture-quality 直接调用路径，使用 source='manual-capture'
  recordQualityMetrics(projectId, metrics, capturedAt = new Date().toISOString()) {
    this._upsertQualityRow(projectId, null, 'verify', 'manual-capture', metrics, capturedAt);
  }

  _upsertQualityRow(projectId, sessionId, stage, source, metrics, createdAt) {
    this._db.prepare(
      `INSERT OR IGNORE INTO quality_metrics(
        project_id, session_id, stage, source,
        coverage_pct, tests_total, tests_passed, tests_failed,
        defects_critical, defects_major, defects_minor, rework_count, acceptance_pass_pct,
        blocker_count, warning_count, suggestion_count, created_at
      ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      projectId,
      sessionId || null,
      stage     || 'verify',
      source    || 'unknown',
      toNullableNumber(metrics.coverage_pct),
      toNullableNumber(metrics.tests_total),
      toNullableNumber(metrics.tests_passed),
      toNullableNumber(metrics.tests_failed),
      toNullableNumber(metrics.defects_critical),
      toNullableNumber(metrics.defects_major),
      toNullableNumber(metrics.defects_minor),
      toNullableNumber(metrics.rework_count),
      toNullableNumber(metrics.acceptance_pass_pct),
      toNullableNumber(metrics.blocker_count),
      toNullableNumber(metrics.warning_count),
      toNullableNumber(metrics.suggestion_count),
      createdAt || new Date().toISOString()
    );
  }

  aggregateStageHours(projectId) {
    const rows = this._db.prepare(
      'SELECT subagent_name, SUM(duration_ms) AS total_ms FROM subagent_runs WHERE project_id=? GROUP BY subagent_name'
    ).all(projectId);
    const result = {};
    for (const row of rows) {
      result[row.subagent_name] = (row.total_ms || 0) / 3_600_000;
    }
    return result;
  }

  latestQuality(projectId) {
    return this._db.prepare(
      'SELECT * FROM quality_metrics WHERE project_id=? ORDER BY created_at DESC LIMIT 1'
    ).get(projectId) || null;
  }

  qualitySnapshot(projectId) {
    const testRow = this._db.prepare(
      `SELECT * FROM quality_metrics
       WHERE project_id=?
         AND (
           coverage_pct IS NOT NULL OR tests_total IS NOT NULL OR tests_passed IS NOT NULL OR tests_failed IS NOT NULL
           OR defects_critical IS NOT NULL OR defects_major IS NOT NULL OR defects_minor IS NOT NULL
           OR rework_count IS NOT NULL OR acceptance_pass_pct IS NOT NULL
         )
       ORDER BY created_at DESC LIMIT 1`
    ).get(projectId) || null;
    const reviewRow = this._db.prepare(
      `SELECT * FROM quality_metrics
       WHERE project_id=?
         AND (blocker_count IS NOT NULL OR warning_count IS NOT NULL OR suggestion_count IS NOT NULL)
       ORDER BY created_at DESC LIMIT 1`
    ).get(projectId) || null;
    return { testRow, reviewRow };
  }
}

function toNullableNumber(value) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
