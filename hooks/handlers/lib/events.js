'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const MAX_STDIN = 1024 * 1024;

function getMetricsDir() {
  return process.env.DDT_METRICS_DIR ||
    process.env.DDT_METRICS_DIR ||
    path.join(os.homedir(), '.claude', 'delivery-metrics');
}

function getEventsFile() {
  return path.join(getMetricsDir(), 'events.jsonl');
}

function ensureDir() {
  const metricsDir = getMetricsDir();
  if (!fs.existsSync(metricsDir)) {
    fs.mkdirSync(metricsDir, { recursive: true });
  }
  return metricsDir;
}

/**
 * 同步追加一条事件到 events.jsonl。
 * 使用同步写入：hooks 在阻塞路径上，进程可能在 async 完成前退出。
 *
 * @param {string} eventName  事件类型（session_start/session_end/tool_use/subagent_stop）
 * @param {string} projectId  项目 ID
 * @param {object} data       附加数据（工具名、文件路径、耗时等）
 */
function appendEvent(eventName, projectId, data) {
  try {
    ensureDir();
    const eventsFile = getEventsFile();
    const record = {
      ts: new Date().toISOString(),
      event: eventName,
      project_id: projectId || 'unknown',
      data: data || {}
    };
    fs.appendFileSync(eventsFile, JSON.stringify(record) + '\n', 'utf8');
  } catch (err) {
    // 写入失败不得阻塞工具执行，仅记录到 stderr
    process.stderr.write(`[delivery-hook] appendEvent failed: ${err.message}\n`);
  }
}

/**
 * 从环境变量或项目本地文件读取 project_id。
 * 优先级：DDT_PROJECT_ID > DDT_PROJECT_ID > .delivery/project-id 文件
 *
 * @param {string} cwd 当前工作目录（默认 process.cwd()）
 * @returns {string}
 */
function resolveProjectId(cwd) {
  if (process.env.DDT_PROJECT_ID) {
    return process.env.DDT_PROJECT_ID;
  }
  if (process.env.DDT_PROJECT_ID) {
    return process.env.DDT_PROJECT_ID;
  }
  const localFile = path.join(cwd || process.cwd(), '.delivery', 'project-id');
  try {
    return fs.readFileSync(localFile, 'utf8').trim();
  } catch {
    return 'unknown';
  }
}

/**
 * 读取最近 N 条事件（避免全量加载大文件）。
 *
 * @param {number} limit 最多返回条数（默认 200）
 * @returns {object[]}
 */
function readRecentEvents(limit) {
  const n = limit || 200;
  try {
    const eventsFile = getEventsFile();
    if (!fs.existsSync(eventsFile)) return [];
    const content = fs.readFileSync(eventsFile, 'utf8');
    const lines = content.split('\n').filter(Boolean);
    return lines
      .slice(-n)
      .map(line => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch (err) {
    process.stderr.write(`[delivery-hook] readRecentEvents failed: ${err.message}\n`);
    return [];
  }
}

function readStdinRaw() {
  return new Promise(resolve => {
    let raw = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => {
      if (raw.length < MAX_STDIN) {
        raw += chunk.substring(0, MAX_STDIN - raw.length);
      }
    });
    process.stdin.on('end', () => resolve(raw));
    process.stdin.on('error', () => resolve(raw));
  });
}

function parseHookInput(raw) {
  try {
    return raw && raw.trim() ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function hookResult(raw, stderr) {
  return {
    stdout: raw,
    stderr: stderr || '',
    exitCode: 0,
  };
}

function numberFrom(...values) {
  for (const value of values) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      return numeric;
    }
  }
  return 0;
}

function resolveCwd(input) {
  return input.cwd ||
    input.project_dir ||
    input.workspace_dir ||
    process.env.CLAUDE_PROJECT_DIR ||
    process.cwd();
}

function resolveSessionId(input) {
  return input.session_id ||
    input.sessionId ||
    input.conversation_id ||
    process.env.CLAUDE_SESSION_ID ||
    'unknown';
}

function extractUsage(input) {
  const usage = input.usage ||
    input.total_usage ||
    input.tool_output?.usage ||
    input.message?.usage ||
    {};

  const inputTokens = numberFrom(
    usage.input_tokens,
    usage.inputTokens,
    input.input_tokens,
    input.total_input_tokens
  );
  const outputTokens = numberFrom(
    usage.output_tokens,
    usage.outputTokens,
    input.output_tokens,
    input.total_output_tokens
  );
  const totalTokens = numberFrom(
    usage.total_tokens,
    usage.totalTokens,
    input.total_tokens,
    inputTokens + outputTokens
  );

  return {
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    total_tokens: totalTokens,
  };
}

function runCli(run) {
  readStdinRaw().then(raw => {
    const result = run(raw);
    if (result.stderr) {
      process.stderr.write(result.stderr.endsWith('\n') ? result.stderr : `${result.stderr}\n`);
    }
    process.stdout.write(
      Object.prototype.hasOwnProperty.call(result, 'stdout') ? String(result.stdout ?? '') : raw
    );
    process.exitCode = Number.isInteger(result.exitCode) ? result.exitCode : 0;
  }).catch(error => {
    process.stderr.write(`[delivery-hook] cli error: ${error.message}\n`);
    process.exitCode = 0;
  });
}

/**
 * T-R04: 写一条 quality_metrics 事件到 events.jsonl（spec 格式，使用 type 字段）。
 */
function appendQualityEvent(projectId, sessionId, source, stage, metrics) {
  try {
    ensureDir();
    const record = {
      ts: new Date().toISOString(),
      session_id: sessionId || 'unknown',
      project_id: projectId || 'unknown',
      type: 'quality_metrics',
      source,
      stage,
      metrics,
    };
    fs.appendFileSync(getEventsFile(), JSON.stringify(record) + '\n', 'utf8');
  } catch (err) {
    process.stderr.write(`[delivery-hook] appendQualityEvent failed: ${err.message}\n`);
  }
}

module.exports = {
  appendEvent,
  appendQualityEvent,
  extractUsage,
  getEventsFile,
  getMetricsDir,
  hookResult,
  numberFrom,
  parseHookInput,
  readRecentEvents,
  readStdinRaw,
  resolveCwd,
  resolveProjectId,
  resolveSessionId,
  runCli,
};
