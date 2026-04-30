// W7: v0.8 端到端闭环测试
//
// 模拟真实用户走完整 v0.8 链路（沙箱中跑全部脚本），证明：
//   1. /design-brief → docs/design-brief.md 生成
//   2. /design-execute --channel <X> → 通道附件包派生
//   3. 用户在外部工具完成（沙箱中用假 zip 模拟）
//   4. /design-execute --bundle <zip> → ingest staging
//   5. main thread 改写 web/（沙箱中用预置文件模拟）
//   6. score-design-output → scorecard.json
//   7. tokens-preview HTML 生成
//
// 不模拟：决策门 AskUserQuestion（需 Claude Code 会话）

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { spawnSync, execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');

const BIN = {
  COMPILE: join(ROOT, 'bin', 'compile-design-brief.mjs'),
  DERIVE:  join(ROOT, 'bin', 'derive-channel-package.mjs'),
  INGEST_CD: join(ROOT, 'bin', 'ingest-claude-design.mjs'),
  INGEST_FIGMA: join(ROOT, 'bin', 'ingest-figma-context.mjs'),
  RENDER:  join(ROOT, 'bin', 'render-tokens-preview.mjs'),
  SCORE:   join(ROOT, 'bin', 'score-design-output.mjs'),
};

const SAMPLE_PRD = `# PRD · DemoApp

## 1. 概述
内部审批系统：员工提交申请、审批人审批、状态追踪。

## 4. 用户故事与验收标准

**用户故事**
As a 员工，I want 提交报销申请，so that 财务能尽快审核。

**用户故事**
As a 审批人，I want 一键批量批准，so that 提高效率。

**用户故事**
As a 管理员，I want 查看审批延误统计，so that 优化流程。
`;

const SAMPLE_CONTRACT = `openapi: 3.0.3
info:
  title: Approval API
  version: 1.0.0
paths:
  /api/auth/login:
    post:
      summary: Login
      responses:
        '200': { description: Token }
        '401': { description: Invalid }
  /api/applications:
    get:
      summary: List
      responses:
        '200': { description: OK }
    post:
      summary: Create
      responses:
        '201': { description: Created }
  /api/applications/:id/approve:
    post:
      summary: Approve
      responses:
        '200': { description: OK }
`;

const SAMPLE_TECH_STACK = JSON.stringify({
  preset: 'java-modern',
  backend: { language: 'java', framework: 'spring-boot' },
  frontend: { type: 'spa', framework: 'react' },
}, null, 2);

function setupProject() {
  const tmp = mkdtempSync(join(tmpdir(), 'ddt-e2e-'));
  mkdirSync(join(tmp, 'docs'), { recursive: true });
  mkdirSync(join(tmp, '.ddt'), { recursive: true });
  writeFileSync(join(tmp, 'docs', 'prd.md'), SAMPLE_PRD);
  writeFileSync(join(tmp, 'docs', 'api-contract.yaml'), SAMPLE_CONTRACT);
  writeFileSync(join(tmp, '.ddt', 'tech-stack.json'), SAMPLE_TECH_STACK);
  writeFileSync(join(tmp, '.ddt', 'project-id'), 'proj-e2e-test');
  return tmp;
}

function makeFakeBundle(stagingDir) {
  // 模拟 claude.ai/design 下载的 zip：含 jsx + css + tokens + spec.md
  const projectDir = join(stagingDir, 'project');
  mkdirSync(join(projectDir, 'components'), { recursive: true });
  mkdirSync(join(projectDir, 'stylesheets'), { recursive: true });
  writeFileSync(join(projectDir, 'components', 'app.jsx'),
    'export default function App() { return <div className="bg-primary p-4">Hi</div> }\n');
  writeFileSync(join(projectDir, 'components', 'login-page.jsx'),
    'export default function LoginPage() { return <form><input /></form> }\n');
  writeFileSync(join(projectDir, 'stylesheets', 'tokens.css'),
    ':root {\n  --color-primary: #1F6FEB;\n  --spacing-1: 4px;\n}\n');
  writeFileSync(join(projectDir, 'stylesheets', 'global.css'), 'body { margin: 0 }\n');
  writeFileSync(join(projectDir, 'index.html'),
    '<!DOCTYPE html><html><body><div id="root"></div></body></html>\n');
  writeFileSync(join(projectDir, 'spec.md'),
    '# Design Spec\n## Pages\n- /login\n- /applications\n');

  const zipPath = join(stagingDir, 'design-bundle.zip');
  execFileSync('zip', ['-qr', zipPath, '.'], { cwd: projectDir });
  return zipPath;
}

// ============================================================================
// E2E 流程
// ============================================================================

test('E2E: /design-brief 编译生成 brief + tokens + inventory', () => {
  const tmp = setupProject();
  try {
    const r = spawnSync(process.execPath, [BIN.COMPILE], { cwd: tmp, encoding: 'utf8' });
    assert.equal(r.status, 0, `compile failed: ${r.stderr}`);

    // 3 产物齐全
    assert.ok(existsSync(join(tmp, 'docs', 'design-brief.md')));
    assert.ok(existsSync(join(tmp, '.ddt', 'design', 'tokens.json')));
    assert.ok(existsSync(join(tmp, '.ddt', 'design', 'components-inventory.md')));

    // brief 含 3 个 user stories
    const brief = readFileSync(join(tmp, 'docs', 'design-brief.md'), 'utf8');
    assert.match(brief, /US-01.*员工/);
    assert.match(brief, /US-02.*审批人/);
    assert.match(brief, /US-03.*管理员/);

    // brief 含 4 个 endpoints
    for (const ep of ['POST /api/auth/login', 'GET /api/applications', 'POST /api/applications', 'POST /api/applications/:id/approve']) {
      assert.match(brief, new RegExp(ep.replace(/[/.*]/g, '\\$&')), `必含 ${ep}`);
    }
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('E2E: /design-execute --channel all 派生 3 通道附件包', () => {
  const tmp = setupProject();
  try {
    spawnSync(process.execPath, [BIN.COMPILE], { cwd: tmp, encoding: 'utf8' });
    const r = spawnSync(process.execPath, [BIN.DERIVE, '--channel', 'all'], { cwd: tmp, encoding: 'utf8' });
    assert.equal(r.status, 0, `derive failed: ${r.stderr}`);

    // 3 通道目录
    for (const c of ['claude-design', 'figma', 'v0']) {
      assert.ok(existsSync(join(tmp, '.ddt', 'design', c)), `通道 ${c} 目录必存在`);
    }

    // claude-design 7 文件 + prompt.md
    const cdUpload = join(tmp, '.ddt', 'design', 'claude-design', 'upload-package');
    assert.equal(existsSync(cdUpload), true);
    for (const f of ['01-design-brief.md', '02-prd.md', '03-api-contract.yaml',
                     '04-tech-stack.json', '05-design-tokens.json',
                     '06-components-inventory.md']) {
      assert.ok(existsSync(join(cdUpload, f)), `claude upload-package 必含 ${f}`);
    }

    // claude prompt 含 11 anti-patterns
    const cdPrompt = readFileSync(join(tmp, '.ddt', 'design', 'claude-design', 'prompt.md'), 'utf8');
    const antiCount = (cdPrompt.match(/^\d+\.\s*❌/gm) || []).length;
    assert.equal(antiCount, 11, 'claude prompt 必含 11 条 anti-patterns');

    // figma TC-EBC 5 段
    const figmaPrompt = readFileSync(join(tmp, '.ddt', 'design', 'figma', 'prompt.md'), 'utf8');
    for (const seg of ['## Task', '## Context', '## Elements', '## Behavior', '## Constraints']) {
      assert.match(figmaPrompt, new RegExp(seg.replace('.', '\\.')));
    }

    // v0 sources + project-instructions
    assert.ok(existsSync(join(tmp, '.ddt', 'design', 'v0', 'v0-sources', 'tokens.css')));
    assert.ok(existsSync(join(tmp, '.ddt', 'design', 'v0', 'project-instructions.md')));
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('E2E: /design-execute --bundle <zip> 摄取 Claude Design zip', () => {
  const tmp = setupProject();
  try {
    spawnSync(process.execPath, [BIN.COMPILE], { cwd: tmp, encoding: 'utf8' });
    const zipPath = makeFakeBundle(tmp);

    const r = spawnSync(process.execPath, [BIN.INGEST_CD, '--bundle', zipPath], { cwd: tmp, encoding: 'utf8' });
    assert.equal(r.status, 0, `ingest failed: ${r.stderr}`);

    // staging 目录 + report
    const staging = join(tmp, '.ddt', 'design', 'claude-design', 'raw');
    const reportPath = join(tmp, '.ddt', 'design', 'claude-design', 'ingest-report.json');
    assert.ok(existsSync(staging));
    assert.ok(existsSync(reportPath));

    const report = JSON.parse(readFileSync(reportPath, 'utf8'));
    assert.equal(report.counts.jsx, 2, '摄取 2 个 jsx');
    assert.equal(report.counts.css, 2);
    assert.match(report.files.tokens_css || '', /tokens\.css$/);
    assert.match(report.files.spec_md || '', /spec\.md$/);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('E2E: render-tokens-preview 生成可视化 HTML', () => {
  const tmp = setupProject();
  try {
    spawnSync(process.execPath, [BIN.COMPILE], { cwd: tmp, encoding: 'utf8' });
    const r = spawnSync(process.execPath, [BIN.RENDER], { cwd: tmp, encoding: 'utf8' });
    assert.equal(r.status, 0, `render failed: ${r.stderr}`);

    const html = readFileSync(join(tmp, '.ddt', 'design', 'tokens-preview.html'), 'utf8');
    // 完整 HTML 文档
    assert.match(html, /<!DOCTYPE html>/);
    assert.match(html, /<title>Design Tokens Preview<\/title>/);
    // 6 段必备
    for (const seg of ['Colors (Light)', 'Spacing', 'Radius', 'Typography', 'Shadows', 'Motion']) {
      assert.match(html, new RegExp(seg.replace(/[()]/g, '\\$&')), `必含 ${seg}`);
    }
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('E2E: score-design-output 跑通 10 维评分（带模拟 web/ 项目）', () => {
  const tmp = setupProject();
  try {
    spawnSync(process.execPath, [BIN.COMPILE], { cwd: tmp, encoding: 'utf8' });

    // 在 brief 里手动填 visual_direction（模拟 design-brief-agent 的工作）
    const briefPath = join(tmp, 'docs', 'design-brief.md');
    let brief = readFileSync(briefPath, 'utf8');
    brief = brief.replace(/selected: <[^>]+>/, 'selected: industrial');
    brief = brief.replace(/rationale: <[^>]+>/, 'rationale: 内部审批系统，高密度数据展示优先');
    writeFileSync(briefPath, brief);

    // 模拟 main thread 改写后的 web/
    mkdirSync(join(tmp, 'web', 'components', 'ui'), { recursive: true });
    writeFileSync(join(tmp, 'web', 'app.tsx'), `
export default function App() {
  return (
    <div className="sm:p-4 md:p-4 lg:p-4 xl:p-4 dark:bg-gray-900">
      <button aria-label="Submit" className="bg-primary p-4">Submit</button>
      <img src="logo.png" alt="logo" />
    </div>
  )
}
`);
    writeFileSync(join(tmp, 'web', 'components', 'ui', 'button.tsx'),
      'export function Button() { return <button>x</button> }\n');

    const r = spawnSync(process.execPath, [BIN.SCORE], { cwd: tmp, encoding: 'utf8' });
    assert.equal(r.status, 0, `score failed: ${r.stderr}`);

    const sc = JSON.parse(readFileSync(join(tmp, '.ddt', 'design', 'design-scorecard.json'), 'utf8'));
    // 必备字段
    for (const k of ['total_score', 'max_score', 'passed', 'threshold', 'dimensions']) {
      assert.ok(k in sc, `scorecard 必含 ${k}`);
    }
    // 10 维齐全
    for (const d of ['colors', 'typography', 'spacing', 'components', 'responsive',
                     'dark-mode', 'motion', 'a11y', 'density', 'polish']) {
      assert.ok(sc.dimensions[d], `必含维度 ${d}`);
      assert.ok(typeof sc.dimensions[d].score === 'number');
    }
    assert.equal(sc.max_score, 100);
    assert.ok(sc.total_score >= 0 && sc.total_score <= 100);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('E2E: 完整链路一键跑通（compile → derive → ingest → score）', () => {
  const tmp = setupProject();
  try {
    // Step 1: brief
    let r = spawnSync(process.execPath, [BIN.COMPILE], { cwd: tmp, encoding: 'utf8' });
    assert.equal(r.status, 0, `step1 compile failed: ${r.stderr}`);

    // Step 2: derive claude-design
    r = spawnSync(process.execPath, [BIN.DERIVE, '--channel', 'claude-design'], { cwd: tmp, encoding: 'utf8' });
    assert.equal(r.status, 0, `step2 derive failed: ${r.stderr}`);

    // Step 3: ingest（用假 zip 模拟用户从 claude.ai/design 下载）
    const zipPath = makeFakeBundle(tmp);
    r = spawnSync(process.execPath, [BIN.INGEST_CD, '--bundle', zipPath], { cwd: tmp, encoding: 'utf8' });
    assert.equal(r.status, 0, `step3 ingest failed: ${r.stderr}`);

    // Step 4: 模拟 main thread 改写后的 web/
    mkdirSync(join(tmp, 'web'), { recursive: true });
    writeFileSync(join(tmp, 'web', 'app.tsx'),
      'export default function App() { return <div className="sm:p-4 md:p-4 lg:p-4 xl:p-4">Hi</div> }');

    // Step 5: tokens preview
    r = spawnSync(process.execPath, [BIN.RENDER], { cwd: tmp, encoding: 'utf8' });
    assert.equal(r.status, 0, `step5 render failed: ${r.stderr}`);

    // Step 6: score
    let brief = readFileSync(join(tmp, 'docs', 'design-brief.md'), 'utf8');
    brief = brief.replace(/selected: <[^>]+>/, 'selected: industrial')
                 .replace(/rationale: <[^>]+>/, 'rationale: e2e test');
    writeFileSync(join(tmp, 'docs', 'design-brief.md'), brief);
    r = spawnSync(process.execPath, [BIN.SCORE], { cwd: tmp, encoding: 'utf8' });
    assert.equal(r.status, 0, `step6 score failed: ${r.stderr}`);

    // 最终 6 个产物全在
    const expectedFiles = [
      'docs/design-brief.md',
      '.ddt/design/tokens.json',
      '.ddt/design/components-inventory.md',
      '.ddt/design/claude-design/prompt.md',
      '.ddt/design/claude-design/upload-package/01-design-brief.md',
      '.ddt/design/claude-design/raw/components/app.jsx',
      '.ddt/design/claude-design/ingest-report.json',
      '.ddt/design/tokens-preview.html',
      '.ddt/design/design-scorecard.json',
    ];
    for (const f of expectedFiles) {
      assert.ok(existsSync(join(tmp, f)), `完整链路必产 ${f}`);
    }
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('E2E: figma 通道 ingest URL 写 instructions（main thread 后续读它调 MCP）', () => {
  const tmp = setupProject();
  try {
    spawnSync(process.execPath, [BIN.COMPILE], { cwd: tmp, encoding: 'utf8' });
    spawnSync(process.execPath, [BIN.DERIVE, '--channel', 'figma'], { cwd: tmp, encoding: 'utf8' });

    const r = spawnSync(process.execPath,
      [BIN.INGEST_FIGMA, '--url', 'https://www.figma.com/design/abc123/Demo?node-id=10-20'],
      { cwd: tmp, encoding: 'utf8' });
    assert.equal(r.status, 0, `figma ingest failed: ${r.stderr}`);

    const instructions = readFileSync(join(tmp, '.ddt', 'design', 'figma', 'ingest-instructions.md'), 'utf8');
    assert.match(instructions, /fileKey.*abc123/);
    assert.match(instructions, /nodeId.*10:20/, '- 应转 :');
    assert.match(instructions, /mcp__figma__get_design_context/);
    assert.match(instructions, /mcp__figma__get_screenshot/);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});
