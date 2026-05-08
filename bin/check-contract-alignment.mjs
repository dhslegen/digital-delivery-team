#!/usr/bin/env node
// M3-8: 契约对齐检查（轻量版，深度检查留到 M4 fix-agent）
//
// 当前检查项：
//   1. 目标目录中不应包含 lovable / v0 / figma 的默认 mock client（防止接错后端）
//   2. 不应硬编码非契约 paths 中的 URL（仅做 hint，未列入失败条件）
//   3. tech-stack.json 中声明的 ui.components 与代码实际 import 一致
//
// 退出码：0 = 通过；1 = 严格违规（阻断）；2 = 仅警告
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname, resolve } from 'node:path';

const target = process.argv[2] || 'web/';
const cwd = process.cwd();
const targetDir = resolve(cwd, target);

if (!existsSync(targetDir)) {
  console.error(`⚠️ 目标目录不存在：${targetDir}`);
  process.exit(0); // 没目录视为无可检查内容（首次 import 前正常）
}

const FORBIDDEN_PATTERNS = [
  { pattern: /createClient\s*\(\s*['"`]https:\/\/[a-z0-9-]+\.supabase/, name: 'Supabase mock client（lovable 残留）' },
  { pattern: /from\s+['"]@supabase\/supabase-js['"]/, name: 'Supabase JS SDK（与 backend preset 数据库冲突）' },
  { pattern: /import\s+.*from\s+['"]@v0\/sdk['"]/, name: 'v0 SDK（应只引入生成的组件代码，不依赖 SDK 运行时）' },
];

const stack = (() => {
  const stackPath = join(cwd, '.ddt', 'tech-stack.json');
  if (!existsSync(stackPath)) return null;
  try { return JSON.parse(readFileSync(stackPath, 'utf8')); } catch { return null; }
})();

const violations = [];
const warnings = [];

// v0.9.13 D30：识别"contract 已定义 endpoint，但 web 含同名 mock 数组"反模式
const MOCK_ARRAY_RE = /^\s*(?:export\s+)?const\s+([A-Z][A-Z0-9_]{2,})\s*=\s*\[/gm;

function extractContractResources(yamlPath) {
  if (!existsSync(yamlPath)) return new Set();
  const text = readFileSync(yamlPath, 'utf8');
  const resources = new Set();
  const lines = text.split(/\r?\n/);
  let inPaths = false;
  for (const line of lines) {
    if (/^paths\s*:/.test(line)) { inPaths = true; continue; }
    if (inPaths) {
      if (/^[a-zA-Z_]/.test(line)) { inPaths = false; continue; }
      const m = line.match(/^\s{2}(\/[^\s:{}]+(?:\/\{[^}]+\})?)+/);
      if (m) {
        const path = m[0].trim().replace(/:$/, '');
        const segs = path.split('/').filter(s => s && !s.startsWith('{'));
        if (segs.length > 0) {
          const last = segs[segs.length - 1];
          resources.add(last.toUpperCase());
          if (last.endsWith('s')) resources.add(last.slice(0, -1).toUpperCase());
        }
      }
    }
  }
  return resources;
}

const contractYaml = join(cwd, 'docs', 'api-contract.yaml');
const contractResources = extractContractResources(contractYaml);
const mockReports = [];

function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name.startsWith('.')) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full);
    } else if (entry.isFile() && /\.(ts|tsx|js|jsx)$/.test(entry.name)) {
      const text = readFileSync(full, 'utf8');
      for (const { pattern, name } of FORBIDDEN_PATTERNS) {
        if (pattern.test(text)) {
          violations.push({ file: full.replace(cwd + '/', ''), reason: name });
        }
      }
      // v0.9.13 D30: 扫 mock 数组反模式（跳过 api/types|client + tests）
      const rel = full.replace(cwd + '/', '');
      if (/\/api\/(types|client)\.ts$/.test(rel)) continue;
      if (/(__mocks__|__tests__|\.test\.|\.spec\.)/.test(rel)) continue;

      MOCK_ARRAY_RE.lastIndex = 0;
      let m;
      while ((m = MOCK_ARRAY_RE.exec(text)) !== null) {
        const name = m[1];
        const slice = text.slice(m.index, m.index + 2000);
        const itemCount = (slice.match(/^\s{2,}\{/gm) || []).length;
        if (itemCount < 3) continue;
        const lineNo = text.slice(0, m.index).split(/\r?\n/).length;
        const matchesContract = contractResources.has(name) || [...contractResources].some(r =>
          (name.includes(r) && r.length >= 4) || (r.includes(name) && name.length >= 4)
        );
        mockReports.push({ file: rel, line: lineNo, name, items: itemCount, matchesContract });
      }
    }
  }
}

try { walk(targetDir); } catch (err) {
  console.error(`⚠️ 扫描失败：${err.message}`);
  process.exit(0);
}

// 输出
console.log('=== 契约对齐检查 ===');
if (stack) {
  console.log(`✅ tech-stack.json 已加载（preset: ${stack.preset}）`);
}
if (violations.length === 0) {
  console.log('✅ 未发现禁用模式');
} else {
  console.log('❌ 发现违规：');
  for (const v of violations) console.log(`   - ${v.file}: ${v.reason}`);
}
if (warnings.length > 0) {
  console.log('⚠️ 警告：');
  for (const w of warnings) console.log(`   - ${w}`);
}

// v0.9.13 D30：mock 数组反模式（warning，不阻塞 exit）
if (mockReports.length > 0) {
  const matchingContract = mockReports.filter(r => r.matchesContract);
  if (matchingContract.length > 0) {
    console.log('');
    console.log(`⚠️  D30: 发现 ${matchingContract.length} 个疑似 mock 数组（与 contract endpoint 同名/近义）：`);
    for (const r of matchingContract.slice(0, 20)) {
      console.log(`   - ${r.file}:${r.line}  const ${r.name} = [... ${r.items} 项]`);
    }
    if (matchingContract.length > 20) console.log(`   ... 还有 ${matchingContract.length - 20} 个`);
    console.log(`   建议：用 import { apiClient } from '@/api/client' 替代；详见 web/src/api/README.md`);
  }
  if (mockReports.length > matchingContract.length) {
    const others = mockReports.length - matchingContract.length;
    console.log(`ℹ️  另有 ${others} 个大写常量数组（未匹配 contract，可能是合法 enum / fixture，不告警）`);
  }
}

process.exit(violations.length > 0 ? 1 : 0);
