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

import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync, statSync, lstatSync, realpathSync } from 'node:fs';
import { join, basename, extname, resolve, sep } from 'node:path';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';

// W7.5 R10：单 jsx/css 读全文上限。超过 5MB 的文件不可能是合法的 React/CSS 源码——
//   要么是 minified bundle，要么是带嵌入数据的产物，要么是恶意压缩炸弹。
//   红线检测时跳过，避免 OOM。
const MAX_FILE_BYTES_FOR_INSPECTION = 5_000_000;

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
//   W7.5 R10：读文件前 statSync 校验大小，> 5MB 跳过并记 skipped flag
export function detectRedFlags(scan) {
  const flags = [];
  // 1. 单 jsx > 1000 行（违反 Claude Design 自身约束）
  for (const f of scan.jsx) {
    try {
      if (f.size > MAX_FILE_BYTES_FOR_INSPECTION) {
        flags.push(`${f.rel}: ${f.size} 字节（超 ${MAX_FILE_BYTES_FOR_INSPECTION} 阈值，跳过红线检查；可能是 minified bundle）`);
        continue;
      }
      const text = readFileSync(f.abs, 'utf8');
      const lines = text.split('\n').length;
      if (lines > 1000) flags.push(`${f.rel}: ${lines} 行（超 Claude Design 1000 行约束）`);
      // 2. 含 fetch / axios（应走 OpenAPI client）
      if (/\bfetch\s*\(\s*['"]\/api\//.test(text) || /\baxios\.(get|post|put|patch|delete)\s*\(/.test(text)) {
        flags.push(`${f.rel}: 含 fetch/axios 直连（应走 web/lib/api-client.ts）`);
      }
    } catch { /* skip */ }
  }
  // 3. tokens.css 不是标准 CSS variables
  const tokensFile = scan.css.find(f => /tokens\.css$/i.test(f.rel));
  if (tokensFile) {
    try {
      if (tokensFile.size > MAX_FILE_BYTES_FOR_INSPECTION) {
        flags.push(`${tokensFile.rel}: ${tokensFile.size} 字节（跳过 CSS variables 检查）`);
      } else {
        const text = readFileSync(tokensFile.abs, 'utf8');
        if (!/--[a-z-]+:/i.test(text)) {
          flags.push(`${tokensFile.rel}: 不是标准 CSS variables（缺 --xxx 声明）`);
        }
      }
    } catch { /* skip */ }
  }
  return flags;
}

// W7.5 R10：zip slip 防御。解压前用 list 工具读取 zip 条目名，
//   拒绝任何含 .. 段或绝对路径的条目。攻击向量：恶意 zip 含 ../../../etc/passwd 条目，
//   unzip / tar / bsdtar 默认不阻挡，会把文件写到 staging 外。
//
// 后置 walk-staging 校验补漏：解压完再 walk 一遍 staging，验证每个文件路径
//   resolve 后仍在 stagingResolved 之下（防符号链接逃逸）。
export function listZipEntries(tool, zipPath) {
  let stdout;
  try {
    if (tool === 'unzip') {
      stdout = execFileSync('unzip', ['-Z1', zipPath], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    } else if (tool === 'bsdtar' || tool === 'tar') {
      stdout = execFileSync(tool, ['-tf', zipPath], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    } else {
      return null;
    }
  } catch {
    return null;  // 工具失败时让 unzipBundle 自己报错
  }
  return stdout.split('\n').map(l => l.trim()).filter(Boolean);
}

export function findMaliciousZipEntries(entries) {
  if (!Array.isArray(entries)) return [];
  return entries.filter(e =>
    e.startsWith('/') ||                     // 绝对路径
    /^[A-Za-z]:[\\/]/.test(e) ||             // Windows 绝对路径
    e.split(/[\\/]/).includes('..') ||       // 任意 .. 段
    e.includes('\0')                          // null byte
  );
}

// 解压后 walk staging 防 symlink 逃逸 / 工具未拦下的边界 case
//   关键：用 realpathSync 跟随符号链接，否则 resolve(...) 只是路径字符串拼接，
//   无法发现 staging/pwn-link → /etc/passwd 这类符号链接逃逸。
export function verifyNoPathTraversal(stagingDir) {
  const stagingReal = (() => {
    try { return realpathSync(stagingDir); } catch { return resolve(stagingDir); }
  })();
  const offenders = [];
  function walk(p) {
    let entries;
    try { entries = readdirSync(p); } catch { return; }
    for (const entry of entries) {
      const full = join(p, entry);
      let realFull;
      try { realFull = realpathSync(full); }       // 跟随 symlink 到真实目标
      catch { realFull = resolve(full); }
      if (realFull !== stagingReal &&
          !realFull.startsWith(stagingReal + sep)) {
        offenders.push(realFull);
        continue;
      }
      // 子目录递归（用 lstatSync 防被 symlink loop 卡住）
      let lst;
      try { lst = lstatSync(full); } catch { continue; }
      if (lst.isDirectory() && !lst.isSymbolicLink()) walk(full);
    }
  }
  walk(stagingDir);
  return offenders;
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

  // W7.5 R10：解压前先 list zip 条目，拒绝任何含 .. / 绝对路径 / null byte 的恶意条目
  const entries = listZipEntries(tool, bundlePath);
  if (entries !== null) {
    const malicious = findMaliciousZipEntries(entries);
    if (malicious.length > 0) {
      console.error(`❌ zip 包含恶意条目（${malicious.length} 项），拒绝解压`);
      for (const m of malicious.slice(0, 5)) console.error(`   - ${m}`);
      if (malicious.length > 5) console.error(`   ... 共 ${malicious.length} 项`);
      rmSync(stagingDir, { recursive: true, force: true });
      process.exit(4);
    }
  }

  // 解压
  try {
    unzipBundle(tool, bundlePath, stagingDir);
  } catch (e) {
    console.error(`❌ 解压失败（${tool}）: ${e.message}`);
    process.exit(4);
  }

  // W7.5 R10：解压后再 walk 防 symlink 逃逸（list 不会列出符号链接的目标）
  const offenders = verifyNoPathTraversal(stagingDir);
  if (offenders.length > 0) {
    console.error(`❌ zip 解压后发现 ${offenders.length} 项落到 staging 外（疑似 symlink 逃逸）`);
    for (const o of offenders.slice(0, 5)) console.error(`   - ${o}`);
    if (offenders.length > 5) console.error(`   ... 共 ${offenders.length} 项`);
    rmSync(stagingDir, { recursive: true, force: true });
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
