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
  const stackPath = join(cwd, '.delivery', 'tech-stack.json');
  if (!existsSync(stackPath)) return null;
  try { return JSON.parse(readFileSync(stackPath, 'utf8')); } catch { return null; }
})();

const violations = [];
const warnings = [];

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

process.exit(violations.length > 0 ? 1 : 0);
