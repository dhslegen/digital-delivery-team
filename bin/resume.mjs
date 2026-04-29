#!/usr/bin/env node
// M4-3: /resume 工具 — 读 .ddt/progress.json 输出当前进度与下一步建议
import { existsSync, readFileSync } from 'node:fs';

const PROGRESS_PATH = '.ddt/progress.json';
const STALE_MINUTES = 30;

if (!existsSync(PROGRESS_PATH)) {
  console.log('⚠️  .ddt/progress.json 不存在。可能原因：');
  console.log('   - 项目尚未初始化（先填 project-brief.md，重启会话或运行 /prd）');
  console.log('   - SessionStart hook 未触发，运行 /digital-delivery-team:doctor 检查');
  process.exit(0);
}

const progress = JSON.parse(readFileSync(PROGRESS_PATH, 'utf8'));
const now = new Date();
const lastActivity = progress.last_activity_at ? new Date(progress.last_activity_at) : null;
const minutesSinceActivity = lastActivity
  ? Math.round((now - lastActivity) / 60000)
  : null;

console.log('=== DDT Resume ===');
console.log(`项目 ID: ${progress.project_id}`);
console.log(`最后活动: ${lastActivity ? lastActivity.toISOString() : '未知'}` +
  (minutesSinceActivity != null ? `（${minutesSinceActivity} 分钟前）` : ''));
console.log('');

// 阶段进度概览
const phases = progress.phases || {};
const order = Object.keys(phases);
const completed = order.filter(p => phases[p].status === 'completed');
const inProgress = order.filter(p => phases[p].status === 'in_progress');
const pending = order.filter(p => phases[p].status === 'pending');

console.log('阶段进度：');
for (const phase of order) {
  const ph = phases[phase];
  const icon = ph.status === 'completed' ? '✅' :
               ph.status === 'in_progress' ? '🔄' : '⏸';
  let suffix = '';
  if (ph.status === 'in_progress' && ph.started_at) {
    const elapsed = Math.round((now - new Date(ph.started_at)) / 60000);
    suffix = `（已 ${elapsed} 分钟）`;
  }
  if (ph.status === 'completed' && ph.completed_at) {
    suffix = `（${new Date(ph.completed_at).toISOString().slice(0, 16)}）`;
  }
  console.log(`  ${icon} ${phase}${suffix}`);
}

console.log('');
console.log(`已完成: ${completed.length} / ${order.length}`);

// 下一步建议
console.log('');
console.log('=== 下一步建议 ===');

if (inProgress.length > 0) {
  const phase = inProgress[0];
  const ph = phases[phase];
  const elapsed = ph.started_at
    ? Math.round((now - new Date(ph.started_at)) / 60000)
    : 0;
  if (elapsed > STALE_MINUTES) {
    console.log(`⚠️  ${phase} 处于 in_progress 但已停滞 ${elapsed} 分钟（>${STALE_MINUTES} 分钟视为 stale）`);
    console.log(`   建议：检查产物 ${(ph.artifacts || []).join(', ')} 是否完整；如不完整，重跑 /${phase} --refresh`);
  } else {
    console.log(`🔄 当前在 ${phase} 阶段，最近 ${elapsed} 分钟内有活动。`);
    console.log(`   建议：继续完成 ${phase}（产物：${(ph.artifacts || []).join(', ')}）`);
  }
} else if (pending.length > 0) {
  const next = pending[0];
  console.log(`⏭  当前无 in_progress 阶段，下一步建议：/${next}`);
  if (next === 'fix' && phases.review.status === 'completed') {
    console.log(`   或跳过 fix 直接进入 /package（如评审无阻塞条目）`);
  }
} else {
  console.log('🎉 所有阶段已完成！可运行 /ship 出包，或 /report 重新生成效率报告。');
}

console.log('');
console.log('详情查看：node "$DDT_PLUGIN_ROOT/bin/progress.mjs" --print');
