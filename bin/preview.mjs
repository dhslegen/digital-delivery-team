#!/usr/bin/env node
// M6.2.5: /preview 命令实现 — 输出指定 phase 产物的关键摘要 + vs 上次 commit diff stat
//
// 用途：决策门触发前，让用户快速扫一眼产物内容，无需打开多个文件。
//
// 用法：
//   node bin/preview.mjs <phase>     # phase: prd / wbs / design / impl / test / review / fix / package / report / all

import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const phase = process.argv[2];
const VALID_PHASES = ['prd', 'wbs', 'design', 'impl', 'test', 'review', 'fix', 'package', 'report', 'all'];

if (!phase || !VALID_PHASES.includes(phase)) {
  console.error(`用法：node preview.mjs <phase>`);
  console.error(`支持的 phase：${VALID_PHASES.join(' / ')}`);
  process.exit(1);
}

function tryRead(path) {
  try { return readFileSync(path, 'utf8'); } catch { return null; }
}

function fileSize(path) {
  try {
    const stat = statSync(path);
    return `${(stat.size / 1024).toFixed(1)} KB`;
  } catch { return '—'; }
}

function git(args) {
  const r = spawnSync('git', args, { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : '';
}

function lineCount(text) {
  if (!text) return 0;
  return text.split('\n').length;
}

function countMatches(text, regex) {
  if (!text) return 0;
  const m = text.match(regex);
  return m ? m.length : 0;
}

function diffStat(filePath) {
  if (!existsSync(filePath)) return '';
  const stat = git(['diff', 'HEAD', '--stat', '--', filePath]);
  if (stat) return stat;
  // 文件存在但无 diff = 与 HEAD 相同
  return '（与 HEAD 一致，无未提交改动）';
}

// ── PRD 摘要 ──
function previewPrd() {
  console.log('## PRD（docs/prd.md）');
  const text = tryRead('docs/prd.md');
  if (!text) { console.log('  ⏸  未生成'); return; }
  const stories = countMatches(text, /^###\s+F\d+/gm) || countMatches(text, /^##\s+F\d+/gm);
  const acs = countMatches(text, /Given\s+/gi);
  const p0 = countMatches(text, /\*\*\s*P0\s*\*\*|优先级.*P0/gi);
  const p1 = countMatches(text, /\*\*\s*P1\s*\*\*|优先级.*P1/gi);
  console.log(`  📄 行数: ${lineCount(text)} · 大小: ${fileSize('docs/prd.md')}`);
  console.log(`  👤 用户故事: ${stories}`);
  console.log(`  ✅ Given/When/Then 验收标准: ${acs}`);
  console.log(`  🔥 优先级: P0=${p0} / P1=${p1}`);
  const ds = diffStat('docs/prd.md');
  if (ds) console.log(`  📊 vs HEAD: ${ds.split('\n')[0]}`);
}

// ── WBS 摘要 ──
function previewWbs() {
  console.log('## WBS（docs/wbs.md + docs/risks.md）');
  const wbs = tryRead('docs/wbs.md');
  const risks = tryRead('docs/risks.md');
  if (!wbs) { console.log('  ⏸  未生成'); return; }
  const tasks = countMatches(wbs, /^[-*]\s+T-?\d+/gm) || countMatches(wbs, /^###\s+T-?\d+/gm);
  const criticalPath = (wbs.match(/关键路径[：:]\s*([^\n]+)/) || [])[1] || '—';
  const totalH = (wbs.match(/总工时[：:]\s*([\d.]+\s*h?)/i) || [])[1] || '—';
  const riskCount = risks ? countMatches(risks, /^\|\s+R-?\d+/gm) : 0;
  console.log(`  📄 WBS 行数: ${lineCount(wbs)}`);
  console.log(`  🔧 任务数: ${tasks}`);
  console.log(`  🚦 关键路径: ${criticalPath.slice(0, 80)}`);
  console.log(`  ⏱  总工时: ${totalH}`);
  console.log(`  ⚠️  风险条目: ${riskCount}`);
}

// ── Design 摘要 ──
function previewDesign() {
  console.log('## Design（docs/arch.md + docs/api-contract.yaml + docs/data-model.md）');
  const arch = tryRead('docs/arch.md');
  const contract = tryRead('docs/api-contract.yaml');
  const dataModel = tryRead('docs/data-model.md');
  if (!arch && !contract) { console.log('  ⏸  未生成'); return; }
  const adrs = countMatches(arch || '', /^###?\s+ADR-?\d+/gm);
  const endpoints = countMatches(contract || '', /^\s*(get|post|put|patch|delete):/gm);
  const entities = countMatches(dataModel || '', /^##\s+[A-Z]/gm);
  console.log(`  📄 arch.md: ${arch ? lineCount(arch) + ' 行' : '⏸ 缺失'}`);
  console.log(`  📜 ADR 数: ${adrs}`);
  console.log(`  🔗 API endpoint: ${endpoints}`);
  console.log(`  🗃  数据模型实体: ${entities}`);
  if (contract) {
    const lintHint = contract.includes('security: []') ? 'security 已声明' : 'security 未声明（lint 可能 fail）';
    console.log(`  🔍 契约: ${lintHint}`);
  }
}

// ── Impl 摘要 ──
function previewImpl() {
  console.log('## Implementation');

  console.log('### Backend (server/)');
  if (existsSync('server')) {
    const tsCount = git(['ls-files', 'server/']).split('\n').filter(f => f.endsWith('.ts') || f.endsWith('.js')).length;
    console.log(`  📁 ts/js 文件: ${tsCount}`);
    const testFiles = git(['ls-files', 'server/']).split('\n').filter(f => f.includes('test')).length;
    console.log(`  🧪 测试文件: ${testFiles}`);
  } else {
    console.log('  ⏸  未生成');
  }

  console.log('### Frontend (web/)');
  if (existsSync('web')) {
    const tsxCount = git(['ls-files', 'web/']).split('\n').filter(f => f.endsWith('.tsx') || f.endsWith('.vue')).length;
    console.log(`  📁 组件文件: ${tsxCount}`);
    const testFiles = git(['ls-files', 'web/']).split('\n').filter(f => f.includes('test') || f.includes('spec')).length;
    console.log(`  🧪 测试文件: ${testFiles}`);
  } else {
    console.log('  ⏸  未生成');
  }
}

// ── Test 摘要 ──
function previewTest() {
  console.log('## Test（tests/test-report.md）');
  const text = tryRead('tests/test-report.md');
  if (!text) { console.log('  ⏸  未生成'); return; }
  const coverage = (text.match(/coverage[_\s]*pct[:：\s]*([\d.]+)/i) || text.match(/覆盖率[：:\s]*([\d.]+)/i) || [])[1];
  const total = (text.match(/tests[_\s]*total[:：\s]*([\d]+)/i) || text.match(/测试总数[：:\s]*([\d]+)/i) || [])[1];
  const passed = (text.match(/tests[_\s]*passed[:：\s]*([\d]+)/i) || text.match(/通过[：:\s]*([\d]+)/i) || [])[1];
  const failed = (text.match(/tests[_\s]*failed[:：\s]*([\d]+)/i) || text.match(/失败[：:\s]*([\d]+)/i) || [])[1];
  console.log(`  📊 覆盖率: ${coverage || '—'}%`);
  console.log(`  ✅ 通过: ${passed || '—'} / ${total || '—'}`);
  if (failed && Number(failed) > 0) console.log(`  ❌ 失败: ${failed}`);
}

// ── Review 摘要 ──
function previewReview() {
  console.log('## Review（docs/review-report.md）');
  const text = tryRead('docs/review-report.md');
  if (!text) { console.log('  ⏸  未生成'); return; }
  const blockers = (text.match(/blocker[_\s]*count[:：\s]*([\d]+)/i) || text.match(/阻塞级.*?([\d]+)\s*条/) || [])[1] || '0';
  const warnings = (text.match(/warning[_\s]*count[:：\s]*([\d]+)/i) || text.match(/警告级.*?([\d]+)\s*条/) || [])[1] || '0';
  const suggestions = (text.match(/suggestion[_\s]*count[:：\s]*([\d]+)/i) || text.match(/建议级.*?([\d]+)\s*条/) || [])[1] || '0';
  console.log(`  🔴 阻塞级: ${blockers}`);
  console.log(`  🟠 警告级: ${warnings}`);
  console.log(`  🟡 建议级: ${suggestions}`);
  if (text.includes('## Fix Log')) console.log(`  ✅ 含 Fix Log 段落（已有修复记录）`);
}

// ── Fix 摘要 ──
function previewFix() {
  console.log('## Fix（docs/review-report.md::Fix Log）');
  const text = tryRead('docs/review-report.md');
  if (!text || !text.includes('## Fix Log')) { console.log('  ⏸  未生成（review-report 无 Fix Log）'); return; }
  const fixed = countMatches(text, /status:\s*fixed/gi);
  const deferred = countMatches(text, /status:\s*deferred/gi);
  const blocked = countMatches(text, /status:\s*blocked/gi);
  console.log(`  ✅ 已修复: ${fixed}`);
  console.log(`  ⏸  延后: ${deferred}`);
  console.log(`  🚫 仍阻塞: ${blocked}`);
}

// ── Package 摘要 ──
function previewPackage() {
  console.log('## Package（README.md + docs/deploy.md + docs/demo-script.md）');
  const readme = tryRead('README.md');
  const deploy = tryRead('docs/deploy.md');
  const demo = tryRead('docs/demo-script.md');
  if (!readme && !deploy) { console.log('  ⏸  未生成'); return; }
  console.log(`  📘 README: ${readme ? lineCount(readme) + ' 行' : '⏸'}`);
  console.log(`  🚀 部署步骤: ${deploy ? countMatches(deploy, /^[\d]+\.\s/gm) + ' 步' : '⏸'}`);
  if (demo) {
    const mins = (demo.match(/(\d+)\s*分钟|(\d+)\s*min/i) || [])[0] || '—';
    console.log(`  🎬 Demo 时长: ${mins}`);
  }
}

// ── Report 摘要 ──
function previewReport() {
  console.log('## Report（docs/efficiency-report.md）');
  const text = tryRead('docs/efficiency-report.md');
  if (!text) { console.log('  ⏸  未生成'); return; }
  const totalEfficiency = (text.match(/总提效[：:\s]*([+-]?[\d.]+)\s*%/) || [])[1] || '—';
  const stages = countMatches(text, /^\|\s*(requirements|architecture|frontend|backend|testing|docs)\s*\|/gm);
  const isUnprovable = text.includes('不可证明');
  console.log(`  📈 总提效: ${isUnprovable ? '不可证明' : totalEfficiency + '%'}`);
  console.log(`  📊 阶段对比: ${stages} 个 stage`);
  if (text.includes('⚠️ 质量劣化')) console.log(`  ⚠️  质量劣化警告`);
}

// ── Main ──
console.log(`\n=== /preview ${phase} ===\n`);

if (phase === 'all') {
  previewPrd(); console.log('');
  previewWbs(); console.log('');
  previewDesign(); console.log('');
  previewImpl(); console.log('');
  previewTest(); console.log('');
  previewReview(); console.log('');
  previewFix(); console.log('');
  previewPackage(); console.log('');
  previewReport(); console.log('');
} else {
  const fn = {
    prd: previewPrd, wbs: previewWbs, design: previewDesign,
    impl: previewImpl, test: previewTest, review: previewReview,
    fix: previewFix, package: previewPackage, report: previewReport,
  }[phase];
  fn();
}

// ── 整体 git 摘要 ──
const branch = git(['branch', '--show-current']);
const uncommitted = git(['status', '--short']).split('\n').filter(Boolean).length;
console.log('');
console.log(`---`);
console.log(`分支: ${branch || 'unknown'} · 未提交改动: ${uncommitted} 个文件`);
console.log('');
process.exit(0);
