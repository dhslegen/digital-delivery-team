---
description: 度量命令 · 生成效率报告（含洞察、瓶颈分析、优化建议）。
argument-hint: "[--stage <all|design|impl|verify|ship>]"
---

# /report

**输入**：$ARGUMENTS

---

## Phase 1 — 前置校验

baseline 属于被交付项目，必须在项目根目录生成。若 `baseline/historical-projects.csv` 或 `baseline/estimation-rules.md` 不存在，先从插件模板复制骨架：

```bash
if [ -z "${DDT_PLUGIN_ROOT:-}" ]; then
  DDT_PLUGIN_ROOT="$(node -e 'const p=require("path"),f=require("fs"),o=require("os");const ok=r=>r&&f.existsSync(p.join(r,"bin","report.mjs"));const e=process.env.DDT_PLUGIN_ROOT||process.env.CLAUDE_PLUGIN_ROOT;if(ok(e)){console.log(p.resolve(e));process.exit(0)}const h=p.join(o.homedir(),".claude");for(const s of [["plugins","digital-delivery-team"],["plugins","digital-delivery-team@digital-delivery-team"],["plugins","marketplace","digital-delivery-team"]]){const r=p.join(h,...s);if(ok(r)){console.log(r);process.exit(0)}}try{const cb=p.join(h,"plugins","cache");for(const pub of f.readdirSync(cb,{withFileTypes:true})){if(!pub.isDirectory())continue;const pd=p.join(cb,pub.name,"digital-delivery-team");if(!f.existsSync(pd))continue;for(const v of f.readdirSync(pd,{withFileTypes:true}))if(v.isDirectory()){const r=p.join(pd,v.name);if(ok(r)){console.log(r);process.exit(0)}}}}catch{}process.exit(1)')" || { echo "❌ DDT plugin root not found; set DDT_PLUGIN_ROOT"; exit 1; }
  export DDT_PLUGIN_ROOT
fi
mkdir -p baseline
test -f baseline/historical-projects.csv || cp "$DDT_PLUGIN_ROOT/baseline/historical-projects.csv" baseline/historical-projects.csv
test -f baseline/estimation-rules.md || cp "$DDT_PLUGIN_ROOT/baseline/estimation-rules.md" baseline/estimation-rules.md
```

若 `baseline/baseline.locked.json` 不存在，在项目根目录封盘；若已存在则跳过，保持封盘不可变：

```bash
if [ ! -f baseline/baseline.locked.json ]; then
  node "$DDT_PLUGIN_ROOT/bin/baseline.mjs" --lock \
    --hist baseline/historical-projects.csv \
    --expert baseline/estimation-rules.md \
    --out baseline/baseline.locked.json
fi
```

读取项目 ID：

```bash
export DDT_PROJECT_ID=$(cat .delivery/project-id 2>/dev/null || echo "$DDT_PROJECT_ID")
test -n "$DDT_PROJECT_ID" || { echo "❌ 未设置 DDT_PROJECT_ID，请先运行 /prd"; exit 1; }
```

## Phase 2 — 聚合 + 原始报告

```bash
node "$DDT_PLUGIN_ROOT/bin/aggregate.mjs" --project "$DDT_PROJECT_ID"
node "$DDT_PLUGIN_ROOT/bin/aggregate.mjs" --project "$DDT_PROJECT_ID" --capture-quality
node "$DDT_PLUGIN_ROOT/bin/report.mjs" \
  --project "$DDT_PROJECT_ID" \
  --baseline baseline/baseline.locked.json \
  --out docs/efficiency-report.raw.md
```

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
