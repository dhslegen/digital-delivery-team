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
[ -f "$DDT_PLUGIN_ROOT/bin/aggregate.mjs" ] || DDT_PLUGIN_ROOT=$(cat "${HOME}/.claude/delivery-metrics/.ddt-plugin-root" 2>/dev/null)
[ -f "$DDT_PLUGIN_ROOT/bin/aggregate.mjs" ] || DDT_PLUGIN_ROOT="${HOME}/.claude/plugins/marketplaces/digital-delivery-team"
[ -f "$DDT_PLUGIN_ROOT/bin/aggregate.mjs" ] || { echo "❌ DDT plugin root 未解析。可能原因：(1) 插件未安装；(2) shell 中 DDT_PLUGIN_ROOT 指向无效路径，请 unset DDT_PLUGIN_ROOT 后重启会话；(3) 运行 /digital-delivery-team:doctor 自检"; exit 1; }
export DDT_PLUGIN_ROOT

node "$DDT_PLUGIN_ROOT/bin/emit-phase.mjs" --phase fix --action start
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



## Phase 决策门 — M6.2 用户决策注入

按 `skills/decision-gate/SKILL.md` 标准模板执行：

### Step 1: 检查 --auto

如果 `$ARGUMENTS` 含 `--auto`，跳过决策门直接进入"标记阶段完成"。否则继续 Step 2。

### Step 2: 发射 decision_point 事件

```bash
if ! printf '%s' "$ARGUMENTS" | grep -q -- '--auto'; then
  node "$DDT_PLUGIN_ROOT/bin/emit-decision.mjs" --phase fix --action point \
    --options "accept|modify|add|regenerate"
fi
```

### Step 3: LLM 调用 AskUserQuestion

```typescript
{
  questions: [{
    question: "修复 patch 已生成（修复成功 / 延后 / 仍阻塞条目数），如何继续？",
    header: "Fix review",
    multiSelect: false,
    options: [
      { label: "接受并继续 (Recommended)",
         description: "进入 /verify",
         preview: "<填充本 phase 关键产物的 1-2 段摘要>" },
      { label: "修改某条具体内容",
         description: "我会指出哪条 + 怎么改" },
      { label: "新增内容",
         description: "我有遗漏的需求/字段/约束要补充" },
      { label: "重新生成（带说明）",
         description: "整体方向不对，重写本 phase" }
    ]
  }]
}
```

### Step 4: 收到答案后 emit decision_resolved

```bash
node "$DDT_PLUGIN_ROOT/bin/emit-decision.mjs" --phase fix --action resolved \
  --user-action <accept|modify|add|regenerate|other> \
  --note "<用户备注摘要 ≤200 字>"
```

### Step 5: 按答案分支

| 用户选择 | 行为 |
|---------|------|
| 接受并继续 | 走"标记阶段完成"段落（emit-phase end）+ 提示用户运行 `/verify` |
| 修改某条 | 进一步问"哪条？怎么改？"，用 `--refresh` 增量修订 → 修订完再走一次决策门 |
| 新增内容 | 问"补充什么？"，用 `--refresh` 增量新增 → 决策门 |
| 重新生成 | 问"原因？要保留什么？"，用 `--refresh` 重生成（保留已确认部分） → 决策门 |
| Other | 解析意图，按 4 类映射；映射不上写 blocker |

**关键**：未收到用户决策前禁止进入下一 phase 命令，禁止 emit-phase end。

## Phase 末 — 标记阶段完成（M6.1.3）

```bash
node "$DDT_PLUGIN_ROOT/bin/emit-phase.mjs" --phase fix --action end
```

$ARGUMENTS
