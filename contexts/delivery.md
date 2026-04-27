# DDT 全局交付上下文

> **读取时机**：每个 agent 在处理任何命令前必须先读本文件。
> **权威等级**：本文件是 DDT 运行时约定的 SSoT，与 `rules/delivery/` 规则文件配合使用。

---

## 1 · 一人一队速查表

| 角色 | 负责产物 | 触发命令 |
|------|-----------|---------|
| product-agent | `docs/prd.md` | `/prd` |
| pm-agent | `docs/wbs.md` + `docs/risks.md` | `/wbs` |
| architect-agent | `docs/arch.md` + `docs/api-contract.yaml` + `docs/data-model.md` | `/design` |
| frontend-agent | `web/` 前端实现与 `web/__tests__/` 前端测试 | `/build-web` |
| backend-agent | `server/` 后端实现、`server/tests/` 集成测试与 `server/migrations/` 迁移 | `/build-api` |
| test-agent | `tests/test-plan.md` + `tests/**/*.spec.*` + `tests/test-report.md` | `/test` |
| review-agent | `docs/review-report.md` | `/review` |
| docs-agent | `README.md` + `docs/deploy.md` + `docs/demo-script.md` | `/package` |
| metrics-agent | `docs/efficiency-report.md` | `/report` |

每个角色**只对**上表中对应的负责产物负责，禁止跨产物写入（blockers.md 除外）。

---

## 2 · SSoT 路径表

| 文档类型 | 权威路径 |
|---------|---------|
| 产品需求 | `docs/prd.md` |
| 工作分解 | `docs/wbs.md` |
| OpenAPI 契约 | `docs/api-contract.yaml` |
| 数据模型 | `docs/data-model.md` |
| 验收标准 | `docs/prd.md`（嵌入各用户故事）|
| 架构决策 | `docs/arch.md`（ADR 段落）|
| 风险清单 | `docs/risks.md` |
| 阻塞记录 | `docs/blockers.md` |
| 效率报告 | `docs/efficiency-report.md` |

任何 agent 需要上述信息时，**只从权威路径读取**，不重新生成、不凭记忆。

---

## 3 · 阶段数据流

```
/kickoff
  └─▶ product-agent → docs/prd.md
  └─▶ pm-agent      → docs/wbs.md + docs/risks.md
  └─▶ architect-agent → docs/arch.md + docs/api-contract.yaml + docs/data-model.md

/impl
  └─▶ frontend-agent → web/ (读 api-contract.yaml + wbs.md)
  └─▶ backend-agent  → server/ (读 api-contract.yaml + wbs.md)

/verify
  └─▶ test-agent   → tests/test-plan.md + tests/**/*.spec.* + tests/test-report.md
  └─▶ review-agent → docs/review-report.md

/ship
  └─▶ docs-agent → README.md + docs/deploy.md + docs/demo-script.md

/report (任意时刻)
  └─▶ metrics-agent → docs/efficiency-report.md
                       (读 hooks 自动产生的 delivery-metrics/ 数据)
```

各阶段的输入依赖前一阶段的输出。agent 若发现依赖文件不存在，必须写 blockers.md 并停止，**不得自行创建替代品**。

---

## 4 · Blockers 流程

**何时写**：遇到以下任一情况立即停止并写 blockers：
- 必读输入文件缺失
- 契约字段有歧义或冲突
- 需要人类做决策（架构选型、业务边界、资源协调）
- 外部依赖不可达

**写到哪**：`docs/blockers.md`，使用 `templates/blockers.template.md` 的字段结构**追加**（不覆盖）。

**谁来清**：人类。agent 不得自行标记 blocker 为已解决。

**门禁检查**：每个下游命令 Phase 0 会检查 `docs/blockers.md` 中未解决条目（`resolved_at: null`）。有未解决 blocker 则退出 2，拒绝继续。

---

## 5 · Incremental 模式约定

当目标产物已存在时，agent 必须：

1. 读取现有产物作为基线
2. 仅修改与新输入冲突或需要更新的部分
3. 在产物末尾或 `## 变更记录` 段追加一条 diff 摘要，格式：
   ```
   - [YYYY-MM-DD] <agent-name>: <新增/修改/删除了什么（1-2句）>
   ```

`--refresh` 标志语义：明确要求 agent 重新读取所有上游输入并更新产物，但**仍是增量**，不做全量覆盖。

---

## 6 · 度量边界

- **事件写入权仅限 `hooks/handlers/*.js`**：agent、命令脚本、bin/ 工具都不得直接追加 `delivery-metrics/events.jsonl`。
- **数据链单向**：hooks 实际度量链与 baseline 封盘链彼此独立，直到 `report.mjs` 才汇合；不存在回写。
- **agent 绝不自报度量**：不调用任何 `track_*` 接口，不在产物里写"本次耗时 X 秒"。
- 度量数据由 `metrics-agent` 通过 `bin/report.mjs` 读取并渲染，来源是 hooks 自动捕获的真实数据。
