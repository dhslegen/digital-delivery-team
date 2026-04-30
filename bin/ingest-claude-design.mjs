#!/usr/bin/env node
// W4: claude.ai/design 通道摄取器
//
// 输入：用户从 claude.ai/design 下载的 zip bundle（Share → Download as .zip）
//       或 Handoff to Claude Code 落盘的 bundle（路径由用户告知）
//
// 输出：
//   .ddt/design/claude-design/raw/        解压目录
//   .ddt/design/claude-design/ingest-report.json  扫描结果（main thread + skill 后续整合）
//
// 设计原则（v0.8 W4）：摄取脚本只做"安全拉取 + 落到 staging 区"——
//   不直接改 web/。改动 web/ 由 main thread 在 design-execute Phase 4 后
//   用 frontend-development skill 完成（W5 处理）。这样脚本简单可测，
//   不假设项目目录结构，也不会破坏用户已有 web/ 文件。
//
// 用法：
//   node bin/ingest-claude-design.mjs --bundle <zip-path>
//   node bin/ingest-claude-design.mjs --bundle <zip-path> --refresh
//   node bin/ingest-claude-design.mjs --bundle <zip-path> --dry-run
//
// 退出码：
//   0 = 成功
//   1 = 参数错误
//   2 = bundle 文件不存在
//   3 = 无可用解压工具（unzip / bsdtar）
//   4 = 解压失败 / zip 损坏
//   5 = staging 目录已存在未传 --refresh

import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync, statSync } from 'node:fs';
import { join, basename, extname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) { args[key] = next; i++; }
      else args[key] = true;
    } else args._.push(a);
  }
  return args;
}

// 检测 unzip / bsdtar / tar 哪个可用（macOS / Linux 通常都有 unzip 或 bsdtar）
function findUnzipTool() {
  for (const tool of ['unzip', 'bsdtar', 'tar']) {
    try {
      execFileSync(tool, ['--version'], { stdio: ['pipe', 'pipe', 'pipe'] });
      return tool;
    } catch { /* not found */ }
  }
  return null;
}

function unzipBundle(tool, zipPath, outDir) {
  // 用 execFileSync + argv 数组，无 shell 注入风险
  if (tool === 'unzip') {
    execFileSync('unzip', ['-q', '-o', zipPath, '-d', outDir], { stdio: ['pipe', 'pipe', 'pipe'] });
  } else if (tool === 'bsdtar') {
    execFileSync('bsdtar', ['-xf', zipPath, '-C', outDir], { stdio: ['pipe', 'pipe', 'pipe'] });
  } else if (tool === 'tar') {
    // GNU tar 也能解 zip（如果 libarchive 支持），但行为依赖系统
    execFileSync('tar', ['-xf', zipPath, '-C', outDir], { stdio: ['pipe', 'pipe', 'pipe'] });
  }
}

// 递归扫描目录，按扩展名分类
export function scanBundleContent(dir) {
  const result = {
    jsx: [],          // .jsx / .tsx
    css: [],          // .css
    html: [],         // .html
    md: [],           // .md（spec.md / readme.md）
    images: [],       // .png / .jpg / ...
    json: [],         // .json
    other: [],
  };
  if (!existsSync(dir)) return result;

  function walk(p, rel = '') {
    for (const entry of readdirSync(p)) {
      const full = join(p, entry);
      const relPath = rel ? `${rel}/${entry}` : entry;
      try {
        const st = statSync(full);
        if (st.isDirectory()) {
          walk(full, relPath);
        } else {
          const ext = extname(entry).toLowerCase();
          const item = { rel: relPath, abs: full, size: st.size };
          if (ext === '.jsx' || ext === '.tsx')      result.jsx.push(item);
          else if (ext === '.css')                   result.css.push(item);
          else if (ext === '.html' || ext === '.htm')result.html.push(item);
          else if (ext === '.md')                    result.md.push(item);
          else if (/\.(png|jpg|jpeg|gif|webp|svg)$/i.test(entry)) result.images.push(item);
          else if (ext === '.json')                  result.json.push(item);
          else                                       result.other.push(item);
        }
      } catch { /* skip unreadable */ }
    }
  }
  walk(dir);
  return result;
}

// 红线检测（v0.8 §5.1.7）
export function detectRedFlags(scan) {
  const flags = [];
  // 1. 单 jsx > 1000 行（违反 Claude Design 自身约束）
  for (const f of scan.jsx) {
    try {
      const lines = readFileSync(f.abs, 'utf8').split('\n').length;
      if (lines > 1000) flags.push(`${f.rel}: ${lines} 行（超 Claude Design 1000 行约束）`);
    } catch { /* skip */ }
  }
  // 2. 含 fetch / axios（应走 OpenAPI client）
  for (const f of scan.jsx) {
    try {
      const text = readFileSync(f.abs, 'utf8');
      if (/\bfetch\s*\(\s*['"]\/api\//.test(text) || /\baxios\.(get|post|put|patch|delete)\s*\(/.test(text)) {
        flags.push(`${f.rel}: 含 fetch/axios 直连（应走 web/lib/api-client.ts）`);
      }
    } catch { /* skip */ }
  }
  // 3. tokens.css 不是标准 CSS variables
  const tokensFile = scan.css.find(f => /tokens\.css$/i.test(f.rel));
  if (tokensFile) {
    try {
      const text = readFileSync(tokensFile.abs, 'utf8');
      if (!/--[a-z-]+:/i.test(text)) {
        flags.push(`${tokensFile.rel}: 不是标准 CSS variables（缺 --xxx 声明）`);
      }
    } catch { /* skip */ }
  }
  return flags;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cwd = process.cwd();

  const bundlePath = args.bundle;
  if (!bundlePath) {
    console.error(`❌ --bundle <zip-path> 必填`);
    process.exit(1);
  }

  if (!existsSync(bundlePath)) {
    console.error(`❌ bundle 文件不存在: ${bundlePath}`);
    process.exit(2);
  }

  const tool = findUnzipTool();
  if (!tool) {
    console.error(`❌ 未找到可用解压工具（unzip / bsdtar / tar）`);
    console.error(`   macOS: brew install unzip   Linux: apt install unzip`);
    process.exit(3);
  }

  const stagingDir = join(cwd, '.ddt', 'design', 'claude-design', 'raw');
  if (existsSync(stagingDir) && !args.refresh && !args['dry-run']) {
    console.error(`❌ ${stagingDir} 已存在；如需重新摄取请加 --refresh`);
    process.exit(5);
  }

  if (args['dry-run']) {
    console.log(`--- DRY RUN ---`);
    console.log(`tool: ${tool}`);
    console.log(`bundle: ${bundlePath} (${statSync(bundlePath).size} bytes)`);
    console.log(`将解压到: ${stagingDir}`);
    process.exit(0);
  }

  // 清理旧 staging
  if (existsSync(stagingDir)) rmSync(stagingDir, { recursive: true, force: true });
  mkdirSync(stagingDir, { recursive: true });

  // 解压
  try {
    unzipBundle(tool, bundlePath, stagingDir);
  } catch (e) {
    console.error(`❌ 解压失败（${tool}）: ${e.message}`);
    process.exit(4);
  }

  // 扫描内容
  const scan = scanBundleContent(stagingDir);
  const redFlags = detectRedFlags(scan);

  // 写 ingest-report.json
  const report = {
    generated_at: new Date().toISOString(),
    bundle_path: bundlePath,
    bundle_size: statSync(bundlePath).size,
    staging_dir: stagingDir,
    unzip_tool: tool,
    counts: {
      jsx:    scan.jsx.length,
      css:    scan.css.length,
      html:   scan.html.length,
      md:     scan.md.length,
      images: scan.images.length,
      json:   scan.json.length,
      other:  scan.other.length,
    },
    files: {
      jsx:    scan.jsx.map(f => f.rel),
      css:    scan.css.map(f => f.rel),
      html:   scan.html.map(f => f.rel),
      md:     scan.md.map(f => f.rel),
      images: scan.images.map(f => f.rel),
      tokens_css: scan.css.find(f => /tokens\.css$/i.test(f.rel))?.rel || null,
      design_html: scan.html.find(f => /design\.html$|index\.html$/i.test(f.rel))?.rel || null,
      spec_md: scan.md.find(f => /spec\.md$|readme\.md$|design-notes\.md$/i.test(f.rel))?.rel || null,
    },
    red_flags: redFlags,
  };

  const reportPath = join(cwd, '.ddt', 'design', 'claude-design', 'ingest-report.json');
  writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');

  // 终端摘要
  console.log(`✅ Claude Design bundle 摄取完成`);
  console.log(`   📦 解压目录: ${stagingDir}`);
  console.log(`   📊 报告:    ${reportPath}`);
  console.log('');
  console.log(`📋 内容扫描：`);
  console.log(`   - JSX 组件: ${scan.jsx.length} 个`);
  console.log(`   - CSS 文件: ${scan.css.length} 个${report.files.tokens_css ? `（含 ${report.files.tokens_css}）` : ''}`);
  console.log(`   - HTML:    ${scan.html.length} 个${report.files.design_html ? `（含 ${report.files.design_html}）` : ''}`);
  console.log(`   - Spec 文档: ${scan.md.length} 个${report.files.spec_md ? `（含 ${report.files.spec_md}）` : ''}`);
  console.log(`   - 截图:    ${scan.images.length} 张`);
  console.log('');

  if (redFlags.length > 0) {
    console.log(`⚠️  红线告警（${redFlags.length} 条）：`);
    for (const f of redFlags) console.log(`   - ${f}`);
    console.log('');
  }

  console.log(`👀 下一步：`);
  console.log(`   1. main thread 读 ingest-report.json，按 frontend-development skill 改写为 web/ 结构`);
  console.log(`   2. tokens.css 合并到 web/styles/tokens.css + tailwind.config.js`);
  console.log(`   3. JSX 组件改写：移除 fetch / axios → 使用 web/lib/api-client.ts`);
  console.log(`   4. 跑 web/ 构建 + lint + 测试 + 10 维评分决策门`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => { console.error(err); process.exit(1); });
}
