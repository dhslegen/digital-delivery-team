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
// ============================================================================

const CLIENT_TEMPLATE = `// 由 DDT v0.9.13 D30 生成。安全编辑：本文件可手动改（首次创建后不再被覆盖）。
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

// 从环境变量读基础 URL（fallback dev 默认）
const BASE_URL = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_BASE_URL)
  || (typeof process !== 'undefined' && process.env?.VITE_API_BASE_URL)
  || 'http://localhost:8080';

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

function shouldRegenerate(contractHash, force) {
  if (force) return { yes: true, reason: '--force' };
  if (!existsSync(STATE_PATH)) return { yes: true, reason: '首次生成（无 state 文件）' };
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

function ensureClientTemplate(target) {
  const apiDir = join(PROJECT_ROOT, target, 'src', 'api');
  const clientPath = join(apiDir, 'client.ts');
  const readmePath = join(apiDir, 'README.md');
  const created = [];
  if (!existsSync(clientPath)) { writeFileSync(clientPath, CLIENT_TEMPLATE); created.push('client.ts'); }
  if (!existsSync(readmePath)) { writeFileSync(readmePath, README_TEMPLATE); created.push('README.md'); }
  return created;
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
    console.log('1. 读 .ddt/tech-stack.json::frontend.type_generation');
    console.log('2. 读 docs/api-contract.yaml + 计算 SHA256');
    console.log('3. 对比 .ddt/api-client/last-generation.json 中的 hash');
    console.log('4. hash 不同或 --force → 跑 npx openapi-typescript -o ' + target + '/src/api/types.ts');
    console.log('5. 首次创建 ' + target + '/src/api/client.ts 模板（不覆盖已有）');
    console.log('6. 写 ' + target + '/src/api/README.md（首次）');
    console.log('7. 更新 .ddt/api-client/last-generation.json');
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

  // Step 2: hash 守门
  const contractHash = sha256OfFile(CONTRACT);
  const decision = shouldRegenerate(contractHash, args.force);
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

  // Step 4: client.ts + README 模板（首次）
  const created = ensureClientTemplate(target);
  if (created.length > 0) {
    console.log(`▶ 创建模板: ${created.join(', ')}`);
  }

  // Step 5: 状态落盘
  writeState(contractHash, generator);

  // Step 6: 输出 hint
  console.log('');
  console.log('✅ API client 就绪');
  console.log(`   types: ${target}/src/api/types.ts`);
  console.log(`   client: ${target}/src/api/client.ts`);
  console.log(`   提醒：在组件内 import { apiClient } from '@/api/client'；勿用 mock const 数组替代`);

  process.exit(0);
}

main().catch(e => {
  console.error('❌ 未捕获异常:', e);
  process.exit(1);
});
