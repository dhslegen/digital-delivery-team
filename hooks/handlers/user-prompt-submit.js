#!/usr/bin/env node
// M1-5: UserPromptSubmit handler — 抓取 slash command 作为 phase 标签，
//       为效率报告提供精确阶段维度。
'use strict';
const {
  appendEvent,
  hookResult,
  markPhaseStarted,
  parseHookInput,
  resolveCwd,
  resolveProjectId,
  resolveSessionId,
  runCli,
} = require('./lib/events');

// DDT 自身的阶段命令（含编排命令 kickoff/impl/verify/ship/report）
const DDT_PHASE_COMMANDS = [
  'kickoff',
  'prd',
  'wbs',
  'design',
  'impl',
  'build-web',
  'build-api',
  'verify',
  'test',
  'review',
  'fix',
  'ship',
  'package',
  'report',
];

// M4-2: phase command → progress.json phase key 映射
// 编排命令（kickoff/impl/verify/ship）不直接对应 progress phase，由 Stop hook 的 infer 推断
const ORCHESTRATOR_COMMANDS = new Set(['kickoff', 'impl', 'verify', 'ship']);
function mapToProgressPhase(cmd) {
  if (ORCHESTRATOR_COMMANDS.has(cmd)) return null;
  return cmd;
}

const PHASE_PATTERN = new RegExp(
  String.raw`^\s*/(?:digital-delivery-team:)?(${DDT_PHASE_COMMANDS.join('|')})\b(.*)$`,
  'i'
);

function detectPhase(prompt) {
  if (!prompt || typeof prompt !== 'string') return null;
  const m = prompt.match(PHASE_PATTERN);
  if (!m) return null;
  return {
    phase: m[1].toLowerCase(),
    args: (m[2] || '').trim(),
  };
}

function run(raw) {
  try {
    const input = parseHookInput(raw);
    const cwd = resolveCwd(input);
    const projectId = resolveProjectId(cwd);
    const sessionId = resolveSessionId(input);
    const prompt = input.prompt || input.user_prompt || input.message || '';

    const detected = detectPhase(prompt);
    if (detected) {
      appendEvent('phase_start', projectId, {
        session_id: sessionId,
        phase: detected.phase,
        args: detected.args.slice(0, 200),
      });
      // M4-2: 同步更新 progress.json（仅非编排命令）
      const progressPhase = mapToProgressPhase(detected.phase);
      if (progressPhase) {
        markPhaseStarted(cwd, progressPhase);
      }
    }
  } catch (error) {
    return hookResult(raw, `[delivery-hook] user-prompt-submit error: ${error.message}\n`);
  }
  return hookResult(raw);
}

if (require.main === module) {
  runCli(run);
}

module.exports = { run, detectPhase, mapToProgressPhase, DDT_PHASE_COMMANDS };
