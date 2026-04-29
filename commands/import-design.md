---
description: 设计稿导入 · 从 figma / v0 / lovable / claude-design 拉取 UI 并生成符合契约的 React 组件
argument-hint: "--from figma|v0|lovable|claude-design [--url <design-url>] [--target web/]"
---

# /import-design

把 AI-native 设计源转化为符合 `docs/api-contract.yaml` 与 `.ddt/tech-stack.json` 的 React + Tailwind 组件，落地到 `web/`。

---

## Phase 1 — 前置校验

```bash
test -f docs/api-contract.yaml || { echo "❌ 请先运行 /design 生成 API 契约"; exit 1; }
test -f .ddt/tech-stack.json || { echo "❌ 请先运行 /design（会自动写入 tech-stack.json）"; exit 1; }
[ -f "$DDT_PLUGIN_ROOT/bin/aggregate.mjs" ] || DDT_PLUGIN_ROOT=$(cat "${HOME}/.claude/delivery-metrics/.ddt-plugin-root" 2>/dev/null)
[ -f "$DDT_PLUGIN_ROOT/bin/aggregate.mjs" ] || DDT_PLUGIN_ROOT="${HOME}/.claude/plugins/marketplaces/digital-delivery-team"
[ -f "$DDT_PLUGIN_ROOT/bin/aggregate.mjs" ] || { echo "❌ DDT plugin root 未解析。可能原因：(1) 插件未安装；(2) shell 中 DDT_PLUGIN_ROOT 指向无效路径，请 unset DDT_PLUGIN_ROOT 后重启会话；(3) 运行 /digital-delivery-team:doctor 自检"; exit 1; }
export DDT_PLUGIN_ROOT
"$DDT_PLUGIN_ROOT/bin/check-blockers.sh" || exit 2
```

## Phase 2 — 解析参数

| 参数 | 必填 | 默认 | 说明 |
|------|------|------|------|
| `--from` | ✅ | - | `figma` / `v0` / `lovable` / `claude-design` |
| `--url` | 取决于来源 | - | figma URL（必填）/ v0 share URL（必填）/ lovable github 或 zip URL（必填）/ claude-design 留空 |
| `--target` | ❌ | `web/` | 目标目录前缀 |

```bash
FROM=$(printf '%s' "$ARGUMENTS" | grep -oE -- '--from [a-zA-Z0-9_-]+' | awk '{print $2}')
URL=$(printf '%s' "$ARGUMENTS" | grep -oE -- '--url [^ ]+' | awk '{print $2}')
TARGET=$(printf '%s' "$ARGUMENTS" | grep -oE -- '--target [^ ]+' | awk '{print $2}')
TARGET=${TARGET:-web/}

case "$FROM" in
  figma|v0|lovable) test -n "$URL" || { echo "❌ --from $FROM 必须提供 --url"; exit 1; } ;;
  claude-design) ;;
  *) echo "❌ --from 必须为 figma|v0|lovable|claude-design（实测：$FROM）"; exit 1 ;;
esac
```

## Phase 3 — 派发 frontend-agent + 通道指令

使用 Task 工具派发 `frontend-agent`，传入：

- `docs/api-contract.yaml`（必读）
- `docs/prd.md`（UX 语义）
- `.ddt/tech-stack.json`（必读，决定 ui 库与 ai_design 通道）
- `skills/ai-native-design/SKILL.md`（必读，对应通道章节）
- 通道参数：`--from $FROM --url $URL --target $TARGET`

frontend-agent 按 SKILL.md 中"四种通道"对应章节执行：

| `--from` | 行动 |
|----------|------|
| `claude-design` | 直接基于 PRD + 契约 + Tailwind 生成 React + shadcn 组件 |
| `figma` | 调用 `mcp__figma__get_design_context` 拉取节点上下文，转 React+Tailwind |
| `v0` | 解析 v0 share URL，跑 `npx shadcn@latest add <components>` 拉入 `web/components/ui/` |
| `lovable` | clone / 解压 → 提取 `src/` → 重写为 shadcn 等价 + 接 OpenAPI client |

## Phase 4 — 契约对齐自动校验

```bash
# 1. 字段一致性：grep 确认生成代码无契约外字段
node "$DDT_PLUGIN_ROOT/bin/check-contract-alignment.mjs" "$TARGET" || exit 3

# 2. 构建 / lint / 测试
(cd "$TARGET" && npm run build && npm run lint && npm test -- --run) || exit 4
```

任一失败 → 写 blocker + 提示重跑。

## Phase 5 — 汇总输出

```
/import-design 完成

来源:        <FROM>（URL: <URL>）
新增组件:    <n> 个（src: <files>）
新增页面:    <n> 个
契约对齐:    ✅ 通过 / ❌ <n> 处违规
测试通过率:  <passed>/<total>
```

若契约对齐失败：

> ❌ **生成代码与 docs/api-contract.yaml 不一致，请修复后重跑或写 blocker**

否则：

> ✅ 建议下一步：`/verify` 检查质量

## 可重入

`/import-design` 是天然可重入的：再次执行时会用新的 `--url` 替换对应章节组件；已通过契约对齐 + 测试的组件不会重生成。

$ARGUMENTS
