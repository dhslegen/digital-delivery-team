---
description: 代码评审命令 · 对当前 branch 的 diff 产出三级评审报告（阻塞/警告/建议）。
argument-hint: "[对比分支，默认 main]"
---

# /review

**输入**：$ARGUMENTS（对比基线分支，默认 `main`）

---

## Phase 1 — 校验

```bash
[ -f "$DDT_PLUGIN_ROOT/bin/aggregate.mjs" ] || DDT_PLUGIN_ROOT=$(cat "${HOME}/.claude/delivery-metrics/.ddt-plugin-root" 2>/dev/null)
[ -f "$DDT_PLUGIN_ROOT/bin/aggregate.mjs" ] || DDT_PLUGIN_ROOT="${HOME}/.claude/plugins/marketplaces/digital-delivery-team"
[ -f "$DDT_PLUGIN_ROOT/bin/aggregate.mjs" ] || { echo "❌ DDT plugin root 未解析。可能原因：(1) 插件未安装；(2) shell 中 DDT_PLUGIN_ROOT 指向无效路径，请 unset DDT_PLUGIN_ROOT 后重启会话；(3) 运行 /digital-delivery-team:doctor 自检"; exit 1; }
export DDT_PLUGIN_ROOT

node "$DDT_PLUGIN_ROOT/bin/emit-phase.mjs" --phase review --action start
git rev-parse --is-inside-work-tree 2>/dev/null || { echo "❌ 非 git 仓库"; exit 1; }
BASE=${ARGUMENTS:-main}
git diff "$BASE"...HEAD --name-only | grep -q . || { echo "⚠️ 与 $BASE 无 diff，无需 review"; exit 0; }

# 检查上游阶段是否留下未解决 blockers
if [ -f docs/blockers.md ]; then
  unresolved=$(awk '/^- \*\*resolved_at\*\*: null$/' docs/blockers.md | wc -l)
  if [ "$unresolved" -gt 0 ]; then
    echo "❌ docs/blockers.md 中存在 $unresolved 条未解决阻塞，请先处理。"
    echo "   未解决项来自："
    awk '/^## /{h=$0} /^- \*\*resolved_at\*\*: null$/{print "   - "h}' docs/blockers.md
    exit 2
  fi
fi
```

## Phase 2 — 派发 review-agent

使用 Task 工具派发 `review-agent`，传入：

- `git diff $BASE...HEAD`（完整差异）
- `docs/arch.md`（若存在）
- `docs/api-contract.yaml`（若存在）
- `templates/review-checklist.template.md`（评审清单）
- `$ARGUMENTS`（对比基线）

review-agent 按三级分类产出 `docs/review-report.md`：

| 级别 | 含义 | 后续行动 |
|------|------|----------|
| **阻塞** | 安全漏洞、数据丢失风险、逻辑致命错误 | 必须修复后重跑 /review |
| **警告** | 代码质量问题、缺失测试、性能隐患 | 建议修复 |
| **建议** | 可读性、命名、注释改进 | 可选 |

## Phase 3 — 汇总输出

完成后向用户报告：

```
/review 完成
基线: <BASE> → HEAD

阻塞:  <n> 条
警告:  <n> 条
建议:  <n> 条

报告: docs/review-report.md
```

若阻塞级 > 0：

> ❌ **存在阻塞级问题，禁止推进到 /package，请修复后重跑 `/review`**

若阻塞 = 0：

> ✅ 可继续 → `/package` 或 `/verify`

## --refresh

传入 `--refresh` 时，重新读取最新 diff 与架构契约，增量刷新 `docs/review-report.md`；禁止删除已有仍有效的评审结论。



## Phase 决策门 — M6.2 用户决策注入

按 `skills/decision-gate/SKILL.md` 标准模板执行：

### Step 1: 检查 --auto

如果 `$ARGUMENTS` 含 `--auto`，跳过决策门直接进入"标记阶段完成"。否则继续 Step 2。

### Step 2: 发射 decision_point 事件

```bash
if ! printf '%s' "$ARGUMENTS" | grep -q -- '--auto'; then
  node "$DDT_PLUGIN_ROOT/bin/emit-decision.mjs" --phase review --action point \
    --options "accept|modify|add|regenerate"
fi
```

### Step 3: LLM 调用 AskUserQuestion

```typescript
{
  questions: [{
    question: "评审报告 已生成（阻塞级 / 警告级 / 建议级三级条目数），如何继续？",
    header: "Review review",
    multiSelect: false,
    options: [
      { label: "接受并继续 (Recommended)",
         description: "进入 /fix 或 /package",
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
node "$DDT_PLUGIN_ROOT/bin/emit-decision.mjs" --phase review --action resolved \
  --user-action <accept|modify|add|regenerate|other> \
  --note "<用户备注摘要 ≤200 字>"
```

### Step 5: 按答案分支

| 用户选择 | 行为 |
|---------|------|
| 接受并继续 | 走"标记阶段完成"段落（emit-phase end）+ 提示用户运行 `/fix 或 /package` |
| 修改某条 | 进一步问"哪条？怎么改？"，用 `--refresh` 增量修订 → 修订完再走一次决策门 |
| 新增内容 | 问"补充什么？"，用 `--refresh` 增量新增 → 决策门 |
| 重新生成 | 问"原因？要保留什么？"，用 `--refresh` 重生成（保留已确认部分） → 决策门 |
| Other | 解析意图，按 4 类映射；映射不上写 blocker |

**关键**：未收到用户决策前禁止进入下一 phase 命令，禁止 emit-phase end。

## Phase 末 — 标记阶段完成（M6.1.3）

```bash
node "$DDT_PLUGIN_ROOT/bin/emit-phase.mjs" --phase review --action end
```

$ARGUMENTS
