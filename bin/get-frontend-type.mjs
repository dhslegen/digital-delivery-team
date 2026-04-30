#!/usr/bin/env node
// PR-E：读 .ddt/tech-stack.json 输出 frontend.type 到 stdout（spa | server-side | none）
// 抽出来作独立脚本而非 inline node -e，符合 M2-9 commands 瘦身契约。
// fallback 'spa' 让向后兼容（无 type 字段的旧 tech-stack.json 仍按 SPA 处理）。
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const stackPath = join(process.cwd(), '.ddt', 'tech-stack.json');
let type = 'spa';
if (existsSync(stackPath)) {
  try {
    const stack = JSON.parse(readFileSync(stackPath, 'utf8'));
    if (stack && stack.frontend && stack.frontend.type) {
      type = stack.frontend.type;
    }
  } catch { /* fallback spa */ }
}
process.stdout.write(type);
