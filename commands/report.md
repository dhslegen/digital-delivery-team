---
description: 度量命令 · 生成效率报告（含洞察、瓶颈分析、优化建议）。
argument-hint: "[--stage <all|design|impl|verify|ship>]"
---

# /report

**输入**：$ARGUMENTS

---

## Phase 1 — 前置校验 + baseline 封盘

```bash
[ -f "$DDT_PLUGIN_ROOT/bin/aggregate.mjs" ] || DDT_PLUGIN_ROOT=$(cat "${HOME}/.claude/delivery-metrics/.ddt-plugin-root" 2>/dev/null)
[ -f "$DDT_PLUGIN_ROOT/bin/aggregate.mjs" ] || DDT_PLUGIN_ROOT="${HOME}/.claude/plugins/marketplaces/digital-delivery-team"
[ -f "$DDT_PLUGIN_ROOT/bin/aggregate.mjs" ] || { echo "❌ DDT plugin root 未解析。可能原因：(1) 插件未安装；(2) shell 中 DDT_PLUGIN_ROOT 指向无效路径，请 unset DDT_PLUGIN_ROOT 后重启会话；(3) 运行 /digital-delivery-team:doctor 自检"; exit 1; }
export DDT_PLUGIN_ROOT

node "$DDT_PLUGIN_ROOT/bin/emit-phase.mjs" --phase report --action start
mkdir -p baseline
test -f baseline/historical-projects.csv || cp "$DDT_PLUGIN_ROOT/baseline/historical-projects.csv" baseline/historical-projects.csv
test -f baseline/estimation-rules.md || cp "$DDT_PLUGIN_ROOT/baseline/estimation-rules.md" baseline/estimation-rules.md
test -f baseline/baseline.locked.json || node "$DDT_PLUGIN_ROOT/bin/baseline.mjs" --lock \
  --hist baseline/historical-projects.csv --expert baseline/estimation-rules.md \
  --out baseline/baseline.locked.json
export DDT_PROJECT_ID=$(cat .ddt/project-id 2>/dev/null || echo "$DDT_PROJECT_ID")
test -n "$DDT_PROJECT_ID" || { echo "❌ 未设置 DDT_PROJECT_ID，请先运行 /prd"; exit 1; }
```

## Phase 2 — 聚合 + 原始报告

```bash
node "$DDT_PLUGIN_ROOT/bin/aggregate.mjs" --project "$DDT_PROJECT_ID"
node "$DDT_PLUGIN_ROOT/bin/report.mjs" --project "$DDT_PROJECT_ID" \
  --baseline baseline/baseline.locked.json --out docs/efficiency-report.raw.md
```

> M2-4：质量指标已由 PostToolUse hook 自动捕获，命令侧不再需要 `--capture-quality`。

## Phase 3 — 派发 metrics-agent

使用 Task 工具派发 `metrics-agent`，传入：

- `docs/efficiency-report.raw.md`（原始数据报告）
- `baseline/baseline.locked.json`（基线）
- `templates/efficiency-report.template.md`（报告模板）
- `$ARGUMENTS`（过滤阶段，如 `--stage impl`）

metrics-agent 产出 `docs/efficiency-report.md`，包含：
- 自然语言解读
- 瓶颈分析
- Top 3 优化建议

## Phase 4 — 汇总输出

```
/report 完成

总提效:       <+n>% / <-n>%
质量劣化:     ✅ 无 / ⚠️ <n> 项
Top 3 优化建议:
  1. <suggestion-1>
  2. <suggestion-2>
  3. <suggestion-3>

报告: docs/efficiency-report.md
```

若质量指标劣化：

> ⚠️ **存在质量劣化，请 metrics-agent 重点分析并给出改进计划**

否则：

> ✅ 建议下一步：`/ship`

## --refresh

传入 `--refresh` 时，重新聚合并增量刷新报告解读；禁止覆盖 raw 数据、baseline 或删除已有仍有效的分析结论。



## Phase 决策门 — M6.2 用户决策注入

按 `skills/decision-gate/SKILL.md` 标准模板执行：

### Step 1: 检查 --auto

如果 `$ARGUMENTS` 含 `--auto`，跳过决策门直接进入"标记阶段完成"。否则继续 Step 2。

### Step 2: 发射 decision_point 事件

```bash
if ! printf '%s' "$ARGUMENTS" | grep -q -- '--auto'; then
  node "$DDT_PLUGIN_ROOT/bin/emit-decision.mjs" --phase report --action point \
    --options "accept|modify|add|regenerate"
fi
```

### Step 3: LLM 调用 AskUserQuestion

```typescript
{
  questions: [{
    question: "效率报告 已生成（总提效 / 质量守门 / Top 3 优化建议），如何继续？",
    header: "Report review",
    multiSelect: false,
    options: [
      { label: "接受并继续 (Recommended)",
         description: "进入 /ship 或归档",
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
node "$DDT_PLUGIN_ROOT/bin/emit-decision.mjs" --phase report --action resolved \
  --user-action <accept|modify|add|regenerate|other> \
  --note "<用户备注摘要 ≤200 字>"
```

### Step 5: 按答案分支

| 用户选择 | 行为 |
|---------|------|
| 接受并继续 | 走"标记阶段完成"段落（emit-phase end）+ 提示用户运行 `/ship 或归档` |
| 修改某条 | 进一步问"哪条？怎么改？"，用 `--refresh` 增量修订 → 修订完再走一次决策门 |
| 新增内容 | 问"补充什么？"，用 `--refresh` 增量新增 → 决策门 |
| 重新生成 | 问"原因？要保留什么？"，用 `--refresh` 重生成（保留已确认部分） → 决策门 |
| Other | 解析意图，按 4 类映射；映射不上写 blocker |

**关键**：未收到用户决策前禁止进入下一 phase 命令，禁止 emit-phase end。

## Phase 末 — 标记阶段完成（M6.1.3）

```bash
node "$DDT_PLUGIN_ROOT/bin/emit-phase.mjs" --phase report --action end
```

$ARGUMENTS
