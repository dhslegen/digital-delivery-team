#!/usr/bin/env node
// W4: v0 通道摄取器（包装 npx shadcn add）
//
// 输入：v0.dev share URL（用户在 v0 完成单屏后复制）
//   合法格式：https://v0.dev/chat/b/<BLOCK_ID>
//             https://v0.dev/chat/api/open?url=<registry>
//
// 输出：
//   web/components/ui/* 由 shadcn CLI 拉入（如果项目根有 web/）
//   .ddt/design/v0/ingest-history.jsonl 累计每次 share URL 摄取记录
//
// 设计原则：v0 share URL 通过 npx shadcn@latest add 一行命令完全脱离 v0 网页拉组件，
//   DDT 只做 URL 校验 + 调度 + 记录历史；不直接改写代码（W5 main thread 处理）。
//
// 用法：
//   node bin/ingest-v0-share.mjs --url <v0-share-url>
//   node bin/ingest-v0-share.mjs --url <url> --target web/   # 默认 web/
//   node bin/ingest-v0-share.mjs --url <url> --dry-run       # 不实际拉，只校验 + 打印
//
// 退出码：
//   0 = 成功
//   1 = 参数错误（URL 格式 / 协议不合法）
//   2 = 目标目录不存在
//   3 = npx 不可用
//   4 = shadcn add 失败

import { existsSync, appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

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

// URL 白名单：仅 v0.dev / vercel.com 域名 + http(s) 协议 + 标准 URL 字符
// 拒绝 shell 元字符（;、|、`、$、空格等）
export function isValidV0Url(url) {
  if (typeof url !== 'string' || url.length > 2048) return false;
  if (!/^https:\/\//.test(url)) return false;
  // 域名白名单
  const m = url.match(/^https:\/\/([^/]+)\//);
  if (!m) return false;
  const host = m[1].toLowerCase();
  const allowedHosts = ['v0.dev', 'vercel.com', 'v0.app'];
  if (!allowedHosts.some(h => host === h || host.endsWith(`.${h}`))) return false;
  // 严格白名单：去掉 shell 元字符（; ( ) $ * + , 等），即便 RFC 3986 允许
  // 实际 v0 share URL 只用 / ? = & # % - 等核心字符
  if (!/^https:\/\/[A-Za-z0-9._~:/?#@!&'=%-]+$/.test(url)) return false;
  return true;
}

function checkNpx() {
  try {
    execFileSync('npx', ['--version'], { stdio: ['pipe', 'pipe', 'pipe'] });
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cwd = process.cwd();

  const url = args.url;
  if (!url) {
    console.error(`❌ --url <v0-share-url> 必填`);
    process.exit(1);
  }

  if (!isValidV0Url(url)) {
    console.error(`❌ URL 不合法（域名必须是 v0.dev/vercel.com/v0.app，且协议为 https）：${url}`);
    process.exit(1);
  }

  const target = args.target || 'web';
  const targetPath = join(cwd, target);
  if (!existsSync(targetPath)) {
    console.error(`❌ 目标目录不存在: ${targetPath}（请先 scaffold web/ 项目）`);
    process.exit(2);
  }

  // 检查 web/components.json（shadcn 注册表）
  const componentsJson = join(targetPath, 'components.json');
  if (!existsSync(componentsJson)) {
    console.error(`⚠️  ${componentsJson} 不存在；shadcn add 可能会失败`);
    console.error(`   请先在 ${target}/ 跑 'npx shadcn@latest init' 初始化`);
  }

  if (!checkNpx()) {
    console.error(`❌ npx 不可用（需要 Node.js + npm）`);
    process.exit(3);
  }

  if (args['dry-run']) {
    console.log(`--- DRY RUN ---`);
    console.log(`URL: ${url}`);
    console.log(`Target: ${targetPath}`);
    console.log(`将运行: npx shadcn@latest add "${url}"（cwd=${target}）`);
    process.exit(0);
  }

  // 执行 shadcn add
  console.log(`▶ 调用 shadcn CLI 拉取 v0 组件...`);
  console.log(`  cwd: ${target}`);
  console.log(`  url: ${url}`);
  console.log('');

  try {
    execFileSync('npx', ['shadcn@latest', 'add', url], {
      cwd: targetPath,
      stdio: 'inherit',
    });
  } catch (e) {
    console.error(`❌ shadcn add 失败：${e.message}`);
    process.exit(4);
  }

  // 记录历史
  const historyDir = join(cwd, '.ddt', 'design', 'v0');
  mkdirSync(historyDir, { recursive: true });
  const historyPath = join(historyDir, 'ingest-history.jsonl');
  const record = {
    ts: new Date().toISOString(),
    url,
    target,
    success: true,
  };
  appendFileSync(historyPath, JSON.stringify(record) + '\n', 'utf8');

  console.log('');
  console.log(`✅ v0 组件已拉入 ${target}/components/ui/`);
  console.log(`   📊 历史记录: ${historyPath}`);
  console.log('');
  console.log(`👀 下一步：`);
  console.log(`   1. main thread 改写 fetch → web/lib/api-client.ts`);
  console.log(`   2. 跑 web/ 构建 + lint + 测试 + 10 维评分决策门`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => { console.error(err); process.exit(1); });
}
