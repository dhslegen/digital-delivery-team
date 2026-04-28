#!/usr/bin/env node
// T-H05: PostToolUse handler — 记录工具调用后结果，捕获 success/output_size
// T-R04: 检测 test-report.md / review-report.md 写入后额外发送 quality_metrics 事件
'use strict';
const path = require('path');
const fs   = require('fs');
const {
  appendEvent,
  appendQualityEvent,
  hookResult,
  numberFrom,
  parseHookInput,
  resolveCwd,
  resolveProjectId,
  resolveSessionId,
  runCli,
} = require('./lib/events');
const { parseTestReport, parseReviewReport } = require('../lib/quality-parser');

function outputSize(input) {
  const output = input.tool_output?.output ??
    input.tool_output?.stdout ??
    input.output ??
    input.stdout ??
    '';
  return typeof output === 'string' ? output.length : JSON.stringify(output || '').length;
}

function isSuccess(input) {
  const eventName = input.hook_event_name || process.env.CLAUDE_HOOK_EVENT_NAME || '';
  if (String(eventName).toLowerCase().includes('failure')) {
    return false;
  }
  return input.error == null &&
    input.tool_error == null &&
    input.tool_output?.error == null &&
    input.is_error !== true &&
    input.success !== false;
}

function run(raw) {
  try {
    const input = parseHookInput(raw);
    const cwd = resolveCwd(input);
    const projectId = resolveProjectId(cwd);
    const toolInput = input.tool_input || input.input || {};
    appendEvent('post_tool_use', projectId, {
      session_id: resolveSessionId(input),
      tool_name: input.tool_name || input.toolName || input.name || '',
      file_path: toolInput.file_path || toolInput.path || '',
      success: isSuccess(input),
      duration_ms: numberFrom(input.duration_ms, input.elapsed_ms, input.tool_output?.duration_ms),
      output_size: outputSize(input)
    });
    captureQualityIfNeeded(input, cwd, projectId);
  } catch (error) {
    return hookResult(raw, `[delivery-hook] post-tool-use error: ${error.message}\n`);
  }
  return hookResult(raw);
}

// T-R04 / M2-4: 旁路观测 — 检测报告文件写入并提取质量指标
//   兼容绝对/相对/符号链接路径，统一通过 normalize + endsWith 比对
function captureQualityIfNeeded(input, cwd, projectId) {
  try {
    const toolName = input.tool_name || input.toolName || input.name || '';
    if (!['Write', 'Edit', 'MultiEdit'].includes(toolName)) return;
    const toolInput = input.tool_input || input.input || {};
    const filePath = toolInput.file_path || toolInput.path || '';
    if (!filePath) return;

    let realPath = filePath;
    try {
      realPath = fs.realpathSync(path.resolve(cwd, filePath));
    } catch (_) {
      realPath = path.resolve(cwd, filePath);
    }
    const normalized = realPath.split(path.sep).join('/');
    const sessionId = resolveSessionId(input);

    const isTestReport = normalized.endsWith('/tests/test-report.md');
    const isReviewReport = normalized.endsWith('/docs/review-report.md');
    if (!isTestReport && !isReviewReport) return;

    let content = '';
    try {
      content = fs.readFileSync(realPath, 'utf8');
    } catch (_) {
      return;
    }

    if (isTestReport) {
      const m = parseTestReport(content);
      if (m) appendQualityEvent(projectId, sessionId, 'tests/test-report.md', 'verify', m);
    } else if (isReviewReport) {
      const m = parseReviewReport(content);
      if (m) appendQualityEvent(projectId, sessionId, 'docs/review-report.md', 'verify', m);
    }
  } catch (_) {}
}

if (require.main === module) {
  runCli(run);
}

module.exports = { run };
