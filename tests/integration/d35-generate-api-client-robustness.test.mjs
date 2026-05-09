// D35 (v0.9.19)：generate-api-client 健壮性补丁
//   源自演示前 alv-ops 实战暴露的 4 个"温柔的乐观"反模式：
//   A. ensureClientTemplate 没先 mkdir 父目录 → 首次运行 ENOENT
//   B. CLIENT_TEMPLATE 写了 process.env 兜底 → Vite SPA 编译错"找不到名称 process"
//   C. hash 守门只看 contract，不看产物存在性 → 产物被删后 skip 重生
//   D. 包依赖未检测 → IDE 红屏"找不到模块 openapi-fetch"
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GENERATE_BIN = path.resolve(__dirname, '../../bin/generate-api-client.mjs');

function makeProject(opts = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ddt-d35-'));
  fs.mkdirSync(path.join(dir, '.ddt'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'docs'), { recursive: true });
  // 极简但合法的 OpenAPI yaml
  fs.writeFileSync(path.join(dir, 'docs', 'api-contract.yaml'),
    'openapi: 3.0.0\ninfo:\n  title: t\n  version: "1.0"\npaths: {}\n');
  // tech-stack.json：bundler 由 opts 覆盖
  const techStack = {
    frontend: {
      type_generation: 'openapi-typescript',
      bundler: opts.bundler ?? 'vite',
    },
  };
  fs.writeFileSync(path.join(dir, '.ddt', 'tech-stack.json'),
    JSON.stringify(techStack, null, 2));
  // <target>/ 必须存在脚本才不会 exit 2
  const target = opts.target || 'web';
  fs.mkdirSync(path.join(dir, target), { recursive: true });
  if (opts.packageJson) {
    fs.writeFileSync(path.join(dir, target, 'package.json'),
      JSON.stringify(opts.packageJson, null, 2));
  }
  if (opts.lockfile) {
    fs.writeFileSync(path.join(dir, target, opts.lockfile), '');
  }
  return { dir, target };
}

function cleanup(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
}

test('D35-A: 首次运行 web/src/api/ 不存在时不应抛 ENOENT', () => {
  const { dir, target } = makeProject({ bundler: 'vite' });
  try {
    // 不预创建 src/api 目录，让脚本兜底 mkdir
    // 不实际跑 npx openapi-typescript（耗时且需网络）；改 --dry-run 只看不抛错
    const r = spawnSync(process.execPath, [GENERATE_BIN, '--dry-run'],
      { cwd: dir, encoding: 'utf8' });
    assert.equal(r.status, 0, `dry-run 应 exit 0，stderr: ${r.stderr}`);
    assert.match(r.stdout, /mkdir -p .*src\/api/, 'dry-run 描述应提及 mkdir 兜底');
  } finally { cleanup(dir); }
});

test('D35-B: bundler=vite → client.ts 模板不含 process.env', () => {
  // 直接测 buildClientTemplate 函数（避免实际跑 npx 耗时）
  const src = fs.readFileSync(GENERATE_BIN, 'utf8');
  // 找到 envReaderFor 函数，验证 vite 分支
  const viteSnippet = src.match(/b === 'vite'[\s\S]{1,400}?import\.meta\.env/);
  assert.ok(viteSnippet, 'vite 分支应用 import.meta.env');
  // 验证 vite 分支 NOT 含 process.env
  const viteBranch = src.match(/b === 'vite'[\s\S]{1,500}?\}/);
  assert.ok(viteBranch, '应能定位 vite 分支');
  assert.doesNotMatch(viteBranch[0], /process\.env/,
    'D35: Vite 模板必须不含 process.env（避免浏览器代码"找不到名称 process"）');
});

test('D35-B: bundler=next → 模板用 NEXT_PUBLIC_ 前缀', () => {
  const src = fs.readFileSync(GENERATE_BIN, 'utf8');
  assert.match(src, /NEXT_PUBLIC_API_BASE_URL/,
    'Next.js 分支应用 NEXT_PUBLIC_ 前缀（DefinePlugin 编译期替换）');
});

test('D35-B: bundler=webpack → 模板用 REACT_APP_ 前缀', () => {
  const src = fs.readFileSync(GENERATE_BIN, 'utf8');
  assert.match(src, /REACT_APP_API_BASE_URL/,
    'Webpack/CRA 分支应用 REACT_APP_ 前缀');
});

test('D35-B: 未知 bundler → 用字面量兜底（不引入 process）', () => {
  const src = fs.readFileSync(GENERATE_BIN, 'utf8');
  // envReaderFor 函数兜底分支
  assert.match(src, /未识别.*?字面量 fallback/,
    '未知 bundler 应用字面量兜底（保守不引入 process 编译错）');
});

test('D35-C: shouldRegenerate 接受 typesPath 参数（产物缺失时强制重生）', () => {
  const src = fs.readFileSync(GENERATE_BIN, 'utf8');
  assert.match(src, /shouldRegenerate\(contractHash,\s*force,\s*typesPath\)/,
    'shouldRegenerate 签名应含 typesPath');
  assert.match(src, /typesPath\s*&&\s*!existsSync\(typesPath\)/,
    '应在 hash 守门前先校验 types.ts 存在性');
  assert.match(src, /产物 types\.ts 缺失/,
    'reason 文案应说明"产物缺失"');
});

test('D35-D: checkRuntimeDeps 检测 openapi-fetch 缺失 + 按 lockfile 推断 PM', () => {
  const src = fs.readFileSync(GENERATE_BIN, 'utf8');
  assert.match(src, /checkRuntimeDeps/, '应有 checkRuntimeDeps 函数');
  // 验证三种 lockfile 推断分支
  assert.match(src, /yarn\.lock/, '应识别 yarn.lock');
  assert.match(src, /pnpm-lock\.yaml/, '应识别 pnpm-lock.yaml');
  assert.match(src, /package-lock\.json/, '应识别 package-lock.json');
  // 验证生成 hint 用 cd target && pm cmd 形式
  assert.match(src, /cd \$\{target\} && \$\{pm\} \$\{cmd\}/, 'hint 应是可直接复制的精确命令');
});

test('D35-D: 端到端：缺 openapi-fetch + yarn.lock → hint 用 yarn add', () => {
  const { dir } = makeProject({
    bundler: 'vite',
    packageJson: { name: 'web', dependencies: { react: '^18.0.0' } }, // 缺 openapi-fetch
    lockfile: 'yarn.lock',
  });
  try {
    // 不实际跑 npx openapi-typescript（会失败，因为没安装）；
    // 而是预先放好一个空 types.ts 让 hash 守门 skip 重生，进入 ensureClientTemplate + checkRuntimeDeps
    fs.mkdirSync(path.join(dir, 'web', 'src', 'api'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'web', 'src', 'api', 'types.ts'),
      '// stub types.ts for test\nexport type paths = {};\n');
    // 预先写好 state 文件让 hash 命中
    const contractHash = createHash('sha256')
      .update(fs.readFileSync(path.join(dir, 'docs', 'api-contract.yaml')))
      .digest('hex');
    fs.mkdirSync(path.join(dir, '.ddt', 'api-client'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.ddt', 'api-client', 'last-generation.json'),
      JSON.stringify({ contract_sha256: contractHash, generator: 'openapi-typescript' }));

    const r = spawnSync(process.execPath, [GENERATE_BIN],
      { cwd: dir, encoding: 'utf8' });
    assert.equal(r.status, 0, `应 exit 0，stderr: ${r.stderr}`);
    assert.match(r.stdout, /缺 runtime deps：openapi-fetch/,
      '应报告缺 openapi-fetch');
    assert.match(r.stdout, /cd web && yarn add openapi-fetch/,
      'hint 应推断出 yarn add（基于 yarn.lock）');
  } finally { cleanup(dir); }
});

test('D35-D: 端到端：deps 已装 → 不输出 hint', () => {
  const { dir } = makeProject({
    bundler: 'vite',
    packageJson: { name: 'web', dependencies: { 'openapi-fetch': '^0.17.0' } },
    lockfile: 'yarn.lock',
  });
  try {
    fs.mkdirSync(path.join(dir, 'web', 'src', 'api'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'web', 'src', 'api', 'types.ts'),
      '// stub types.ts for test\nexport type paths = {};\n');
    const contractHash = createHash('sha256')
      .update(fs.readFileSync(path.join(dir, 'docs', 'api-contract.yaml')))
      .digest('hex');
    fs.mkdirSync(path.join(dir, '.ddt', 'api-client'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.ddt', 'api-client', 'last-generation.json'),
      JSON.stringify({ contract_sha256: contractHash, generator: 'openapi-typescript' }));

    const r = spawnSync(process.execPath, [GENERATE_BIN],
      { cwd: dir, encoding: 'utf8' });
    assert.equal(r.status, 0);
    assert.doesNotMatch(r.stdout, /缺 runtime deps/,
      'deps 已装时不应警告');
  } finally { cleanup(dir); }
});
