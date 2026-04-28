---
description: 架构师命令 · 生成架构草案 + OpenAPI 契约 + 数据模型。
argument-hint: "[--refresh] [--preset java-modern|node-modern|go-modern|python-fastapi|java-traditional] [--ai-design claude-design|figma|v0|lovable] [架构倾向性说明]"
---

# /design

**输入**：$ARGUMENTS

---

## Phase 1 — 前置校验

```bash
test -f docs/prd.md || { echo "❌ docs/prd.md 不存在，请先运行 /prd"; exit 1; }
test -f docs/wbs.md || { echo "❌ docs/wbs.md 不存在，请先运行 /wbs"; exit 1; }
: "${DDT_PLUGIN_ROOT:=$(cat "${HOME}/.claude/delivery-metrics/.ddt-plugin-root" 2>/dev/null)}"
test -d "$DDT_PLUGIN_ROOT" || { echo "❌ DDT plugin root 未解析，请重启会话或运行 /digital-delivery-team:doctor"; exit 1; }
"$DDT_PLUGIN_ROOT/bin/check-blockers.sh" || exit 2
```

若 `docs/api-contract.yaml` 已存在且未传 `--refresh`，进入增量修订模式。

## Phase 2 — 解析技术栈（M3-3 优先级链）

```bash
# 提取参数中的 --preset 与 --ai-design（如果有）
PRESET_FLAG=$(printf '%s' "$ARGUMENTS" | grep -oE -- '--preset [a-zA-Z0-9_-]+' | head -1 | awk '{print $2}')
AIDESIGN_FLAG=$(printf '%s' "$ARGUMENTS" | grep -oE -- '--ai-design [a-zA-Z0-9_-]+' | head -1 | awk '{print $2}')

node "$DDT_PLUGIN_ROOT/bin/resolve-tech-stack.mjs" \
  ${PRESET_FLAG:+--preset "$PRESET_FLAG"} \
  ${AIDESIGN_FLAG:+--ai-design "$AIDESIGN_FLAG"} \
  --write
```

优先级（从高到低）：CLI flag > project-brief.md "技术栈预设" > 已存在的 `.delivery/tech-stack.json` > manifest 自动检测 > 默认 `java-modern`。

产出：`.delivery/tech-stack.json`（architect-agent 必读输入）。

## Phase 3 — 派发 architect-agent

使用 Task 工具派发 `architect-agent`，传入：

- `docs/prd.md`（需求文档）
- `docs/wbs.md`（工作分解结构）
- `.delivery/tech-stack.json`（**M3 必读** 技术栈选型，禁止偏离）
- `templates/api-contract.template.yaml`（契约模板）
- `templates/data-model.template.md`（数据模型模板）
- `$ARGUMENTS`（架构倾向性说明）

architect-agent 产出：

| 产出文件 | 说明 |
|----------|------|
| `docs/arch.md` | 架构决策记录，含技术选型理由 |
| `docs/api-contract.yaml` | OpenAPI 3.0 契约 |
| `docs/data-model.md` | 数据模型（ER 图文字描述 + 字段规范） |

## Phase 4 — 自动契约 lint（硬门禁）

```bash
if command -v npx >/dev/null 2>&1; then
  npx --yes @redocly/cli lint docs/api-contract.yaml || exit 4
else
  echo "OpenAPI lint tool missing; cannot verify contract"
  exit 5
fi
```

契约 lint 失败必须停止，禁止推进到 `/impl`、`/build-web` 或 `/build-api`。

## Phase 5 — 汇总输出

```
/design 完成

ADR 决策数:   <n> 条
Endpoint 数:  <n> 个
契约 lint:    通过

产出文件:
  docs/arch.md
  docs/api-contract.yaml
  docs/data-model.md

建议下一步：/impl 或 /build-web / /build-api
```

## --refresh

传入 `--refresh` 时，重新读取 PRD、WBS 与技术栈信息，增量刷新架构、契约和数据模型；禁止替换整份产物或移除已有 ADR/变更记录。

$ARGUMENTS
