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
// 注：JS regex 的 \b 在中文字符前后**不生效**（只对 \w 字符类有效）
// 改用"行首 ## + 可选 §N + 字段名"模式，不约束后缀（允许"## 项目背景"/"## §1 项目背景"/"## 项目背景（含上下文）"）
const FIELDS = [
  { n: 1, name: '项目背景',     required: true,  re: /^##\s+(?:§\d+\s+)?项目背景/m },
  { n: 2, name: '目标用户',     required: true,  re: /^##\s+(?:§\d+\s+)?目标用户/m },
  { n: 3, name: '成功标准',     required: true,  re: /^##\s+(?:§\d+\s+)?成功标准/m },
  { n: 4, name: '核心功能',     required: true,  re: /^##\s+(?:§\d+\s+)?核心功能/m },
  { n: 5, name: '关键约束',     required: true,  re: /^##\s+(?:§\d+\s+)?关键约束/m },
  // §6 技术栈：兼容 "## 技术栈预设"/"## 技术栈选型" 标题，或 inline `**技术栈预设**: <值>`
  { n: 6, name: '技术栈预设',   required: true,
    re: /^##\s+(?:§\d+\s+)?技术栈(?:预设|选型)|\*\*技术栈预设\*\*[：:]\s*[`\w-]+/m },
  // §7 前端类型：独立标题 / 文中提 frontend.type / spa|server-side|none 枚举
  { n: 7, name: '前端类型',     required: false,
    re: /^##\s+(?:§\d+\s+)?前端类型|frontend\.?type|\*\*前端类型\*\*|frontend\.type\s*[:=]\s*(?:spa|server-side|none)/im },
  // §8 AI 设计通道：独立标题 / inline / ai_design 字段
  { n: 8, name: 'AI-native UI', required: false,
    re: /^##\s+(?:§\d+\s+)?AI[-\s]?native\s*UI|^##\s+(?:§\d+\s+)?AI\s+(?:设计)?通道|\*\*AI[-\s]?native\s*UI\*\*|ai_design|\*\*AI\s+通道\*\*/im },
  { n: 9, name: '非目标',       required: false, re: /^##\s+(?:§\d+\s+)?非目标/m },
  { n:10, name: '参考资料',     required: false, re: /^##\s+(?:§\d+\s+)?参考资料/m },
  // §11 集成依赖（v0.9.8 D25）：第三方 API 契约。可选字段，与 §9/§10 同级。
  // 识别 3 风格：(1) 独立标题 "## 集成依赖"；(2) inline `**集成依赖**: ...`；
  // (3) "## 集成依赖" 章节内含 "### 第三方系统：..." 子标题（dump-api-docs 默认输出形态）
  { n:11, name: '集成依赖',     required: false,
    re: /^##\s+(?:§\d+\s+)?集成依赖|\*\*集成依赖\*\*[：:]|^###\s+第三方系统[：:]/m },
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

// v0.9.9 D26：preset 与前端框架的交叉校验
// 4 个 React preset：java-modern / node-modern / go-modern / python-fastapi
// 1 个 SSR preset：java-traditional（无独立前端框架）
const REACT_PRESETS = ['java-modern', 'node-modern', 'go-modern', 'python-fastapi'];

function extractPreset(text) {
  // 匹配："**技术栈预设**: java-modern" / "preset: java-modern" / "## 技术栈预设\njava-modern"
  const inline = text.match(/\*\*技术栈预设\*\*\s*[：:]\s*[`]?([\w-]+)[`]?/);
  if (inline) return inline[1].toLowerCase();
  const yaml = text.match(/^\s*preset\s*[:=]\s*([\w-]+)/m);
  if (yaml) return yaml[1].toLowerCase();
  // 块级章节：## 技术栈预设 → 下方第一行非空内容
  const block = text.match(/^##\s+(?:§\d+\s+)?技术栈(?:预设|选型)[^\n]*\n+([\s\S]*?)(?=\n##\s|\Z)/m);
  if (block) {
    const m = block[1].match(/\b(java-modern|java-traditional|node-modern|go-modern|python-fastapi|interactive|custom)\b/i);
    if (m) return m[1].toLowerCase();
  }
  return null;
}

function extractFramework(text) {
  // 匹配多种 spelling：react / react 18 / Vue 3 / Vue.js / Svelte 5 / Angular 19 / Next.js
  const candidates = [
    { name: 'react',   re: /\b(?:next\.?js|react)\b/i },
    { name: 'vue',     re: /\bvue(?:[\s.-]?\d|\.js)?\b/i },
    { name: 'svelte',  re: /\b(?:sveltekit|svelte)\b/i },
    { name: 'angular', re: /\bangular\b/i },
    { name: 'solid',   re: /\bsolid(?:js|-start)?\b/i },
  ];
  // 仅扫 §6 §7 段落（避免在用户故事 / 非目标段误中）
  const tech = text.match(/^##\s+(?:§\d+\s+)?(?:技术栈(?:预设|选型)|前端类型)[^\n]*\n([\s\S]*?)(?=\n##\s+(?:§|\w)|\Z)/gm);
  if (!tech) return null;
  const scope = tech.join('\n');
  for (const c of candidates) {
    if (c.re.test(scope)) return c.name;
  }
  return null;
}

function extractAiDesignChannel(text) {
  // 匹配："**AI-native UI**: claude-design" / "channel: claude-design" / 块级
  const inline = text.match(/\*\*AI[-\s]?native\s*UI\*\*\s*[：:]\s*[`]?([\w-]+)[`]?/i);
  if (inline) return inline[1].toLowerCase();
  const yaml = text.match(/^\s*channel\s*[:=]\s*([\w-]+)/m);
  if (yaml) return yaml[1].toLowerCase();
  const block = text.match(/^##\s+(?:§\d+\s+)?AI[-\s]?native\s*UI[^\n]*\n+([\s\S]*?)(?=\n##\s|\Z)/m);
  if (block) {
    const m = block[1].match(/\b(claude-design|figma|v0|none)\b/i);
    if (m) return m[1].toLowerCase();
  }
  return null;
}

function crossValidate(text) {
  const warnings = [];
  const preset = extractPreset(text);
  const framework = extractFramework(text);
  const channel = extractAiDesignChannel(text);

  // 规则 1：preset default vs 实际 framework 一致性（v0.9.9 D26）
  if (preset && REACT_PRESETS.includes(preset) && framework && framework !== 'react') {
    warnings.push(
      `D26 cross-check：§6 preset=${preset} default 是 React，但 §6/§7 写了 ${framework}。` +
      `这通常是 LLM 凭训练偏置自由发挥（如 java-modern + Vue + Element Plus）。` +
      `如果用户确实要 ${framework}，应改用 preset=interactive 或 custom；详见 references/field-rules.md §6 反模式。`
    );
  }

  // 规则 2：claude-design + 非 React → 软警告（30% 改造成本）
  if (channel === 'claude-design' && framework && framework !== 'react') {
    warnings.push(
      `D26 cross-check：§8 ai_design=claude-design 但 §7 framework=${framework}。` +
      `claude-design bundle 全是 .jsx prototype，写 ${framework} 等于把 JSX 重写成对应组件，约 30% 改造成本。` +
      `详见 references/ai-design-quick-pick.md "框架选择强相关"。`
    );
  }

  return warnings;
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

  // v0.9.9 D26：preset / framework / ai_design 交叉校验（软警告，不阻塞 pass）
  const crossWarnings = crossValidate(text);
  warnings.push(...crossWarnings);

  return {
    fill_rate_pct: Number(fillRate),
    filled_total: `${filled}/${total}`,
    filled_required: `${filledRequired}/${totalRequired}`,
    pass: Number(fillRate) >= 70 && blockers.length === 0,
    blockers,
    warnings,
    cross_validation: {
      preset: extractPreset(text),
      framework: extractFramework(text),
      ai_design_channel: extractAiDesignChannel(text),
      issues: crossWarnings,
    },
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
