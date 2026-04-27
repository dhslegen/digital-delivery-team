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
if [ -z "${DDT_PLUGIN_ROOT:-}" ]; then
  DDT_PLUGIN_ROOT="$(node -e 'const p=require("path"),f=require("fs"),o=require("os");const ok=r=>r&&f.existsSync(p.join(r,"baseline","historical-projects.csv"));const e=process.env.DDT_PLUGIN_ROOT||process.env.CLAUDE_PLUGIN_ROOT;if(ok(e)){console.log(p.resolve(e));process.exit(0)}const h=p.join(o.homedir(),".claude");for(const s of [["plugins","digital-delivery-team"],["plugins","digital-delivery-team@digital-delivery-team"],["plugins","marketplace","digital-delivery-team"]]){const r=p.join(h,...s);if(ok(r)){console.log(r);process.exit(0)}}try{const cb=p.join(h,"plugins","cache");for(const pub of f.readdirSync(cb,{withFileTypes:true})){if(!pub.isDirectory())continue;const pd=p.join(cb,pub.name,"digital-delivery-team");if(!f.existsSync(pd))continue;for(const v of f.readdirSync(pd,{withFileTypes:true}))if(v.isDirectory()){const r=p.join(pd,v.name);if(ok(r)){console.log(r);process.exit(0)}}}}catch{}process.exit(1)')" || { echo "❌ DDT plugin root not found; set DDT_PLUGIN_ROOT"; exit 1; }
  export DDT_PLUGIN_ROOT
fi
mkdir -p baseline
test -f baseline/historical-projects.csv || cp "$DDT_PLUGIN_ROOT/baseline/historical-projects.csv" baseline/historical-projects.csv
test -f baseline/estimation-rules.md || cp "$DDT_PLUGIN_ROOT/baseline/estimation-rules.md" baseline/estimation-rules.md

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
