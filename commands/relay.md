---
description: 接力命令 · 跨会话/跨 AI 不失忆。生成可复制的接力 prompt（DDT 13 段式接力 prompt 范式）
argument-hint: "[--out <path>] [--quiet]"
---

# /relay

跨会话 / 跨 AI 接力不失忆。一键生成 AI 友好的 prompt，用户复制到下一会话即可无缝续作。

---

## 何时使用

- 当前会话 token 接近上限，需要切到新会话
- 把项目交给同事 / 自己换设备
- 切换 AI 模型（Claude → GPT → Gemini）
- 长项目阶段性归档备份

## 执行

```bash
[ -f "$DDT_PLUGIN_ROOT/bin/aggregate.mjs" ] || DDT_PLUGIN_ROOT=$(cat "${HOME}/.claude/delivery-metrics/.ddt-plugin-root" 2>/dev/null)
[ -f "$DDT_PLUGIN_ROOT/bin/aggregate.mjs" ] || DDT_PLUGIN_ROOT="${HOME}/.claude/plugins/marketplaces/digital-delivery-team"
[ -f "$DDT_PLUGIN_ROOT/bin/aggregate.mjs" ] || { echo "❌ DDT plugin root 未解析。可能原因：(1) 插件未安装；(2) shell 中 DDT_PLUGIN_ROOT 指向无效路径，请 unset DDT_PLUGIN_ROOT 后重启会话；(3) 运行 /digital-delivery-team:doctor 自检"; exit 1; }
export DDT_PLUGIN_ROOT
node "$DDT_PLUGIN_ROOT/bin/build-relay-prompt.mjs" $ARGUMENTS
```

输出位置：
- **屏幕**：完整 prompt（用户可一键复制）
- **文件**：`.ddt/relay-<YYYYMMDD-HHMMSS>.md`（归档备份）

## 13 段式模板

DDT 自动填的 4 段：
1. 项目背景（项目 ID / 当前 phase / 已完成 phase / 技术栈摘要 / 关键产物路径）
2. Git 摘要（分支 / 最近 5 commits / 未提交改动）
3. 续作必做指南（接力 AI 第一步做什么）
4. 元数据（生成时间戳 / DDT 版本）

LLM 在生成 prompt 时必须补充的 9 段：
1. **What We Are Building** — 项目目标
2. **What WORKED (with evidence)** — 已验证有效（带证据）
3. **What Did NOT Work (and why)** — 失败尝试 + 精确原因（最关键）
4. **What Has NOT Been Tried Yet** — 未尝试方向
5. **Current State of Files** — 文件状态表
6. **Decisions Made** — 关键决策 + 理由
7. **Blockers & Open Questions** — 阻塞与未答问题
8. **Exact Next Step** — 下一步精确指令
9. **Environment & Setup Notes**（可选）— 启动命令 / 环境变量

## 使用示例

### 跨会话续作

```text
# 旧会话
/relay
# 屏幕显示完整 prompt，用户 Cmd+A 全选 + Cmd+C 复制

# 新会话（同设备 / 不同设备 / 不同 AI 都可）
[粘贴 prompt 到第一句对话]
# AI 立即知道：项目在哪、做到哪步、下一步做什么、什么不要重试
```

### 与同事交接

```text
/relay --out shared/handoff-2026-04-29.md
# 文件可直接给同事；同事在他的 Claude Code 里粘贴文件内容续作
```

### 切换 AI 模型

```text
/relay --quiet --out /tmp/relay.md
cat /tmp/relay.md | pbcopy        # macOS 复制到剪贴板
# 在 ChatGPT / Gemini 里粘贴 → AI 接手
```

## 与 /resume 的差异

| 命令 | 用途 | 输出 |
|------|------|------|
| `/digital-delivery-team:resume` | **同会话**自动恢复 | 屏幕（briefing） |
| `/digital-delivery-team:relay` | **跨会话/跨设备/跨 AI** 接力 | prompt 文件 + 屏幕 |

- 短会话 / 同设备续作 → 用 `/resume`（自动）
- 长会话 / 切 AI / 给同事 → 用 `/relay`（导出 prompt）

两者互补，不重叠。

## 自动注入

`/relay` 自动注入 progress / tech-stack / 关键产物路径，输出 13 段式接力 prompt。

## 可重入

`/relay` 是只读 + 写新文件，可任意多次调用。每次生成新文件不覆盖旧文件。

$ARGUMENTS
