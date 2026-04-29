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
// H1: POSIX O_APPEND 在小于 PIPE_BUF（macOS=512B / Linux=4096B）时保证原子写入；
//      超过阈值则用 advisory lock 文件抢锁后追加，防止多 hook 并发交错。
//      阈值取 512B 以兼容最严苛平台（macOS）。
const ATOMIC_WRITE_THRESHOLD = 512;
const LOCK_RETRY_INTERVAL_MS = 5;
const LOCK_MAX_WAIT_MS = 1000;

function appendWithLock(eventsFile, line) {
  const lockFile = eventsFile + '.lock';
  const start = Date.now();
  let acquired = false;
  let fd = null;
  while (!acquired) {
    try {
      fd = fs.openSync(lockFile, 'wx'); // O_EXCL：原子创建，已存在则抛错
      acquired = true;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      // 其他进程持有锁；检测 stale lock（>3s 未释放视为死锁）
      try {
        const stat = fs.statSync(lockFile);
        if (Date.now() - stat.mtimeMs > 3000) {
          try { fs.unlinkSync(lockFile); } catch (_) { /* race condition：被别人删了 */ }
          continue;
        }
      } catch (_) { /* 锁文件可能刚被删除 */ }
      if (Date.now() - start > LOCK_MAX_WAIT_MS) {
        // 超时不阻塞 hook，降级为非锁定写入（极少数情况下可能交错，但不丢数据）
        fs.appendFileSync(eventsFile, line, 'utf8');
        return;
      }
      // 短暂自旋等待
      const deadline = Date.now() + LOCK_RETRY_INTERVAL_MS;
      while (Date.now() < deadline) { /* busy wait — 5ms 内可接受 */ }
    }
  }
  try {
    fs.appendFileSync(eventsFile, line, 'utf8');
  } finally {
    if (fd !== null) {
      try { fs.closeSync(fd); } catch (_) {}
    }
    try { fs.unlinkSync(lockFile); } catch (_) {}
  }
}

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
    const line = JSON.stringify(record) + '\n';
    if (Buffer.byteLength(line, 'utf8') <= ATOMIC_WRITE_THRESHOLD) {
      // 小事件：依靠 POSIX O_APPEND 原子性
      fs.appendFileSync(eventsFile, line, 'utf8');
    } else {
      // 大事件：advisory lock 抢锁后追加
      appendWithLock(eventsFile, line);
    }
  } catch (err) {
    // 写入失败不得阻塞工具执行，仅记录到 stderr
    process.stderr.write(`[delivery-hook] appendEvent failed: ${err.message}\n`);
  }
}

/**
 * 从环境变量或项目本地文件读取 project_id。
 * 优先级：DDT_PROJECT_ID > DDT_PROJECT_ID > .ddt/project-id 文件
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
  const localFile = path.join(cwd || process.cwd(), '.ddt', 'project-id');
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

/**
 * M1-4: 在最近 N 条事件中反向查找匹配项（用于 SubagentStop 关联 subagent_start，
 * 以及 Stop hook 关联 phase_start 等场景）。
 *
 * @param {(ev:object)=>boolean} predicate 命中条件
 * @param {object} options
 *   - limit: 扫描最近多少条（默认 500，足够覆盖单次会话内的子代理）
 * @returns {object|null}
 */
function findRecentEvent(predicate, options = {}) {
  const events = readRecentEvents(options.limit || 500);
  for (let i = events.length - 1; i >= 0; i--) {
    if (predicate(events[i])) return events[i];
  }
  return null;
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
 * T-R04 / H1: 写一条 quality_metrics 事件（含完整 metrics 对象，常 > 512B，必须走 lock 路径）
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
    const line = JSON.stringify(record) + '\n';
    const eventsFile = getEventsFile();
    if (Buffer.byteLength(line, 'utf8') <= ATOMIC_WRITE_THRESHOLD) {
      fs.appendFileSync(eventsFile, line, 'utf8');
    } else {
      appendWithLock(eventsFile, line);
    }
  } catch (err) {
    process.stderr.write(`[delivery-hook] appendQualityEvent failed: ${err.message}\n`);
  }
}

// M4-2: progress.json 状态机维护（轻量版，避免 spawn 子进程）
function readProgress(cwd) {
  try {
    const p = path.join(cwd, '.ddt', 'progress.json');
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch { return null; }
}

function writeProgress(cwd, progress) {
  try {
    const dir = path.join(cwd, '.ddt');
    fs.mkdirSync(dir, { recursive: true });
    progress.last_activity_at = new Date().toISOString();
    fs.writeFileSync(path.join(dir, 'progress.json'),
      JSON.stringify(progress, null, 2) + '\n', 'utf8');
  } catch { /* hook 必须容错，不阻塞 */ }
}

function markPhaseStarted(cwd, phase) {
  const progress = readProgress(cwd);
  if (!progress || !progress.phases || !progress.phases[phase]) return;
  const ph = progress.phases[phase];
  if (ph.status === 'completed') return; // 已完成的不回退（可重入：再次跑视为增量补充）
  if (ph.status !== 'in_progress') {
    ph.status = 'in_progress';
    ph.started_at = ph.started_at || new Date().toISOString();
    progress.current_phase = phase;
    writeProgress(cwd, progress);
  }
}

function markPhaseCompleted(cwd, phase) {
  const progress = readProgress(cwd);
  if (!progress || !progress.phases || !progress.phases[phase]) return;
  const ph = progress.phases[phase];
  if (ph.status === 'completed') return;
  ph.status = 'completed';
  ph.completed_at = new Date().toISOString();
  // 推进到下一个非 completed phase
  const phaseOrder = Object.keys(progress.phases);
  if (progress.current_phase === phase) {
    progress.current_phase = phaseOrder.find(p =>
      progress.phases[p].status !== 'completed' && p !== phase) || null;
  }
  writeProgress(cwd, progress);
}

module.exports = {
  ATOMIC_WRITE_THRESHOLD,
  appendEvent,
  appendQualityEvent,
  appendWithLock,
  extractUsage,
  findRecentEvent,
  getEventsFile,
  getMetricsDir,
  hookResult,
  markPhaseCompleted,
  markPhaseStarted,
  numberFrom,
  parseHookInput,
  readProgress,
  readRecentEvents,
  readStdinRaw,
  resolveCwd,
  resolveProjectId,
  resolveSessionId,
  runCli,
};
