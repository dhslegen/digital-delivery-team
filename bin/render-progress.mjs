#!/usr/bin/env node
// v0.9 A3：从 .ddt/progress.json 渲染 ASCII 进度条 + 当前 phase 高亮
//
// 用法：
//   node bin/render-progress.mjs                 # 默认读 .ddt/progress.json
//   node bin/render-progress.mjs --path <p>      # 自定义路径
//   node bin/render-progress.mjs --no-bar        # 仅文本，不渲染 ASCII bar
//
// 输出格式（示例，实战 spa 项目）：
//   阶段进度：
//   [████████████████░░░░░░░░░░░░░░░░░░░░░░░░] 4/12 (33%)
//    prd  wbs  design  brief  exec  build-w build-a  test  review  fix  pkg  rpt
//      ✅   ✅      ✅     ↓      ⏸       ⏸       ⏸    ⏸      ⏸    ⏸    ⏸    ⏸
//                            ↑
//                       当前: design-brief

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const PLUGIN_ROOT = resolve(dirname(__filename), '..');

// 状态对应的渲染字符
const STATUS_BAR_FILL = {
  completed:   '█',
  skipped:     '░',  // 与 completed 等价但视觉区分（spa 跳过等）
  in_progress: '▓',
  pending:     '░',
};
const STATUS_ICON = {
  completed:   '✅',
  skipped:     '⤷',  // 跳过箭头
  in_progress: '🔄',
  pending:     '⏸',
};

const PHASE_SHORT = {
  prd: 'prd',
  wbs: 'wbs',
  design: 'design',
  'design-brief': 'brief',
  'design-execute': 'exec',
  'build-web': 'b-web',
  'build-api': 'b-api',
  test: 'test',
  review: 'review',
  fix: 'fix',
  package: 'pkg',
  report: 'rpt',
};

export function renderProgress(progress, opts = {}) {
  const showBar = opts.showBar !== false;
  const phases = progress.phases || {};
  const order = Object.keys(phases);
  if (order.length === 0) {
    return '⚠️  progress.json 中无 phase 数据';
  }
  const total = order.length;
  const terminal = order.filter(p =>
    phases[p].status === 'completed' || phases[p].status === 'skipped'
  );
  const inProgress = order.filter(p => phases[p].status === 'in_progress');
  const pct = Math.round((terminal.length / total) * 100);

  const lines = [];
  if (showBar) {
    // ASCII 进度条：每 phase 占 BAR_CELL 字符；标签行每 phase 占 LBL_CELL 字符
    const BAR_CELL = 4;   // 进度条主体
    const LBL_CELL = 7;   // 标签 + 图标行（容纳 design / b-web / review 等）
    const bar = order.map(p => {
      const ch = STATUS_BAR_FILL[phases[p].status] || '░';
      return ch.repeat(BAR_CELL);
    }).join('');
    lines.push(`[${bar}] ${terminal.length}/${total} (${pct}%)`);
    // 短名行
    const shortRow = order.map(p => (PHASE_SHORT[p] || p).padEnd(LBL_CELL, ' ')).join('');
    lines.push(' ' + shortRow);
    // 状态图标行（emoji 占双字宽，显示时会少 1 字符 padding）
    const iconRow = order.map(p => {
      const icon = STATUS_ICON[phases[p].status] || '?';
      return (icon + '   ').slice(0, LBL_CELL - 1).padEnd(LBL_CELL, ' ');
    }).join('');
    lines.push(' ' + iconRow);

    if (inProgress.length > 0) {
      const idx = order.indexOf(inProgress[0]);
      const arrow = ' '.repeat(idx * LBL_CELL + 1) + '↑';
      lines.push(arrow);
      lines.push(' '.repeat(Math.max(0, idx * LBL_CELL - 5) + 1) + `当前: /${inProgress[0]}`);
    } else if (terminal.length === total) {
      lines.push('🎉 所有 phase 已完成！');
    } else {
      // 找第一个 pending
      const nextPending = order.find(p => phases[p].status === 'pending');
      if (nextPending) {
        const idx = order.indexOf(nextPending);
        lines.push(' '.repeat(idx * LBL_CELL + 1) + '↑');
        lines.push(' '.repeat(Math.max(0, idx * LBL_CELL - 6) + 1) + `下一步: /${nextPending}`);
      }
    }
  }

  // 详细列表
  lines.push('');
  lines.push('详细：');
  for (const p of order) {
    const ph = phases[p];
    const icon = STATUS_ICON[ph.status] || '?';
    let detail = '';
    if (ph.status === 'completed' && ph.completed_at) {
      detail = `（${new Date(ph.completed_at).toISOString().slice(0, 16)}${ph.duration_estimated ? ' ⚠️估算' : ''}）`;
    } else if (ph.status === 'in_progress' && ph.started_at) {
      const elapsed = Math.round((Date.now() - new Date(ph.started_at)) / 60000);
      detail = `（已 ${elapsed} 分钟）`;
    } else if (ph.status === 'skipped') {
      detail = '（按规则跳过）';
    }
    lines.push(`  ${icon} ${p}${detail}`);
  }
  return lines.join('\n');
}

function main() {
  const args = process.argv.slice(2);
  const opts = { path: '.ddt/progress.json', showBar: true };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--path') opts.path = args[++i];
    else if (args[i] === '--no-bar') opts.showBar = false;
  }
  if (!existsSync(opts.path)) {
    console.error(`❌ progress 文件不存在: ${opts.path}`);
    process.exit(1);
  }
  const progress = JSON.parse(readFileSync(opts.path, 'utf8'));
  console.log(renderProgress(progress, opts));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
