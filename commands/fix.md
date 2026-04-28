---
description: 修复命令 · 按 review-report 条目逐项打补丁，默认 dry-run，阻塞级须用户确认
argument-hint: "[--severity blocker|warning|all] [--apply] [--dry-run]"
---

# /fix

**输入**：$ARGUMENTS

修复 `/verify`（review-agent）产出的 `docs/review-report.md` 中已列出的问题。**默认 dry-run**——仅输出 diff 让用户 review；通过 `--apply` 才会真正写入。

---

## Phase 1 — 前置校验

```bash
test -f docs/review-report.md || { echo "❌ docs/review-report.md 不存在，请先运行 /verify 或 /review"; exit 1; }
: "${DDT_PLUGIN_ROOT:=$(cat "${HOME}/.claude/delivery-metrics/.ddt-plugin-root" 2>/dev/null)}"
test -d "$DDT_PLUGIN_ROOT" || { echo "❌ DDT plugin root 未解析，请重启会话或运行 /digital-delivery-team:doctor"; exit 1; }
"$DDT_PLUGIN_ROOT/bin/check-blockers.sh" || exit 2
```

## Phase 2 — 解析参数

| 参数 | 默认 | 说明 |
|------|------|------|
| `--severity blocker\|warning\|all` | `warning` | 修复哪一级（阻塞 / 警告 / 全部） |
| `--apply` | 关 | 真正写入文件；不传则 dry-run（仅输出 diff） |
| `--dry-run` | 开 | 显式 dry-run（与无 `--apply` 等价） |

阻塞级永远要求用户 review patch，即使传 `--apply` 也必须逐条确认。

## Phase 3 — 派发 fix-agent

使用 Task 工具派发 `fix-agent`，传入：

- `docs/review-report.md`（待修复条目）
- `docs/api-contract.yaml`（修改后端时必读）
- `docs/data-model.md`（修改持久层时必读）
- `$ARGUMENTS`（severity 与 apply 标志）

fix-agent 产出：
- 受影响源码的 Edit/MultiEdit
- `docs/review-report.md` 追加 `## Fix Log` 段落

## Phase 4 — 自动回归

```bash
# 后端
test -d server && (cd server && (npm test --silent 2>/dev/null || make smoke 2>/dev/null || true))
# 前端
test -d web && (cd web && (npm test --silent --run 2>/dev/null || true))
```

任一回归失败 → 提示重跑 `/fix` 或 `/verify`：

> ❌ **修复后回归失败，请检查 fix-agent 产出的 patch**

## Phase 5 — 汇总输出

```
/fix 完成

修复成功:    <n> 条
延后/拒绝:   <n> 条
仍阻塞:      <n> 条

Fix Log:     docs/review-report.md (## Fix Log 段)
```

剩余阻塞 > 0：

> ⚠️ **存在未修复阻塞，请重跑 `/verify` 后再次 `/fix --severity blocker --apply`**

否则：

> ✅ 建议下一步：`/verify` 重新校验通过率

## 可重入

`/fix` 是天然可重入的：再次执行时 fix-agent 跳过 `status: fixed` 的条目，仅处理 `pending` / `blocked` 项。无需 `--refresh` 参数。

$ARGUMENTS
