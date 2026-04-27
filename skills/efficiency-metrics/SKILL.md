---
name: efficiency-metrics
description: Knowledge pack for baseline establishment, quality gating, and efficiency report composition. Auto-loaded by metrics-agent and by /report command.
origin: DDT
---

# Efficiency Metrics

## Triggers
- metrics-agent 启动 / /report 命令

## Baseline 双口径（必须同时产生）

### 管道 A：历史同类项目工时
- 从最近 6 个月的真实项目里选 3–5 个可比案例
- 按阶段（需求 / 架构 / 前端 / 后端 / 联调 / 测试 / 文档）拆解实际工时
- 存入 `baseline/historical-projects.csv`（见模板格式）

### 管道 B：专家独立估算
- 架构师 + 项目经理各自独立估算（禁止在 PRD 之后参考任何实际产物）
- 两人估算差 > 20% → 开一次对齐会，消除差异
- 存入 `baseline/estimation-rules.md`

### 最终 baseline = 两者均值
- 封盘时机：/prd + /wbs 产出后、/impl 启动前
- 封盘命令：先解析 `DDT_PLUGIN_ROOT`；若 `baseline/baseline.locked.json` 不存在，再执行 `node "$DDT_PLUGIN_ROOT/bin/baseline.mjs" --lock --hist baseline/historical-projects.csv --expert baseline/estimation-rules.md --out baseline/baseline.locked.json`
- **封盘后禁止修改**（防止后视偏差污染对比数据）
- `baseline/baseline.locked.json` 属于被交付项目目录，不属于插件源码目录

## 质量守门阈值（任一劣化即在报告首行标红 ⚠️）
- 覆盖率（branch）≥ **70%**
- Review 阻塞级问题 = **0**
- 验收标准通过率 = **100%**
- 返工次数（相对基线）不上升
- 缺陷密度不上升

## Report Structure（硬性，不可省略任一章节）
1. **摘要**：一句话结论 + ⚠️ 劣化告警（若有，必须是报告第一行）
2. **阶段级对比表**：
   | 阶段 | 基线（h） | 实际（h） | 节省（h） | 提效% |
   （按"提效%"降序排，负值表示劣化）
3. **质量守门表**：覆盖率 / 阻塞级 / 验收通过率 / 返工次数 / 缺陷密度
4. **三个分析问题的回答**：
   - 哪个阶段提效最多？为什么？
   - 哪个阶段提效最少或劣化？根因是什么？
   - 下次怎么优化？给出 ≤ 3 条可执行建议
5. **Top 3 优化建议**（必须可执行，不能是"加强 XX"）
6. **原始数据链接**：events.jsonl 路径 + metrics.db dump 命令

## 数据链路（hooks → 脚本 → 报告）

```
hooks → ~/.claude/delivery-metrics/events.jsonl → bin/aggregate.mjs → metrics.db ┐
                                                                                  ├→ bin/report.mjs → docs/efficiency-report.raw.md
baseline/historical-projects.csv + baseline/estimation-rules.md                  │
      → bin/baseline.mjs → baseline/baseline.locked.json ────────────────────────┘
docs/efficiency-report.raw.md → metrics-agent → docs/efficiency-report.md
```

events.jsonl 字段结构：
```json
{"event":"session_start","ts":"2026-01-01T00:00:00Z","project_id":"<id>","data":{"session_id":"<uuid>","cwd":"<path>"}}
{"event":"session_end","ts":"2026-01-01T01:00:00Z","project_id":"<id>","data":{"session_id":"<uuid>","tokens_input":1000,"tokens_output":500}}
{"event":"pre_tool_use","ts":"2026-01-01T00:10:00Z","project_id":"<id>","data":{"session_id":"<uuid>","tool_name":"Write","file_path":"docs/prd.md"}}
{"event":"post_tool_use","ts":"2026-01-01T00:10:02Z","project_id":"<id>","data":{"session_id":"<uuid>","tool_name":"Write","success":true,"output_size":2048}}
{"event":"subagent_stop","ts":"2026-01-01T00:30:00Z","project_id":"<id>","data":{"session_id":"<uuid>","subagent_name":"product-agent","duration_ms":120000,"tokens_input":1000,"tokens_output":500}}
{"event":"quality_metrics","ts":"2026-01-01T00:40:00Z","project_id":"<id>","data":{"defects_critical":0,"defects_major":1,"defects_minor":2,"coverage_pct":72.5,"rework_count":0,"acceptance_pass_pct":100}}
```

## Do
- 所有百分比保留 1 位小数（如 42.3%）
- 对比表按"提效%"降序排列
- 优化建议必须可执行（"下次 /design 前先跑一次 lint" ✅ 而不是"加强设计" ❌）
- baseline 封盘后每次新项目开始都重新 lock

## Don't
- 不修改 raw 数据（docs/efficiency-report.raw.md 由脚本生成，禁止手改）
- 不在 baseline 封盘后调整基线（即使实际工时严重偏差）
- 不隐藏劣化指标（所有指标必须如实上报，包括负向结果）
- 不用"相对上次提升了"代替"相对基线提升了"（基线是封盘值，不是上次报告）

## Templates & References
- `templates/efficiency-report.template.md`
- `bin/aggregate.mjs`（事件聚合）
- `bin/baseline.mjs`（基线封盘与读取）
- `bin/report.mjs`（原始报告生成）
- `baseline/historical-projects.csv`（历史项目数据格式）
