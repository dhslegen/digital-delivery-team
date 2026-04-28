---
description: 度量命令 · 生成效率报告（含洞察、瓶颈分析、优化建议）。
argument-hint: "[--stage <all|design|impl|verify|ship>]"
---

# /report

**输入**：$ARGUMENTS

---

## Phase 1 — 前置校验 + baseline 封盘

```bash
: "${DDT_PLUGIN_ROOT:=$(cat "${HOME}/.claude/delivery-metrics/.ddt-plugin-root" 2>/dev/null)}"
test -d "$DDT_PLUGIN_ROOT" || { echo "❌ DDT plugin root 未解析，请重启会话或运行 /digital-delivery-team:doctor"; exit 1; }
mkdir -p baseline
test -f baseline/historical-projects.csv || cp "$DDT_PLUGIN_ROOT/baseline/historical-projects.csv" baseline/historical-projects.csv
test -f baseline/estimation-rules.md || cp "$DDT_PLUGIN_ROOT/baseline/estimation-rules.md" baseline/estimation-rules.md
test -f baseline/baseline.locked.json || node "$DDT_PLUGIN_ROOT/bin/baseline.mjs" --lock \
  --hist baseline/historical-projects.csv --expert baseline/estimation-rules.md \
  --out baseline/baseline.locked.json
export DDT_PROJECT_ID=$(cat .delivery/project-id 2>/dev/null || echo "$DDT_PROJECT_ID")
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

$ARGUMENTS
