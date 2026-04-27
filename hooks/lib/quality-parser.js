'use strict';
// T-R04: 从 test-report.md / review-report.md 提取质量指标，供 post-tool-use hook 使用

function parseTestReport(text) {
  if (!text || !text.trim()) return null;
  const coverage = extractPercent(text, /(?:Coverage|覆盖率|分支覆盖率|代码分支覆盖率)\s*[:：]\s*(\d+(?:\.\d+)?)\s*%/i) ??
    extractPercent(text, /(\d+(?:\.\d+)?)\s*%\s*(?:Coverage|覆盖率)/i);
  const total = extractInt(text, /(?:Total|total|测试总数|总数)\s*[:：]\s*(\d+)/i);
  const passed = extractInt(text, /(?:Passed|passed|通过)\s*[:：]\s*(\d+)/i);
  const failed = extractInt(text, /(?:Failed|failed|失败)\s*[:：]\s*(\d+)/i);
  const acceptance = extractAcceptancePassPct(text);
  const defectsCritical = extractInt(text, /critical\s*[:：]\s*(\d+)\s*(?:条|个)?/i);
  const defectsMajor = extractInt(text, /major\s*[:：]\s*(\d+)\s*(?:条|个)?/i);
  const defectsMinor = extractInt(text, /minor\s*[:：]\s*(\d+)\s*(?:条|个)?/i);
  const rework = extractInt(text, /(?:rework_count|rework|返工次数|返工)\s*[:：]\s*(\d+)/i);

  const metrics = {
    coverage_pct: coverage,
    tests_total: total,
    tests_passed: passed,
    tests_failed: failed,
    defects_critical: defectsCritical,
    defects_major: defectsMajor,
    defects_minor: defectsMinor,
    rework_count: rework,
    acceptance_pass_pct: acceptance,
  };
  return hasKnownValue(metrics) ? metrics : null;
}

/**
 * 解析代码审查报告。
 * 优先使用显式汇总（DDT canonical 表格或 "阻塞: 1"），避免汇总 + 详情双重计数。
 * 无显式汇总时，回退统计 [Blocker] / [Warning] / [Suggestion]（含中文别名）行数。
 */
function parseReviewReport(text) {
  if (!text || !text.trim()) return null;

  const tableSummary = extractReviewSummaryTable(text);
  if (tableSummary) return tableSummary;

  const explicitSummary = extractReviewColonSummary(text);
  if (explicitSummary) return explicitSummary;

  let blockers = 0;
  let warnings = 0;
  let suggestions = 0;
  for (const line of text.split(/\r?\n/)) {
    if (/\[Blocker\]|【阻塞】/i.test(line)) blockers++;
    else if (/\[Warning\]|【警告】/i.test(line)) warnings++;
    else if (/\[Suggestion\]|【建议】/i.test(line)) suggestions++;
  }
  if (!blockers && !warnings && !suggestions) return null;
  return { blocker_count: blockers, warning_count: warnings, suggestion_count: suggestions };
}

function extractReviewSummaryTable(text) {
  const summary = { blocker_count: null, warning_count: null, suggestion_count: null };

  for (const line of text.split(/\r?\n/)) {
    if (!/^\s*\|.*\|\s*$/.test(line)) continue;
    if (/^\s*\|\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|\s*$/.test(line)) continue;

    const cells = line.slice(line.indexOf('|') + 1, line.lastIndexOf('|'))
      .split('|')
      .map(cell => cell.trim())
      .filter(Boolean);
    if (cells.length < 2) continue;

    const level = cells[0].toLowerCase();
    const count = firstInteger(cells.slice(1));
    if (count === null) continue;

    if (/must-fix|blockers?|阻塞/.test(level)) {
      summary.blocker_count = count;
    } else if (/should-fix|warnings?|警告/.test(level)) {
      summary.warning_count = count;
    } else if (/nice-to-have|suggestions?|建议/.test(level)) {
      summary.suggestion_count = count;
    }
  }

  if (!hasKnownValue(summary)) return null;
  return {
    blocker_count: summary.blocker_count ?? 0,
    warning_count: summary.warning_count ?? 0,
    suggestion_count: summary.suggestion_count ?? 0,
  };
}

function extractReviewColonSummary(text) {
  const summary = {
    blocker_count: extractInt(text, /(?:阻塞|blocker_count|blockers?)\s*[:：]\s*(\d+)\s*(?:条|个)?/i),
    warning_count: extractInt(text, /(?:警告|warning_count|warnings?)\s*[:：]\s*(\d+)\s*(?:条|个)?/i),
    suggestion_count: extractInt(text, /(?:建议|suggestion_count|suggestions?)\s*[:：]\s*(\d+)\s*(?:条|个)?/i),
  };

  if (!hasKnownValue(summary)) return null;
  return {
    blocker_count: summary.blocker_count ?? 0,
    warning_count: summary.warning_count ?? 0,
    suggestion_count: summary.suggestion_count ?? 0,
  };
}

function extractAcceptancePassPct(text) {
  const explicit = extractPercent(text, /(?:acceptance_pass_pct|验收通过率)\s*[:：]\s*(\d+(?:\.\d+)?)\s*%/i);
  if (explicit !== null) return explicit;

  const ratio = text.match(/(?:验收标准覆盖|验收覆盖|acceptance)\s*[:：]\s*(\d+)\s*\/\s*(\d+)/i);
  if (!ratio) return null;
  const passed = parseInt(ratio[1], 10);
  const total = parseInt(ratio[2], 10);
  if (!Number.isFinite(passed) || !Number.isFinite(total) || total <= 0) return null;
  return +(passed / total * 100).toFixed(1);
}

function extractPercent(text, re) {
  const m = text.match(re);
  if (!m) return null;
  const n = parseFloat(m[1]);
  return Number.isFinite(n) ? n : null;
}

function extractInt(text, re) {
  const m = text.match(re);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) ? n : null;
}

function firstInteger(values) {
  for (const value of values) {
    const m = String(value).match(/\b(\d+)\b/);
    if (!m) continue;
    const n = parseInt(m[1], 10);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function hasKnownValue(metrics) {
  return Object.values(metrics).some(value => value !== null && value !== undefined);
}

module.exports = { parseTestReport, parseReviewReport };
