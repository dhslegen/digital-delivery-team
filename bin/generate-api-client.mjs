#!/usr/bin/env node
// DDT v0.9.13 D30 · 把 tech-stack.json::type_generation 从声明翻译为实际产出
//
// 用途：在 /build-web Phase 1 EXPLORE 自动跑——确保 web/src/api/types.ts
// 是 docs/api-contract.yaml 的强类型映射，让 LLM 在 PLAN/IMPLEMENT 时有具体
// 类型签名，自然不会去抄 prototype 的 mock 数据。
//
// 设计哲学：
//   - 配置 driven：tech-stack.json::frontend.type_generation 决定走哪条路径
//   - 哈希守门：contract 未变 → 不重生（避免脏 git diff）
//   - 失败不阻塞：generate 失败 hint 用户手动跑而非 fail-fast
//   - 仅创建模板：client.ts 只在不存在时创建（不覆盖用户改动）
//
// 用法：
//   node bin/generate-api-client.mjs                 # 默认行为
//   node bin/generate-api-client.mjs --dry-run       # 仅输出计划
//   node bin/generate-api-client.mjs --force         # 忽略 hash 强制重生
//   node bin/generate-api-client.mjs --target=app    # 改目标目录（默认 web）
//
// 退出码：
//   0 成功（含 skip）
//   1 参数错误
//   2 配置不全（tech-stack / contract 缺失）
//   3 generate 命令失败（npx openapi-typescript / orval 失败）

import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const PROJECT_ROOT = process.cwd();
const TECH_STACK = join(PROJECT_ROOT, '.ddt', 'tech-stack.json');
const CONTRACT = join(PROJECT_ROOT, 'docs', 'api-contract.yaml');
const STATE_DIR = join(PROJECT_ROOT, '.ddt', 'api-client');
const STATE_PATH = join(STATE_DIR, 'last-generation.json');

function parseArgs(argv) {
  const args = { _: [] };
  for (const a of argv) {
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=');
      args[k] = v ?? true;
    } else args._.push(a);
  }
  return args;
}

function sha256OfFile(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function readJson(path, fallback = null) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return fallback; }
}

function ensureDir(p) { mkdirSync(p, { recursive: true }); }

// ============================================================================
// 模板：openapi-fetch client.ts（首次创建用）
// D35 (v0.9.19)：按 bundler 派生不同环境变量读取方式——避免 Vite SPA 项目里
//   `process.env` 报"找不到名称 process"。bundler 推断来自 tech-stack.json::frontend.bundler。
// ============================================================================

function envReaderFor(bundler) {
  // Vite/Vite-based（含 vitest / nuxt 3）：浏览器代码无 process 全局，import.meta.env 是规范
  // Webpack/Next.js：DefinePlugin 把 process.env.X 在编译期替换为字面量，TypeScript 端需 @types/node 或 globalThis 声明
  // 兜底：纯字面量（无环境变量）
  if (!bundler) return { snippet: `'http://localhost:8080'`, comment: '未声明 bundler，使用字面量 fallback' };
  const b = String(bundler).toLowerCase();
  if (b === 'vite' || b === 'vitest' || b === 'nuxt' || b === 'astro') {
    return {
      snippet: `import.meta.env?.VITE_API_BASE_URL || 'http://localhost:8080'`,
      comment: 'Vite 系：只用 import.meta.env（浏览器代码无 process 全局）',
    };
  }
  if (b === 'next' || b === 'nextjs' || b === 'next.js') {
    return {
      snippet: `process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8080'`,
      comment: 'Next.js：用 NEXT_PUBLIC_ 前缀，由 DefinePlugin 编译期替换为字面量',
    };
  }
  if (b === 'webpack' || b === 'cra' || b === 'create-react-app') {
    return {
      snippet: `process.env.REACT_APP_API_BASE_URL || 'http://localhost:8080'`,
      comment: 'Webpack/CRA：用 REACT_APP_ 前缀，由 DefinePlugin 编译期替换',
    };
  }
  // 未识别 bundler：保守用字面量，避免引入 process 编译错
  return { snippet: `'http://localhost:8080'`, comment: `bundler=${bundler} 未识别，使用字面量 fallback（请在此手动接环境变量读取）` };
}

function buildClientTemplate(bundler) {
  const env = envReaderFor(bundler);
  return `// 由 DDT 生成（bundler=${bundler || 'unknown'}）。安全编辑：本文件可手动改（首次创建后不再被覆盖）。
// 强类型来源：./types.ts（每次 contract 变更自动重生）
//
// 用法（在组件内）：
//   import { apiClient } from '@/api/client';
//   const { data, error } = await apiClient.GET('/users', { params: { query: { page: 1 } } });
//
// 与 react-query 配合（推荐，符合 tech-stack.json::data_fetching=tanstack-query）：
//   import { useQuery } from '@tanstack/react-query';
//   const usersQuery = useQuery({
//     queryKey: ['users', page],
//     queryFn: async () => {
//       const { data, error } = await apiClient.GET('/users', { params: { query: { page } } });
//       if (error) throw error;
//       return data;
//     },
//   });

import createClient from 'openapi-fetch';
import type { paths } from './types';

// ${env.comment}
const BASE_URL = ${env.snippet};

export const apiClient = createClient<paths>({
  baseUrl: BASE_URL,
  // 注入鉴权 token（如有）：
  // headers: { Authorization: \`Bearer \${getToken()}\` },
});

// 工具函数：把 openapi-fetch 风格的 { data, error } 转抛错（适配 react-query queryFn）
export async function unwrap<T>(promise: Promise<{ data?: T; error?: unknown }>): Promise<T> {
  const { data, error } = await promise;
  if (error) throw error;
  if (data === undefined) throw new Error('API returned undefined data');
  return data;
}
`;
}

const README_TEMPLATE = `# web/src/api/

由 DDT v0.9.13 D30 \`/build-web\` Phase 1 EXPLORE 自动维护。

## 文件

| 文件 | 来源 | 是否可手编辑 |
|---|---|---|
| \`types.ts\` | \`docs/api-contract.yaml\` 通过 \`openapi-typescript\` 自动生成 | ❌ 自动覆盖（contract 变更时） |
| \`client.ts\` | DDT 模板首次创建 | ✅ 可改（baseUrl / 鉴权 / 拦截器） |
| \`README.md\` | DDT 模板 | ✅ 可改 |

## 重生策略

DDT 用 SHA256 守门：\`docs/api-contract.yaml\` 未变 → 不重生 \`types.ts\`。
强制重生：\`node $DDT_PLUGIN_ROOT/bin/generate-api-client.mjs --force\`

## 反模式提醒

- ❌ **不要把 prototype 的 mock 数组复制到生产代码**（如 \`const VEHICLES = [...]\`）；该用 \`apiClient.GET('/vehicles')\`
- ❌ **不要绕过 apiClient 直接 fetch / axios**（破坏类型安全 + 重复鉴权逻辑）
- ❌ **不要手编辑 types.ts**（下次 generate 会覆盖）

## 与 tech-stack.json 对齐

\`tech-stack.json::frontend.type_generation\` = \`openapi-typescript\` → 本目录是其落地。
\`tech-stack.json::frontend.data_fetching\` = \`tanstack-query\` → 推荐用 react-query 包 apiClient（见 client.ts 注释）。
`;

// ============================================================================
// 主流程
// ============================================================================

function detectGenerator(techStack) {
  const t = techStack?.frontend?.type_generation || techStack?.type_generation;
  if (!t || t === 'none') return null;
  // 当前支持：openapi-typescript（首选，对齐 v0.9.13 D30 决策）
  if (t === 'openapi-typescript') return { kind: 'openapi-typescript', npmDevDeps: ['openapi-typescript'], npmRuntimeDeps: ['openapi-fetch'] };
  // orval 留作未来支持（v0.9.14+）
  if (t === 'orval') return { kind: 'orval', hint: 'orval 暂未实装；请手动配置 orval.config.ts 或换 openapi-typescript' };
  return { kind: 'unknown', hint: `type_generation=${t} 未识别；当前支持：openapi-typescript` };
}

function shouldRegenerate(contractHash, force, typesPath) {
  if (force) return { yes: true, reason: '--force' };
  if (!existsSync(STATE_PATH)) return { yes: true, reason: '首次生成（无 state 文件）' };
  // D35 (v0.9.19)：hash 守门只看契约不看产物——若 types.ts 被外部删除（git stash / git clean / 手误），
  //   原版会"hash 命中 → skip 重生 → 产物永不出现"。加产物存在性校验。
  if (typesPath && !existsSync(typesPath)) return { yes: true, reason: `产物 types.ts 缺失（被外部删除）` };
  const last = readJson(STATE_PATH, {});
  if (last.contract_sha256 !== contractHash) return { yes: true, reason: `contract 已变更（hash 不同）` };
  return { yes: false, reason: `contract 未变（hash=${contractHash.slice(0, 12)}...）` };
}

function runOpenApiTypescript(target) {
  const typesPath = join(PROJECT_ROOT, target, 'src', 'api', 'types.ts');
  ensureDir(dirname(typesPath));
  const r = spawnSync('npx', ['--yes', 'openapi-typescript@7', CONTRACT, '-o', typesPath], {
    cwd: PROJECT_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (r.status !== 0) {
    return { ok: false, error: `npx openapi-typescript 失败: ${r.stderr || r.stdout}`.slice(0, 500) };
  }
  const linesGenerated = existsSync(typesPath) ? readFileSync(typesPath, 'utf8').split('\n').length : 0;
  return { ok: true, typesPath, linesGenerated };
}

function ensureClientTemplate(target, bundler) {
  const apiDir = join(PROJECT_ROOT, target, 'src', 'api');
  // D35 (v0.9.19)：父目录可能不存在（首次运行 / 用户清理 / 全新 scaffold）；
  //   原版 writeFileSync 会抛 ENOENT。统一先 mkdir 兜底。
  ensureDir(apiDir);
  const clientPath = join(apiDir, 'client.ts');
  const readmePath = join(apiDir, 'README.md');
  const created = [];
  if (!existsSync(clientPath)) { writeFileSync(clientPath, buildClientTemplate(bundler)); created.push('client.ts'); }
  if (!existsSync(readmePath)) { writeFileSync(readmePath, README_TEMPLATE); created.push('README.md'); }
  return created;
}

// D35 (v0.9.19)：检测 <target>/package.json 是否含必需 runtime deps（如 openapi-fetch）；
//   缺失则按 lockfile 推断 PM 给出精确安装命令——避免用户跑完脚本后 IDE 红屏 + 不知用哪个 PM。
function checkRuntimeDeps(target, generator) {
  const pkgPath = join(PROJECT_ROOT, target, 'package.json');
  if (!existsSync(pkgPath)) {
    return { ok: true, missing: [], hint: null }; // 没 package.json 不报，让用户自己处理
  }
  const pkg = readJson(pkgPath, {});
  const allDeps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  const missing = (generator.npmRuntimeDeps || []).filter(d => !allDeps[d]);
  if (missing.length === 0) return { ok: true, missing: [], hint: null };

  // 推断 package manager：lockfile 优先
  const yarnLock = existsSync(join(PROJECT_ROOT, target, 'yarn.lock'));
  const pnpmLock = existsSync(join(PROJECT_ROOT, target, 'pnpm-lock.yaml'));
  const npmLock  = existsSync(join(PROJECT_ROOT, target, 'package-lock.json'));
  let pm = 'npm';
  let cmd = 'install';
  if (yarnLock) { pm = 'yarn'; cmd = 'add'; }
  else if (pnpmLock) { pm = 'pnpm'; cmd = 'add'; }
  else if (npmLock) { pm = 'npm'; cmd = 'install'; }

  const hint = `cd ${target} && ${pm} ${cmd} ${missing.join(' ')}`;
  return { ok: false, missing, hint };
}

function writeState(contractHash, generator) {
  ensureDir(STATE_DIR);
  writeFileSync(STATE_PATH, JSON.stringify({
    contract_sha256: contractHash,
    generator: generator.kind,
    generated_at: new Date().toISOString(),
    plugin_version: '0.9.13',
  }, null, 2));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const target = args.target || 'web';

  if (args['dry-run']) {
    console.log('# generate-api-client.mjs --dry-run');
    console.log('1. 读 .ddt/tech-stack.json::frontend.{type_generation, bundler}');
    console.log('2. 读 docs/api-contract.yaml + 计算 SHA256');
    console.log('3. 对比 .ddt/api-client/last-generation.json 中的 hash + 校验产物 types.ts 存在性（D35）');
    console.log('4. hash 不同 / 产物缺失 / --force → 跑 npx openapi-typescript -o ' + target + '/src/api/types.ts');
    console.log('5. mkdir -p ' + target + '/src/api/（D35 兜底）+ 首次创建 client.ts 按 bundler 派生模板（D35：vite 不写 process.env）');
    console.log('6. 写 ' + target + '/src/api/README.md（首次）');
    console.log('7. 更新 .ddt/api-client/last-generation.json');
    console.log('8. 检测 ' + target + '/package.json 缺的 runtime deps（如 openapi-fetch），按 lockfile 推断 PM 给精确安装命令（D35）');
    process.exit(0);
  }

  // Step 1: 配置完整性
  if (!existsSync(TECH_STACK)) {
    console.error('❌ 缺 .ddt/tech-stack.json，先跑 /design');
    process.exit(2);
  }
  const techStack = readJson(TECH_STACK);
  const generator = detectGenerator(techStack);
  if (!generator) {
    console.log('ℹ️  tech-stack.json::frontend.type_generation 未声明或为 none；跳过生成');
    process.exit(0);
  }
  if (generator.kind !== 'openapi-typescript') {
    console.log(`ℹ️  ${generator.hint || generator.kind + ' 暂未实装'}；跳过自动生成`);
    process.exit(0);
  }
  if (!existsSync(CONTRACT)) {
    console.error('❌ 缺 docs/api-contract.yaml，先跑 /design');
    process.exit(2);
  }
  if (!existsSync(join(PROJECT_ROOT, target))) {
    console.error(`❌ ${target}/ 目录不存在；先 scaffold 前端工程或用 --target=<dir> 改路径`);
    process.exit(2);
  }

  // Step 2: hash 守门（D35：加产物存在性校验，避免外部删除后 hash 命中 skip）
  const contractHash = sha256OfFile(CONTRACT);
  const typesPath = join(PROJECT_ROOT, target, 'src', 'api', 'types.ts');
  const decision = shouldRegenerate(contractHash, args.force, typesPath);
  console.log(`▶ contract hash: ${contractHash.slice(0, 12)}... (${decision.reason})`);

  let typesResult = { skipped: true };
  if (decision.yes) {
    // Step 3: generate
    console.log(`▶ 跑 openapi-typescript → ${target}/src/api/types.ts`);
    typesResult = runOpenApiTypescript(target);
    if (!typesResult.ok) {
      console.error(`⚠️  ${typesResult.error}`);
      console.error(`💡 手动跑: npx openapi-typescript ${CONTRACT} -o ${target}/src/api/types.ts`);
      process.exit(3);
    }
    console.log(`  ✅ 生成 ${typesResult.linesGenerated} 行 types`);
  } else {
    console.log(`  ⏭️  types.ts 已是最新（contract 未变）`);
  }

  // Step 4: client.ts + README 模板（首次；D35：按 bundler 派生避免 process.env 编译错）
  const bundler = techStack?.frontend?.bundler;
  const created = ensureClientTemplate(target, bundler);
  if (created.length > 0) {
    console.log(`▶ 创建模板: ${created.join(', ')}（bundler=${bundler || 'unknown'}）`);
  }

  // Step 5: 状态落盘
  writeState(contractHash, generator);

  // Step 6: D35：runtime deps 检测——缺 openapi-fetch 等会导致 IDE 红屏，提前给出精确 PM 命令
  const depsCheck = checkRuntimeDeps(target, generator);

  // Step 7: 输出 hint
  console.log('');
  console.log('✅ API client 就绪');
  console.log(`   types: ${target}/src/api/types.ts`);
  console.log(`   client: ${target}/src/api/client.ts`);
  if (!depsCheck.ok) {
    console.log('');
    console.log(`⚠️  缺 runtime deps：${depsCheck.missing.join(', ')}`);
    console.log(`   请运行：${depsCheck.hint}`);
  }
  console.log(`   提醒：在组件内 import { apiClient } from '@/api/client'；勿用 mock const 数组替代`);

  process.exit(0);
}

main().catch(e => {
  console.error('❌ 未捕获异常:', e);
  process.exit(1);
});
