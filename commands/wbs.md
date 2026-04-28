---
description: 项目经理命令 · 从 PRD 拆出 WBS + 依赖图 + 风险清单。
argument-hint: "[--refresh]"
---

# /wbs

**输入**：$ARGUMENTS

---

## Phase 1 — 前置校验

```bash
test -f docs/prd.md || { echo "❌ docs/prd.md 不存在，请先运行 /prd"; exit 1; }
[ -f "$DDT_PLUGIN_ROOT/bin/aggregate.mjs" ] || DDT_PLUGIN_ROOT=$(cat "${HOME}/.claude/delivery-metrics/.ddt-plugin-root" 2>/dev/null)
[ -f "$DDT_PLUGIN_ROOT/bin/aggregate.mjs" ] || DDT_PLUGIN_ROOT="${HOME}/.claude/plugins/marketplaces/digital-delivery-team"
[ -f "$DDT_PLUGIN_ROOT/bin/aggregate.mjs" ] || { echo "❌ DDT plugin root 未解析。可能原因：(1) 插件未安装；(2) shell 中 DDT_PLUGIN_ROOT 指向无效路径，请 unset DDT_PLUGIN_ROOT 后重启会话；(3) 运行 /digital-delivery-team:doctor 自检"; exit 1; }
export DDT_PLUGIN_ROOT
mkdir -p baseline
test -f baseline/historical-projects.csv || cp "$DDT_PLUGIN_ROOT/baseline/historical-projects.csv" baseline/historical-projects.csv
test -f baseline/estimation-rules.md || cp "$DDT_PLUGIN_ROOT/baseline/estimation-rules.md" baseline/estimation-rules.md
"$DDT_PLUGIN_ROOT/bin/check-blockers.sh" || exit 2
```

若 `docs/wbs.md` 已存在且未传 `--refresh`，进入增量修订模式。

## Phase 2 — 派发 pm-agent

使用 Task 工具派发 `pm-agent`，传入：

- `docs/prd.md`（产品需求文档）
- `docs/wbs.md`（已有 WBS，若存在，用于增量修订）
- `templates/wbs.template.md`（WBS 模板）
- `templates/risks.template.md`（风险清单模板）
- `baseline/estimation-rules.md`（项目目录内的专家估算表）
- `$ARGUMENTS`

pm-agent 产出：

| 产出文件 | 说明 |
|----------|------|
| `docs/wbs.md` | 工作分解结构，含关键路径和工时估算 |
| `docs/risks.md` | 风险清单，含概率/影响/应对措施 |

## Phase 3 — 汇总输出

```
/wbs 完成

关键路径任务数: <n> 个
预估总工时:     <n> 小时（基线: <baseline_total> 小时，Δ <±n>%）
风险 Top 3:
  1. <risk-1>（<概率> × <影响>）
  2. <risk-2>
  3. <risk-3>

产出文件:
  docs/wbs.md
  docs/risks.md

建议下一步：/design
```

## --refresh

传入 `--refresh` 时，重新读取 PRD 与基线资料，增量刷新 `docs/wbs.md` 和 `docs/risks.md`；禁止替换整份产物或移除已有变更记录。

$ARGUMENTS
