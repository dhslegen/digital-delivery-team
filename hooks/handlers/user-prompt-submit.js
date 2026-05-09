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
  'design-brief',     // W3 (v0.8): brief 编译器
  'design-execute',   // W3 (v0.8): 通道执行器
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

// D34 (v0.9.18)：撤销 PR-B P0-3 单源限制——hook 与 emit-phase **双源写入**，aggregate.mjs ingest 时去重。
//   背景：commands/X.md::Phase 1 把 emit-phase 跟前置检查写在同一 bash 块里，依赖 main thread 字面执行；
//   实战发现 Claude 会改写 bash（"友好版"，砍掉 emit-phase 行），导致 phase 事件永久丢失。
//   双源策略：UserPromptSubmit hook 在命令输入瞬间写 source="hook" 兜底；emit-phase 跑成功时写 source="emit-phase"。
//   去重在 store.mjs 端：emit-phase 后到优先（精确 ts），删除 hook 行；hook 先到则保留作兜底。
function shouldEmitPhaseEvent(_cmd) {
  return true; // 所有 phase 命令（业务级 + 编排级）均由 hook 兜底
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
      // PR-B：仅编排级（kickoff/impl/verify/ship）由 hook 抓 phase_start；
      //   业务级（prd/wbs/design/...）由 commands/X.md 内 emit-phase 唯一发起，避免双源叠加。
      if (shouldEmitPhaseEvent(detected.phase)) {
        appendEvent('phase_start', projectId, {
          session_id: sessionId,
          phase: detected.phase,
          args: detected.args.slice(0, 200),
          source: 'hook',
        });
      }
      // M4-2: 同步更新 progress.json（仅非编排命令；与 phase 事件无关，保留原逻辑）
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
