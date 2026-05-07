# 示例：historical-projects.csv 学习版

> **角色**：学习 schema / 体验 pm-agent 在 /wbs 阶段如何用 baseline 做工时同类对比。
> **不是**：用户的真实历史数据。HIST-001~HIST-008 是合成示例，不应被任何用户项目当作真实基线。

## 何时用本示例

| 场景 | 操作 |
|---|---|
| 第一次接触 DDT，想看 baseline 长什么样 | 直接读 `historical-projects.example.csv` |
| 想试 `/wbs` 流程但项目根 baseline 是空的 | `cp examples/historical-projects.example.csv baseline/historical-projects.csv`（**仅 demo 用**） |
| 团队真实立项 | 跑 ddt-baseline-sync 从空表头开始累积，**不要**复制本示例 |

## 字段语义（schema 速查）

| 字段 | 含义 | 示例值（HIST-001 用户认证模块） |
|---|---|---|
| `project_id` | surrogate key，HIST-NNN 自增 | `HIST-001` |
| `name` | 项目业务名（同名项目应被查重） | `用户认证模块` |
| `type` | 项目类型，4 选 1 + Other | `auth`（旧示例使用业务标签，新规范统一为 4 类） |
| `total_hours` | 各 phase 工时累加 | 48 |
| `prd_hours` | requirements + 产品经理工时 | 4 |
| `wbs_hours` | 拆解 / 排期 | 3 |
| `design_hours` | architecture + UI design | 6 |
| `frontend_hours` | 前端开发 | 12 |
| `backend_hours` | 后端开发 | 12 |
| `test_hours` | 测试执行 | 6 |
| `review_hours` | 评审 / 缺陷复盘 | 2 |
| `docs_hours` | 文档 / 运维收尾 | 3 |
| `defect_count` | 缺陷数（项目跑完才有） | 5 |
| `coverage_pct` | 测试覆盖率 % | 72 |
| `team_size` | 人头数 | 1 |
| `notes` | 自由备注 | 单人全栈 |

## 角色 → phase 映射（与 parse-staffing.py 一致）

| 人员表角色 | 映射 phase 列 | 拆分比例 |
|---|---|---|
| 项目经理 + 架构 | architecture / requirements | 60% / 40% |
| 产品经理 | requirements / wbs | 50% / 50% |
| UI 设计 | design (ui_design) | 100% |
| 前端 / fe | frontend | 100% |
| 后端 / be | backend | 100% |
| 测试 / QA | test / review | 70% / 30% |
| 运维 / DevOps | docs | 100%（暂无独立列） |

工时公式：`人月 × 22 工作日 × 8 小时 = 人月 × 176`
