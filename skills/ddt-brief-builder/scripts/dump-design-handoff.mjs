#!/usr/bin/env node
// ddt-brief-builder · Claude Design handoff bundle 摘要器（D26 / v0.9.9）
//
// 把 claude.ai/design 的 handoff bundle 解析为 brief §11 集成依赖（设计契约）片段。
//
// 输入形态：
//   1. .tar.gz（claude.ai/design API 直发，格式 ustar+gzip） → tmpdir 解压后扫描
//   2. 解压后的本地目录（含 untitled/README.md + chats/ + project/）→ 直接扫描
//
// **不支持 URL** —— URL 形态请先用 bin/ingest-claude-design.mjs 落盘到 .ddt/design/，
//   再用本脚本指向解压后的目录。这样：
//   (a) 安全检查（SSRF / 体积 / magic bytes）由专职 ingest 脚本完成；
//   (b) brief 阶段的 dump 只做摘要，零网络副作用。
//
// 用法：
//   node dump-design-handoff.mjs <bundle.tar.gz>
//   node dump-design-handoff.mjs <handoff-dir/>
//   node dump-design-handoff.mjs <path> --json   # 仅 JSON 输出
//
// 输出：markdown §11 设计契约片段 + JSON 摘要
// 退出码：0 成功 / 1 参数错误 / 2 输入不存在 / 3 解析失败

import { existsSync, readFileSync, readdirSync, statSync, mkdtempSync, rmSync } from 'node:fs';
import { extname, basename, join, resolve, relative } from 'node:path';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';

// ============================================================================
// 输入处理：tar.gz 解压 / 目录直读
// ============================================================================

function isTarGz(p) {
  if (!existsSync(p) || !statSync(p).isFile()) return false;
  // gzip magic bytes: 1f 8b
  const buf = Buffer.alloc(2);
  const fd = require('node:fs').openSync(p, 'r');
  try {
    require('node:fs').readSync(fd, buf, 0, 2, 0);
  } finally {
    require('node:fs').closeSync(fd);
  }
  return buf[0] === 0x1f && buf[1] === 0x8b;
}

function extractTarGz(srcPath) {
  const dest = mkdtempSync(join(tmpdir(), 'ddt-handoff-'));
  // 用系统 tar（macOS/Linux 通用）
  execFileSync('tar', ['-xzf', srcPath, '-C', dest], { stdio: 'pipe' });
  return dest;
}

// ============================================================================
// Bundle 结构识别
// ============================================================================

function findBundleRoot(rootDir) {
  // claude.ai/design 标准结构：<root>/untitled/README.md（或 <root>/<projectName>/README.md）
  // 优先找含 chats/ + project/ + README.md 的目录
  function findReadmeBundle(dir, depth = 0) {
    if (depth > 3) return null;
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return null; }

    const hasReadme = entries.some(e => e.isFile() && /^readme\.md$/i.test(e.name));
    const hasChats = entries.some(e => e.isDirectory() && e.name === 'chats');
    const hasProject = entries.some(e => e.isDirectory() && e.name === 'project');
    if (hasReadme && (hasChats || hasProject)) return dir;

    for (const ent of entries) {
      if (ent.isDirectory() && !ent.name.startsWith('.')) {
        const found = findReadmeBundle(join(dir, ent.name), depth + 1);
        if (found) return found;
      }
    }
    return null;
  }

  return findReadmeBundle(rootDir) || rootDir;
}

// ============================================================================
// 抽取：README / chats / tokens / 组件
// ============================================================================

function extractFromReadme(readmePath) {
  if (!existsSync(readmePath)) return {};
  const text = readFileSync(readmePath, 'utf8');
  const result = { hasInstructions: /CODING AGENTS|coding agent/i.test(text) };

  // 项目名：README 段落里若提到 "the `<X>` project files" 抽 X
  const projMatch = text.match(/the\s+[`"]?([^`"\n]+?)[`"]?\s+project\s+files/i);
  if (projMatch) result.projectName = projMatch[1].trim();

  // bundle 内容描述
  const contentsBlock = text.match(/## Bundle contents[\s\S]+?(?=\n##\s|\Z)/);
  if (contentsBlock) {
    result.bundleContentsSummary = contentsBlock[0].split('\n').filter(l => l.startsWith('- ')).slice(0, 6);
  }

  // 关键 instruction 第一句
  const instructionMatch = text.match(/## What you should do[^\n]*\n+([\s\S]*?)(?=\n##\s|\Z)/);
  if (instructionMatch) {
    const firstSentence = instructionMatch[1].trim().split(/\n\s*\n/)[0].slice(0, 280);
    result.firstInstruction = firstSentence;
  }

  return result;
}

function extractFromChats(chatsDir) {
  if (!existsSync(chatsDir)) return { count: 0, decisions: [], aiTechRecommendations: [], userIntent: null };

  const chatFiles = readdirSync(chatsDir).filter(f => f.endsWith('.md'));
  const result = { count: chatFiles.length, decisions: [], aiTechRecommendations: [], userIntent: null };

  for (const f of chatFiles) {
    const text = readFileSync(join(chatsDir, f), 'utf8');

    // 用户首条 message（## User 后第一段）
    if (!result.userIntent) {
      const userBlock = text.match(/##\s+User\s*\n+([\s\S]*?)(?=\n##\s|\Z)/);
      if (userBlock) {
        const intent = userBlock[1].trim().split(/\n\s*\n/)[0].slice(0, 200);
        if (intent.length >= 10) result.userIntent = intent;
      }
    }

    // 决策项（**视觉**: ... / **品牌**: ... / **创新**: ... 等）
    const reDecision = /\*\*([^*]{1,30}?)\*\*\s*[：:]\s*([^\n*]{5,180})/g;
    for (const m of text.matchAll(reDecision)) {
      const key = m[1].trim();
      const value = m[2].trim();
      // 过滤掉非决策（如 "好处"、"代价" 这类讨论词）
      if (/视觉|品牌|主色|字体|数据|创新|变体|画布|风格/i.test(key) && value.length >= 5) {
        result.decisions.push({ key, value });
      }
    }

    // AI 推荐的技术栈（"AntD" / "shadcn" / "Vue" / "React" 等出现）
    const techHits = new Set();
    for (const lib of ['React', 'Vue', 'Angular', 'Svelte', 'AntD', 'shadcn', 'Element Plus', 'MUI', 'Chakra', 'Naive UI', 'TanStack Query', 'Zustand', 'Jotai', 'Pinia', 'ECharts', 'D3', 'Three.js', 'Tailwind']) {
      const re = new RegExp(`\\b${lib.replace(/\s+/g, '\\s+').replace(/\./g, '\\.')}\\b`, 'i');
      if (re.test(text)) techHits.add(lib);
    }
    result.aiTechRecommendations = [...new Set([...result.aiTechRecommendations, ...techHits])];
  }

  // 去重 + 限制数量
  const seen = new Set();
  result.decisions = result.decisions.filter(d => {
    const k = d.key + '|' + d.value;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }).slice(0, 12);

  return result;
}

function extractFromTokens(tokensPath) {
  if (!existsSync(tokensPath)) return null;
  const text = readFileSync(tokensPath, 'utf8');
  const result = { palette: [], fontFamilies: [], states: [], totalVars: 0 };

  // CSS variables 总数
  const allVars = [...text.matchAll(/--[a-zA-Z][\w-]*\s*:/g)];
  result.totalVars = allVars.length;

  // 主品牌色（--brand-* 关键档）
  const brandColors = [...text.matchAll(/--brand-(\d+)\s*:\s*([^;]+);/g)].slice(0, 6);
  result.palette = brandColors.map(m => `brand-${m[1]}=${m[2].trim()}`);

  // 字体
  const fonts = [...text.matchAll(/--font-([\w-]+)\s*:\s*([^;]+);/g)].slice(0, 4);
  result.fontFamilies = fonts.map(m => `font-${m[1]}=${m[2].trim().slice(0, 60)}`);

  // 状态色（ok/warn/err/info）
  for (const k of ['ok', 'warn', 'err', 'info']) {
    const m = text.match(new RegExp(`--${k}\\s*:\\s*([^;]+);`));
    if (m) result.states.push(`${k}=${m[1].trim()}`);
  }

  return result;
}

function extractFromProject(projectDir) {
  if (!existsSync(projectDir)) return { jsxFiles: [], cssFiles: [], htmlFiles: [], all: [] };
  const out = { jsxFiles: [], cssFiles: [], htmlFiles: [], all: [] };
  for (const f of readdirSync(projectDir)) {
    const ext = extname(f).toLowerCase();
    out.all.push(f);
    if (ext === '.jsx' || ext === '.tsx') out.jsxFiles.push(f);
    else if (ext === '.css') out.cssFiles.push(f);
    else if (ext === '.html') out.htmlFiles.push(f);
  }
  return out;
}

// ============================================================================
// 输出生成
// ============================================================================

function inferFramework(projectFiles, aiHits) {
  if (projectFiles.jsxFiles.length > 0) return 'React (.jsx prototype)';
  if (aiHits.includes('Vue')) return 'Vue';
  if (aiHits.includes('Svelte')) return 'Svelte';
  return 'unknown';
}

function inferUiLibrary(aiHits) {
  if (aiHits.includes('AntD')) return 'AntD 5（chat 中 AI 已建议）';
  if (aiHits.includes('shadcn')) return 'shadcn-ui';
  if (aiHits.includes('MUI')) return 'MUI';
  if (aiHits.includes('Element Plus')) return 'Element Plus';
  if (aiHits.includes('Chakra')) return 'Chakra';
  return null;
}

function formatMarkdown(summary, originalPath) {
  const lines = [`### 设计契约：${summary.projectName || 'Claude Design Handoff'}`, ''];
  lines.push('| 项目 | 值 |');
  lines.push('|---|---|');
  lines.push(`| Bundle 路径 | \`${originalPath}\` |`);
  if (summary.framework) lines.push(`| Prototype 框架 | ${summary.framework}（**recreate 阶段最低成本路径**） |`);
  if (summary.uiLibrary) lines.push(`| AI 推荐 UI 库 | ${summary.uiLibrary} |`);
  if (summary.tokens) {
    lines.push(`| Design Tokens | ${summary.tokens.totalVars} 个 CSS variables（含 ${summary.tokens.palette.length} 阶品牌色 + ${summary.tokens.states.length} 状态色 + ${summary.tokens.fontFamilies.length} 字体族） |`);
  }
  if (summary.project) {
    lines.push(`| Prototype 文件 | ${summary.project.jsxFiles.length} 个 .jsx + ${summary.project.cssFiles.length} 个 .css + ${summary.project.htmlFiles.length} 个 .html |`);
  }
  if (summary.chatCount) lines.push(`| 设计对话 | ${summary.chatCount} 个 chat（含用户决策追溯） |`);

  if (summary.userIntent) {
    lines.push('');
    lines.push('**用户原始诉求**（chat 抽取）：');
    lines.push(`> ${summary.userIntent}`);
  }

  if (summary.decisions && summary.decisions.length) {
    lines.push('');
    lines.push('**关键设计决策**（AI 与用户共同确认）：');
    for (const d of summary.decisions.slice(0, 6)) {
      lines.push(`- **${d.key}**：${d.value}`);
    }
  }

  if (summary.tokens && summary.tokens.palette.length) {
    lines.push('');
    lines.push('**Design Token 速查**（前 4 阶品牌色）：');
    for (const p of summary.tokens.palette.slice(0, 4)) {
      lines.push(`- \`${p}\``);
    }
  }

  if (summary.aiTech && summary.aiTech.length) {
    lines.push('');
    lines.push(`**AI 提及的技术栈**（chat 中出现）：${summary.aiTech.join(' / ')}`);
  }

  if (summary.bundleContents && summary.bundleContents.length) {
    lines.push('');
    lines.push('**Bundle 内容**：');
    for (const b of summary.bundleContents) {
      lines.push(b);
    }
  }

  lines.push('');
  lines.push('> ⚠️ **下游消费**：product-agent 在 /prd 阶段可按需 Read prototype 与 tokens；/design-execute 阶段会用 `bin/ingest-claude-design.mjs` 全量摄取。');
  return lines.join('\n') + '\n';
}

// ============================================================================
// 主入口
// ============================================================================

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) { args[k] = next; i++; }
      else args[k] = true;
    } else args._.push(a);
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const inputPath = args._[0];

  if (!inputPath) {
    console.error('❌ 用法：dump-design-handoff.mjs <bundle.tar.gz | handoff-dir/> [--json]');
    console.error('   不支持 URL —— 请先用 bin/ingest-claude-design.mjs 落盘到本地');
    process.exit(1);
  }

  const abs = resolve(inputPath);
  if (!existsSync(abs)) {
    console.error(`❌ 输入不存在：${abs}`);
    process.exit(2);
  }

  let workDir;
  let cleanupTmp = false;

  try {
    if (statSync(abs).isFile()) {
      // 假设 .tar.gz
      if (!isTarGz(abs)) {
        console.error(`❌ 输入文件非 .tar.gz（gzip magic bytes 不匹配）：${abs}`);
        process.exit(3);
      }
      workDir = extractTarGz(abs);
      cleanupTmp = true;
    } else {
      workDir = abs;
    }

    const root = findBundleRoot(workDir);
    const readme = ['README.md', 'readme.md'].map(f => join(root, f)).find(existsSync);
    const chatsDir = join(root, 'chats');
    const projectDir = join(root, 'project');
    const tokensPath = join(projectDir, 'tokens.css');

    const readmeData = extractFromReadme(readme);
    const chatData = extractFromChats(chatsDir);
    const tokensData = extractFromTokens(tokensPath);
    const projectData = extractFromProject(projectDir);

    const summary = {
      projectName: readmeData.projectName || basename(root),
      hasInstructions: readmeData.hasInstructions,
      framework: inferFramework(projectData, chatData.aiTechRecommendations),
      uiLibrary: inferUiLibrary(chatData.aiTechRecommendations),
      tokens: tokensData,
      project: projectData,
      chatCount: chatData.count,
      userIntent: chatData.userIntent,
      decisions: chatData.decisions,
      aiTech: chatData.aiTechRecommendations,
      bundleContents: readmeData.bundleContentsSummary,
      firstInstruction: readmeData.firstInstruction,
    };

    const md = formatMarkdown(summary, inputPath);

    if (args.json) {
      console.log(JSON.stringify({ summary, markdown: md }, null, 2));
    } else {
      console.log(md);
      console.log('--- JSON ---');
      console.log(JSON.stringify(summary, null, 2));
    }
  } finally {
    if (cleanupTmp && workDir) {
      try { rmSync(workDir, { recursive: true, force: true }); } catch {}
    }
  }
}

// ESM 中调 require 需要 createRequire（isTarGz 用的 fs sync openSync）
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

main();
