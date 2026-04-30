// W7.5 R2：v0.7 残留清理回归测试
//
// 背景：v0.8 W3 引入 /design-brief + /design-execute 替代 /import-design，
//   并删除 lovable 通道（强 Supabase 集成与 DDT 后端契约冲突，无 alias 链）。
//   但 W3-W7 多个文件遗漏了清理，4 个 audit agent 在 W7 review 一致发现：
//   - commands/build-web.md / kickoff.md / design.md
//   - skills/frontend-development/SKILL.md
//   - hooks/handlers/session-start.js
//   - templates/tech-stack-presets.yaml / tech-stack-options.yaml / project-brief.template.md
//   - bin/resolve-tech-stack.mjs（AI_DESIGN_STRING_MAP）
//   - USAGE.md / README.md
//
// 本测试锁死：上述"活引用"必须为零；只有以下场景的引用是允许的：
//   1. 历史 CHANGELOG（不可修改的事实记录）
//   2. v0.7→v0.8 breaking change 解释段落（USAGE/README/commands/design-execute/skills/ai-native-design 中明确以"v0.7 / v0.8 删除"语境出现）
//   3. 测试中的负向断言（assert.ok(!includes('lovable')) 这类）
//   4. bin/check-contract-alignment.mjs 中的 anti-pattern 检测（detect lovable supabase mock 仍有用）
//   5. design/static-review-* 历史 review 报告
//   6. baseline/ 历史项目度量数据
//   7. 注释中明确说明"v0.8 删除"
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '../..');

// 扫描扩展名 + 跳过的目录
const EXTS = new Set(['.md', '.js', '.mjs', '.yaml', '.yml', '.json']);
const SKIP_DIRS = new Set(['node_modules', '.git', 'baseline', 'design', 'docs', 'CHANGELOG.md']);
// CHANGELOG.md 顶层文件也跳过（不可改的历史记录）

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    let st;
    try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) {
      yield* walk(full);
    } else if (st.isFile()) {
      const ext = name.slice(name.lastIndexOf('.'));
      if (EXTS.has(ext)) yield full;
    }
  }
}

// 一行允许包含 token 的合法情形
function isAllowedLine(file, line, token) {
  const rel = relative(repoRoot, file);
  // 1. 测试文件：负向断言、字符串字面量、注释允许
  if (rel.startsWith('tests/')) return true;
  // 2. bin/check-contract-alignment.mjs：anti-pattern 检测
  if (rel === 'bin/check-contract-alignment.mjs') return true;
  // 3. v0.7→v0.8 解释段落：行内明确出现 "v0.8" / "v0.7" 算合法
  if (/v0\.[78]/.test(line)) return true;
  // 4. 解释"删除"原因的行（含删/deleted/removed/breaking 关键词）算合法——
  //    通常出现在"v0.7 vs v0.8 差异表"或迁移注释中
  if (/(删除|删\s|deleted|removed|breaking|deprecat)/i.test(line)) return true;
  return false;
}

test('R2: 全仓库无活跃 /import-design 引用（除明确的 v0.7→v0.8 解释段落 + 测试断言）', () => {
  const violations = [];
  for (const file of walk(repoRoot)) {
    const text = readFileSync(file, 'utf8');
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes('/import-design')) {
        if (!isAllowedLine(file, lines[i], '/import-design')) {
          violations.push(`${relative(repoRoot, file)}:${i + 1}: ${lines[i].trim().slice(0, 120)}`);
        }
      }
    }
  }
  assert.equal(violations.length, 0,
    `发现 ${violations.length} 处活跃 /import-design 引用：\n${violations.join('\n')}`);
});

test('R2: 全仓库无活跃 lovable 引用（除明确的 v0.7→v0.8 解释段落 + anti-pattern 检测）', () => {
  const violations = [];
  for (const file of walk(repoRoot)) {
    const text = readFileSync(file, 'utf8');
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (/lovable/i.test(lines[i])) {
        if (!isAllowedLine(file, lines[i], 'lovable')) {
          violations.push(`${relative(repoRoot, file)}:${i + 1}: ${lines[i].trim().slice(0, 120)}`);
        }
      }
    }
  }
  assert.equal(violations.length, 0,
    `发现 ${violations.length} 处活跃 lovable 引用：\n${violations.join('\n')}`);
});

test('R2: tech-stack-presets.yaml ai_design_options 严格 3 通道（claude-design / figma / v0）', () => {
  const text = readFileSync(join(repoRoot, 'templates/tech-stack-presets.yaml'), 'utf8');
  const aiSection = text.split('ai_design_options:')[1] || '';
  const optionLines = aiSection.split('\n').filter(l => /^  [a-z][a-z0-9-]*:/.test(l));
  const optionNames = optionLines.map(l => l.trim().replace(':', ''));
  assert.deepEqual(optionNames.sort(), ['claude-design', 'figma', 'v0'].sort(),
    `ai_design_options 必须严格为 [claude-design, figma, v0]，实际：${optionNames.join(', ')}`);
});

test('R2: bin/resolve-tech-stack.mjs AI_DESIGN_STRING_MAP 不再含 lovable', () => {
  const text = readFileSync(join(repoRoot, 'bin/resolve-tech-stack.mjs'), 'utf8');
  const m = text.match(/AI_DESIGN_STRING_MAP\s*=\s*\{([\s\S]*?)\};/);
  assert.ok(m, 'AI_DESIGN_STRING_MAP 必须存在');
  const block = m[1];
  // 注释中可以提到 lovable（说明迁移），但不能有作为 key 的 'lovable':
  const activeKey = /^\s*['"]lovable['"]\s*:/m.test(block);
  assert.equal(activeKey, false,
    `AI_DESIGN_STRING_MAP 不应再含 'lovable' key（v0.8 W3 删除），实际：\n${block}`);
});
