// W7.5 Block C：模板真实性测试
//
// R3: scanComponents 真把扫描结果写入 inventory（之前是模板硬编码 5 行）
// R4: deriveV0 同时生成 openapi-types.ts（之前 v0 模板 import 它但派生器不生成）
// R8: parseBriefMeta 过滤 <foo> 占位符（之前抽到 `<persona>` 字面字符串塞进 prompt）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../..');

const { renderInventory } = await import(join(repoRoot, 'bin/compile-design-brief.mjs'));
const { isPlaceholder, parseBriefMeta } = await import(join(repoRoot, 'bin/derive-channel-package.mjs'));

// ─── R3: inventory 真实扫描 ──────────────────────────

test('R3: renderInventory 把扫描到的 shadcn 组件写入 marker 之间（不是硬编码示例）', () => {
  const template = readFileSync(join(repoRoot, 'templates/components-inventory.template.md'), 'utf8');
  const components = {
    shadcn: [
      { name: 'foo-bar', path: 'web/components/ui/foo-bar.tsx' },
      { name: 'baz',     path: 'web/components/ui/baz.tsx' },
    ],
    custom: [],
    hasShadcn: true,
  };
  const out = renderInventory(template, components, {
    projectName: 'test-proj', generatedAt: '2026-04-30T00:00:00Z',
  });

  // 扫到的组件出现在表格里
  assert.match(out, /\| FooBar \| `web\/components\/ui\/foo-bar\.tsx` \|/);
  assert.match(out, /\| Baz \| `web\/components\/ui\/baz\.tsx` \|/);

  // 模板硬编码的 Form / Dialog 不应出现（被替换掉了）
  assert.doesNotMatch(out, /\| Form \| `web\/components\/ui\/form\.tsx`/,
    '模板硬编码的 Form 行应被扫描结果替换');
  assert.doesNotMatch(out, /\| Dialog \| `web\/components\/ui\/dialog\.tsx`/,
    '模板硬编码的 Dialog 行应被扫描结果替换');

  // marker 必须保留（让下次 refresh 还能命中）
  assert.match(out, /<!-- AUTO_SHADCN_TABLE_START -->/);
  assert.match(out, /<!-- AUTO_SHADCN_TABLE_END -->/);
});

test('R3: renderInventory 把扫描到的 custom 组件写入 §2 marker 之间', () => {
  const template = readFileSync(join(repoRoot, 'templates/components-inventory.template.md'), 'utf8');
  const components = {
    shadcn: [],
    custom: [
      { name: 'data-table',     path: 'web/components/data-table.tsx' },
      { name: 'empty-state',    path: 'web/components/empty-state.tsx' },
    ],
    hasShadcn: false,
  };
  const out = renderInventory(template, components, {
    projectName: 'test-proj', generatedAt: '2026-04-30T00:00:00Z',
  });

  // 扫到的 custom 出现
  assert.match(out, /\| `<DataTable>` \| `web\/components\/data-table\.tsx` \|/);
  assert.match(out, /\| `<EmptyState>` \| `web\/components\/empty-state\.tsx` \|/);
  // 示例条目消失
  assert.doesNotMatch(out, /\| `<ErrorBoundary>` \|.*?error-boundary\.tsx/,
    '模板硬编码 ErrorBoundary 应被替换');
});

test('R3: 空扫描时 inventory 显示明确占位（而非假数据）', () => {
  const template = readFileSync(join(repoRoot, 'templates/components-inventory.template.md'), 'utf8');
  const components = { shadcn: [], custom: [], hasShadcn: false };
  const out = renderInventory(template, components, {
    projectName: 'empty-proj', generatedAt: '2026-04-30T00:00:00Z',
  });
  assert.match(out, /未扫描到 shadcn\/ui 组件/);
  assert.match(out, /未扫描到 custom 组件/);
  // 一定不能保留模板硬编码示例
  assert.doesNotMatch(out, /\| Button \| `web\/components\/ui\/button\.tsx`/);
});

test('R3: inventory 模板含两个 marker（template structure contract）', () => {
  const template = readFileSync(join(repoRoot, 'templates/components-inventory.template.md'), 'utf8');
  assert.match(template, /<!-- AUTO_SHADCN_TABLE_START -->/);
  assert.match(template, /<!-- AUTO_SHADCN_TABLE_END -->/);
  assert.match(template, /<!-- AUTO_CUSTOM_TABLE_START -->/);
  assert.match(template, /<!-- AUTO_CUSTOM_TABLE_END -->/);
});

// ─── R8: isPlaceholder 占位符过滤 ──────────────────────────

test('R8: isPlaceholder 识别 <foo> 形式占位符', () => {
  assert.equal(isPlaceholder('<persona>'), true);
  assert.equal(isPlaceholder('<填写 Given/When/Then>'), true);
  assert.equal(isPlaceholder('<待填>'), true);
  assert.equal(isPlaceholder('<未填写>'), true);
});

test('R8: isPlaceholder 识别中文占位语', () => {
  assert.equal(isPlaceholder('待填'), true);
  assert.equal(isPlaceholder('未填'), true);
  assert.equal(isPlaceholder('TODO'), true);
  assert.equal(isPlaceholder('TBD'), true);
  assert.equal(isPlaceholder('无'), true);
});

test('R8: isPlaceholder 识别空值', () => {
  assert.equal(isPlaceholder(''), true);
  assert.equal(isPlaceholder('   '), true);
  assert.equal(isPlaceholder(null), true);
  assert.equal(isPlaceholder(undefined), true);
});

test('R8: isPlaceholder 不误伤真实内容', () => {
  assert.equal(isPlaceholder('设计师 Alice'), false);
  assert.equal(isPlaceholder('5px'), false);
  assert.equal(isPlaceholder('industrial'), false);
  // 含 < > 但不是占位符（如 `Input < 100`）
  assert.equal(isPlaceholder('<HTML>tag with content</HTML>'), false);
  // 只有起止 < > 包整个值才算占位
  assert.equal(isPlaceholder('a<b'), false);
});

test('R8: parseBriefMeta 把 <persona> 占位符过滤为空（不是字面字符串）', () => {
  // 模拟 brief 完全未填的情况
  const briefText = `# Design Brief · test\n\n## 1. Problem Alignment\n\n- **用户**：<persona>\n- **痛点**：<pain point>\n\n## 2. User Stories\n\n## 3. Foo\n`;
  const meta = parseBriefMeta(briefText);
  assert.equal(meta.persona, '', 'persona 应为空字符串而非 "<persona>"');
  assert.equal(meta.painPoint, '', 'painPoint 应为空字符串而非 "<pain point>"');
});

test('R8: parseBriefMeta 保留真实填充的内容', () => {
  const briefText = `# Design Brief · test\n\n## 1. Problem Alignment\n\n- **用户**：项目经理 Daisy（35 岁，3 年远程团队管理经验）\n- **痛点**：跨时区协调任务延期\n\n## 2. User Stories\n\n## 3. Foo\n`;
  const meta = parseBriefMeta(briefText);
  assert.match(meta.persona, /项目经理 Daisy/);
  assert.match(meta.painPoint, /跨时区/);
});

test('R8: parseBriefMeta 对 visual_direction 占位符过滤', () => {
  const briefText = `## 8. Visual Direction\n\n\`\`\`yaml\nvisual_direction:\n  selected: <选 1 个>\n  rationale: <写理由>\n\`\`\`\n`;
  const meta = parseBriefMeta(briefText);
  assert.equal(meta.visualDirection, '');
  assert.equal(meta.visualRationale, '');
});

// ─── R4: openapi-types.ts 在 v0 派生时同时生成 ──────────────────────────

test('R4: deriveV0 dry-run 报告 openapi-types.ts 为预期输出之一', () => {
  // dry-run 跑过 derive-channel-package.mjs --channel v0 --dry-run，应在输出中提到 openapi-types.ts
  const sandbox = mkdtempSync(join(tmpdir(), 'ddt-r4-v0-'));
  try {
    mkdirSync(join(sandbox, 'docs'), { recursive: true });
    mkdirSync(join(sandbox, '.ddt', 'design'), { recursive: true });
    writeFileSync(join(sandbox, 'docs/prd.md'), '# PRD\n\n**用户故事**：As a user, I want X, so that Y.\n');
    writeFileSync(join(sandbox, 'docs/api-contract.yaml'),
      'openapi: 3.0.0\ninfo:\n  title: t\n  version: "1"\npaths:\n  /foo:\n    get:\n      responses:\n        "200":\n          description: ok\n');
    writeFileSync(join(sandbox, 'docs/design-brief.md'),
      `# Design Brief\n\n## 1. Problem Alignment\n- **用户**：测试用户\n- **痛点**：测试痛点\n\n## 2. User Stories\n\n## 3. Information Architecture\n\n## 8. Visual Direction\n\n\`\`\`yaml\nvisual_direction:\n  selected: industrial\n  rationale: 测试\n\`\`\`\n`);
    writeFileSync(join(sandbox, '.ddt/tech-stack.json'),
      '{"preset":"node-modern","frontend":{"type":"spa"},"ai_design":{"type":"v0"}}');
    writeFileSync(join(sandbox, '.ddt/design/tokens.json'),
      '{"color":{"primary":"#2C3F4C","danger":"#A83232","success":"#4F7042"},"radius":{"sm":"4px"},"spacing":[2,4,8]}');
    writeFileSync(join(sandbox, '.ddt/design/components-inventory.md'), '# Inventory\n');

    const r = spawnSync(process.execPath,
      [join(repoRoot, 'bin/derive-channel-package.mjs'), '--channel', 'v0', '--dry-run'],
      { cwd: sandbox, encoding: 'utf8' });

    assert.equal(r.status, 0, `v0 dry-run 应 exit 0，实际 ${r.status}；stderr: ${r.stderr}`);
    assert.match(r.stdout, /openapi-types\.ts/,
      'v0 通道 dry-run 输出必须包含 openapi-types.ts（W7.5 R4 修复）');
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});

test('R4: deriveV0 在 yaml 不存在时不抛异常（容错）', () => {
  // 仅删 yaml 模拟 unhappy path：派生应继续，warning 但 exit 0
  const sandbox = mkdtempSync(join(tmpdir(), 'ddt-r4-v0-fail-'));
  try {
    mkdirSync(join(sandbox, 'docs'), { recursive: true });
    mkdirSync(join(sandbox, '.ddt', 'design'), { recursive: true });
    writeFileSync(join(sandbox, 'docs/prd.md'), '# PRD\n');
    // 注意：不写 api-contract.yaml；派生器顶层校验会拦下 → 这条用例改为：
    //   写一个空的 yaml，让 derive 内部 openapi-typescript 失败
    writeFileSync(join(sandbox, 'docs/api-contract.yaml'), 'invalid yaml content not openapi');
    writeFileSync(join(sandbox, 'docs/design-brief.md'),
      `# Design Brief\n\n## 1. Problem Alignment\n- **用户**：A\n- **痛点**：B\n\n## 2. User Stories\n\n## 3. IA\n\n## 8. Visual Direction\n\n\`\`\`yaml\nvisual_direction:\n  selected: industrial\n  rationale: t\n\`\`\`\n`);
    writeFileSync(join(sandbox, '.ddt/tech-stack.json'),
      '{"preset":"node-modern","frontend":{"type":"spa"},"ai_design":{"type":"v0"}}');
    writeFileSync(join(sandbox, '.ddt/design/tokens.json'),
      '{"color":{"primary":"#2C3F4C"},"spacing":[2,4]}');
    writeFileSync(join(sandbox, '.ddt/design/components-inventory.md'), '# Inventory\n');

    // 真跑（非 dry-run）— 让 openapi-typescript 实际执行
    const r = spawnSync(process.execPath,
      [join(repoRoot, 'bin/derive-channel-package.mjs'), '--channel', 'v0'],
      { cwd: sandbox, encoding: 'utf8', timeout: 90_000 });

    // 即便 openapi-typescript 失败也应 exit 0（警告但不阻塞）
    assert.equal(r.status, 0,
      `v0 派生应在 openapi-types 失败时仍 exit 0（容错），实际 ${r.status}；stderr: ${r.stderr}`);
    // 其他 v0 产物（project-instructions / prompt）仍应生成
    assert.ok(existsSync(join(sandbox, '.ddt/design/v0/v0-sources/openapi.yaml')),
      'v0 通道核心产物 openapi.yaml 拷贝必须成功');
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});
