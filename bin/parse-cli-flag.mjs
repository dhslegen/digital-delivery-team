#!/usr/bin/env node
// W7.5 R9：从 $ARGUMENTS 字符串中安全抽取 --<flag> 的值
//
// 背景：Claude Code 把 slash command 的所有参数拼成单个 $ARGUMENTS 字符串透传给命令的 bash。
//   shell 的 grep -oE -- '--bundle [^ ]+' | awk 拿到值时，含空格的路径会被截断。
//   本脚本支持 --flag value、--flag "with space"、--flag 'with space' 三种形态。
//
// 用法：
//   node bin/parse-cli-flag.mjs --flag bundle -- "$ARGUMENTS"
//   → 输出 bundle 的值（不含尾部换行；空字符串表示未提供）
//
// 退出码：始终 0（找不到值时输出空字符串，调用方自行判断）

const argv = process.argv.slice(2);
let flag = null;
let rest = '';

for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--flag' && i + 1 < argv.length) {
    flag = argv[i + 1];
    i++;
  } else if (argv[i] === '--') {
    rest = argv.slice(i + 1).join(' ');
    break;
  }
}

if (!flag) {
  process.stderr.write('Usage: parse-cli-flag.mjs --flag <name> -- "$ARGUMENTS"\n');
  process.exit(0);
}

// flag 名做白名单（仅 [a-z0-9-]）防 ReDoS 与 regex 注入
if (!/^[a-z0-9-]+$/.test(flag)) {
  process.exit(0);
}

const re = new RegExp(`--${flag}\\s+(?:"([^"]+)"|'([^']+)'|(\\S+))`);
const m = rest.match(re);
if (m) process.stdout.write(m[1] || m[2] || m[3] || '');

process.exit(0);
