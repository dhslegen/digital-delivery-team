# DDT 度量完整性规则

> 适用 agent：metrics-agent（主要）；其余 agent 作为约束参考
> 本文件约束度量数据的写入权限、数据链方向与不可变性要求。

---

## 规则

### M-1 · 事件写入权仅限 hooks

`delivery-metrics/events.jsonl` 的写入权**仅限** `hooks/handlers/*.js`。

以下实体**不得**直接追加 events.jsonl：
- 任何 agent 文件
- 命令脚本（`commands/*.md` 描述的流程）
- `bin/aggregate.mjs`、`bin/baseline.mjs`、`bin/report.mjs`
- 任何手写脚本或临时工具

违反此规则会破坏度量数据的可信度。

### M-2 · 数据链单向，禁止回写

度量数据流向严格单向，baseline 与实际度量是两条输入链，直到 `report.mjs` 才汇合：

```
hooks → events.jsonl → aggregate.mjs → metrics.db ┐
                                                    ├→ report.mjs → docs/efficiency-report.raw.md
historical-projects.csv + estimation-rules.md ─────┘
                → baseline.mjs --lock → baseline/baseline.locked.json
docs/efficiency-report.raw.md → metrics-agent → docs/efficiency-report.md
```

- `aggregate.mjs` 只读 events.jsonl，只写 metrics.db
- `baseline.mjs` 只读 `baseline/historical-projects.csv` 与 `baseline/estimation-rules.md`，只写 `baseline/baseline.locked.json`
- `baseline.mjs` 不得读取 metrics.db、events.jsonl 或任何实际运行数据
- `report.mjs` 只读 metrics.db + baseline.locked.json，只写 `docs/efficiency-report.raw.md`
- `metrics-agent` 只读 raw report 与原始数据路径，只写 `docs/efficiency-report.md`
- 任何方向的回写都被禁止

### M-3 · baseline.locked.json 不可变

`baseline.locked.json` 一旦对某个 project_id 生成：

- **永久不可变**——不得覆盖、修改、删除
- 若确实需要重置基线，必须先 backup 原文件，并在 `docs/arch.md` 追加 ADR 说明重置原因
- metrics-agent 若发现 baseline 需要重置，写 blocker 请求人类操作，不得自行执行

### M-4 · metrics-agent 只读度量，不写度量

metrics-agent 的工作是**读取**已有度量数据并渲染报告，不产生新的度量事件。

- 读取 `bin/report.mjs` 生成的 `docs/efficiency-report.raw.md`，再写 `docs/efficiency-report.md`
- 不得调用 `bin/aggregate.mjs` 或 `bin/baseline.mjs`（这两个工具由 hook/命令层触发）
- 不得在报告中编造、估算或插值任何度量数值
- 若度量数据为空，报告应显示「无度量数据，请先运行相关命令」，不得自行填充占位数据
