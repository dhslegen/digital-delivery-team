-- digital-delivery-team 度量数据库 DDL（严格照父设计文档 §6.2）

CREATE TABLE IF NOT EXISTS projects (
  project_id   TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  baseline_json TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  session_id   TEXT PRIMARY KEY,
  project_id   TEXT,
  started_at   TEXT,
  ended_at     TEXT,
  duration_ms  INTEGER,
  total_input_tokens  INTEGER,
  total_output_tokens INTEGER
);

CREATE TABLE IF NOT EXISTS tool_calls (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id    TEXT,
  project_id    TEXT,
  tool_name     TEXT,
  started_at    TEXT,
  ended_at      TEXT,
  duration_ms   INTEGER,
  success       INTEGER,
  file_path     TEXT,
  bash_head     TEXT
);

CREATE TABLE IF NOT EXISTS subagent_runs (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id     TEXT,
  project_id     TEXT,
  subagent_name  TEXT,
  started_at     TEXT,
  ended_at       TEXT,
  duration_ms    INTEGER,
  input_tokens   INTEGER,
  output_tokens  INTEGER,
  success        INTEGER
);

-- M1-6: phase_runs 表，记录精确的 slash command 阶段工时
CREATE TABLE IF NOT EXISTS phase_runs (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id     TEXT,
  project_id     TEXT,
  phase          TEXT NOT NULL,
  args           TEXT,
  started_at     TEXT NOT NULL,
  ended_at       TEXT,
  duration_ms    INTEGER
);
CREATE INDEX IF NOT EXISTS idx_phase_runs_project ON phase_runs(project_id);
CREATE INDEX IF NOT EXISTS idx_phase_runs_session_phase ON phase_runs(session_id, phase);

-- v0.4.0: quality_metrics 表重新设计，按 source 分行存储测试与审查指标
CREATE TABLE IF NOT EXISTS quality_metrics (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id       TEXT NOT NULL,
  session_id       TEXT,
  stage            TEXT NOT NULL,
  source           TEXT NOT NULL,
  coverage_pct     REAL,
  tests_total      INTEGER,
  tests_passed     INTEGER,
  tests_failed     INTEGER,
  defects_critical INTEGER,
  defects_major    INTEGER,
  defects_minor    INTEGER,
  rework_count     INTEGER,
  acceptance_pass_pct REAL,
  blocker_count    INTEGER,
  warning_count    INTEGER,
  suggestion_count INTEGER,
  created_at       TEXT NOT NULL,
  UNIQUE(project_id, source, created_at)
);

CREATE INDEX IF NOT EXISTS idx_tool_calls_project ON tool_calls(project_id);
CREATE INDEX IF NOT EXISTS idx_subagent_runs_project ON subagent_runs(project_id);
CREATE INDEX IF NOT EXISTS idx_qm_project_stage ON quality_metrics(project_id, stage);

-- M6.1: aggregate 增量 ingest 水位线（防 events.jsonl 反复全量 ingest 导致 phase_runs 行膨胀）
CREATE TABLE IF NOT EXISTS ingest_watermark (
  project_id TEXT PRIMARY KEY,
  last_ts    TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
