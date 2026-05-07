#!/usr/bin/env node
// ddt-brief-builder · brief 质量自检
//
// 解析 project-brief.md，按 10 字段评分，输出 JSON 让 LLM 直接读决定是否产出。
//
// 用法：
//   node check-brief-quality.mjs <brief-path>
//   node check-brief-quality.mjs project-brief.md --json    # 仅 JSON 不带人话总结
//
// 输出（默认）：人话总结 + JSON
// 退出码：
//   0 = 填充率 ≥ 70%（可用）
//   1 = 填充率 < 70%（建议补全）
//   2 = 文件不存在 / 无法解析
//
// 设计原则（v0.9.4 丝滑 KPI）：
// - LLM 用 spawn 调本脚本拿 JSON，不用自己 grep 字段
// - 缺字段直接列名 + 修复建议
// - 占位符（<待补充>/<persona> 等）算"未填"

import { readFileSync, existsSync } from 'node:fs';

// 10 个 brief 字段的检测规则
// 字段编号 / 名称 / 必填 / 段落锚点正则
const FIELDS = [
  { n: 1, name: '项目背景',     required: true,  re: /^##\s+项目背景\s*$/m },
  { n: 2, name: '目标用户',     required: true,  re: /^##\s+目标用户\s*$/m },
  { n: 3, name: '成功标准',     required: true,  re: /^##\s+成功标准\s*$/m },
  { n: 4, name: '核心功能',     required: true,  re: /^##\s+核心功能(?:\s|（|\()/m },
  { n: 5, name: '关键约束',     required: true,  re: /^##\s+关键约束\s*$/m },
  { n: 6, name: '技术栈预设',   required: true,  re: /\*\*技术栈预设\*\*[：:]\s*[`\w-]+/ },
  { n: 7, name: '前端类型',     required: false, re: /frontend\.type|前端类型|frontend_type/i },
  { n: 8, name: 'AI-native UI', required: false, re: /\*\*AI-native UI\*\*|AI 通道|ai_design/i },
  { n: 9, name: '非目标',       required: false, re: /^##\s+非目标/m },
  { n:10, name: '参考资料',     required: false, re: /^##\s+参考资料/m },
];

// 占位符识别（未填字段）
const PLACEHOLDER_PATTERNS = [
  /<[^<>\n]{1,50}>/,                    // <persona> / <待填> / <YYYY-MM-DD>
  /\{\{[A-Z_]+\}\}/,                    // {{TOKEN}}
  /^TODO[: ：]/m,
  /^—$/m,
];

function parseArgs(argv) {
  const args = { _: [], json: false };
  for (const a of argv) {
    if (a === '--json') args.json = true;
    else if (!a.startsWith('--')) args._.push(a);
  }
  return args;
}

function fieldFilled(text, field) {
  // 简单策略：找到 field 段标题后，往下读到下一个 ## 标题或文末
  const headerMatch = text.match(field.re);
  if (!headerMatch) return { filled: false, reason: '段落标题缺失' };

  const headerEnd = headerMatch.index + headerMatch[0].length;
  const tail = text.slice(headerEnd);
  const nextHeader = tail.search(/^##\s+/m);
  const section = nextHeader > 0 ? tail.slice(0, nextHeader) : tail;
  const trimmed = section.trim();

  if (trimmed.length < 10) return { filled: false, reason: '内容 < 10 字符' };

  // 字段内容若主要由占位符构成，视为未填
  for (const pat of PLACEHOLDER_PATTERNS) {
    if (pat.test(trimmed) && trimmed.length < 100) {
      return { filled: false, reason: `含占位 "${trimmed.match(pat)[0]}" 且内容过短` };
    }
  }
  return { filled: true, lengthChars: trimmed.length };
}

function checkBrief(text) {
  const results = FIELDS.map(field => {
    const r = fieldFilled(text, field);
    return { ...field, ...r };
  });

  const filled = results.filter(r => r.filled).length;
  const total = results.length;
  const filledRequired = results.filter(r => r.required && r.filled).length;
  const totalRequired = results.filter(r => r.required).length;
  const fillRate = (filled / total * 100).toFixed(0);

  // 软 blocker：必填字段缺失
  const blockers = results
    .filter(r => r.required && !r.filled)
    .map(r => `§${r.n} ${r.name}：${r.reason}`);

  // 警告：可选字段缺失
  const warnings = results
    .filter(r => !r.required && !r.filled)
    .map(r => `§${r.n} ${r.name}：${r.reason}`);

  return {
    fill_rate_pct: Number(fillRate),
    filled_total: `${filled}/${total}`,
    filled_required: `${filledRequired}/${totalRequired}`,
    pass: Number(fillRate) >= 70 && blockers.length === 0,
    blockers,
    warnings,
    field_details: results,
  };
}

function humanSummary(report, briefPath) {
  const icon = report.pass ? '✅' : '⚠️';
  const lines = [];
  lines.push(`${icon} brief 质量自检：${briefPath}`);
  lines.push(`   填充率：${report.fill_rate_pct}%（${report.filled_total} 字段，必填 ${report.filled_required}）`);
  if (report.blockers.length > 0) {
    lines.push(`   🔴 必填字段缺失（${report.blockers.length}）：`);
    report.blockers.forEach(b => lines.push(`      - ${b}`));
  }
  if (report.warnings.length > 0) {
    lines.push(`   🟡 可选字段缺失（${report.warnings.length}）：`);
    report.warnings.forEach(w => lines.push(`      - ${w}`));
  }
  if (!report.pass) {
    lines.push(``);
    lines.push(`   建议：补全必填字段后再产出（让 product-agent 在 /prd 阶段顺畅）`);
  }
  return lines.join('\n');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const briefPath = args._[0];
  if (!briefPath) {
    console.error('❌ 用法：check-brief-quality.mjs <brief-path> [--json]');
    process.exit(2);
  }
  if (!existsSync(briefPath)) {
    console.error(`❌ brief 文件不存在：${briefPath}`);
    process.exit(2);
  }

  const text = readFileSync(briefPath, 'utf8');
  const report = checkBrief(text);

  if (!args.json) {
    console.log(humanSummary(report, briefPath));
    console.log('');
    console.log('--- JSON ---');
  }
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.pass ? 0 : 1);
}

main();
