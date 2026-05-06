<!-- 来源: ddt-team-admin-v0.8.1, 时间: 2026-05-06, DDT: v0.8.1, agent: pm-agent -->
# WBS · 团队成员管理后台 (Team Admin Console)

> 版本：v1.0 · 作者：pm-agent · 日期：2026-05-06
> 关键路径：T-01 → T-02 → T-14 → T-15 → T-18 → T-20 → T-21（串行工时：10h）
> 复杂度：**中等**（endpoint 8–12 个，无第三方集成，实体 4 个；v0.8 骨架，无真实 DB）

---

## 任务清单

| 任务 ID | 描述 | 粒度(h) | 依赖类型 | 前置任务 | 承担人 |
|--------|------|--------|---------|---------|-------|
| T-01 | 技术栈确认 + Next.js 项目脚手架初始化（yarn + shadcn-ui + TanStack） | 1 | blocker | — | architect |
| T-02 | OpenAPI / tRPC 契约定义（Member / Role / AuditLog 5 类接口） | 2 | blocker | T-01 | architect |
| T-03 | 数据模型设计（Member / Role / Permission / AuditLog 4 实体 ERD） | 1 | parallelizable | T-01 | architect |
| T-04 | Design Brief 编译（10 字段 SSoT，含 Visual Direction / Component States） | 1 | parallelizable | T-02, T-03 | architect |
| T-05 | Next.js App Router 路由骨架 + shadcn-ui 主题配置 | 1 | blocker | T-01 | frontend |
| T-06 | 成员列表页面（TanStack Table 分页 + 多维筛选栏） | 2 | blocker | T-05 | frontend |
| T-07 | 批量操作工具栏 + 危险操作二次确认弹窗组件 | 1 | parallelizable | T-06 | frontend |
| T-08 | 创建成员分步表单 Step1+2（基本信息 + 角色选择，react-hook-form + zod） | 2 | blocker | T-05 | frontend |
| T-09 | 创建成员分步表单 Step3+4（通知偏好 + 确认预览）+ zod schema 完整 | 1 | blocker | T-08 | frontend |
| T-10 | 成员详情页面（基本信息卡 + 角色矩阵展示 + 操作历史时间线） | 2 | parallelizable | T-05 | frontend |
| T-11 | 审计日志页面（TanStack 虚拟滚动 + 全文搜索 + 按类型筛选 + CSV 导出按钮） | 2 | parallelizable | T-05 | frontend |
| T-12 | 角色管理权限矩阵编辑器（勾选 + 继承展示 + 冲突高亮） | 2 | optional | T-05 | frontend |
| T-13 | 前端 tRPC client 接入 + mock 数据适配层 | 1 | blocker | T-02 | frontend |
| T-14 | tRPC server 初始化 + Prisma schema（mock 模式，无真实 DB） | 1 | blocker | T-02, T-03 | backend |
| T-15 | 成员 CRUD router（列表 / 详情 / 创建 / 软删除 / 批量状态变更） | 2 | blocker | T-14 | backend |
| T-16 | 审计日志 router（只读流水 + CSV 导出，写入不可删除约束） | 1 | parallelizable | T-14 | backend |
| T-17 | 角色管理 router（权限矩阵 CRUD + 冲突检测逻辑） | 1 | optional | T-14 | backend |
| T-18 | P0 功能 AC 自动化测试（F1 成员列表 + F2 创建成员，20 条 AC 中 8 条） | 2 | blocker | T-15, T-06, T-09 | test |
| T-19 | P1 功能 AC 自动化测试（F3 成员详情 + F4 审计日志，8 条 AC） | 2 | parallelizable | T-16, T-10, T-11 | test |
| T-20 | 代码评审（架构约束 + 安全清单：审计日志不可编辑 / 密码不出 console） | 1 | blocker | T-18, T-19 | review |
| T-21 | README（5 分钟上手）+ 部署指南 + DDT 效率报告 | 1 | optional | T-20 | docs |

> 依赖类型说明：`blocker`（强前置，必须完成才能开始）/ `parallelizable`（可与前置并行推进）/ `optional`（P2 或可延后交付）

---

## 并行执行策略

```
T-01
├── T-02（必须串行）
│   ├── T-03（可并行）
│   │   └── T-04
│   ├── T-14（backend）←── T-15 → T-16（并行）→ T-17（可选）
│   └── T-13（frontend mock层）
└── T-05（frontend骨架）
    ├── T-06 → T-07
    ├── T-08 → T-09
    ├── T-10
    ├── T-11
    └── T-12（可选）

T-15 + T-09 + T-06 ──► T-18（P0测试）┐
T-16 + T-10 + T-11 ──► T-19（P1测试）┘ → T-20（评审）→ T-21
```

---

## 里程碑

| 里程碑 | 完成条件 | 预计日期 |
|-------|---------|---------|
| M1：设计冻结 | T-01 ~ T-04 完成；`docs/api-contract.yaml` + `.ddt/tech-stack.json` 通过 lint | 2026-05-07 |
| M2：实现完成 | T-05 ~ T-17 完成；`yarn build` 通过，smoke test 绿 | 2026-05-09 |
| M3：验收通过 | T-18 ~ T-20 完成；AC 覆盖率 ≥ 70%，阻塞级评审问题 = 0 | 2026-05-10 |

---

## 工时汇总

| 承担人 | 任务 | 预估总工时(h) |
|-------|------|------------|
| architect | T-01, T-02, T-03, T-04 | 5 |
| frontend | T-05, T-06, T-07, T-08, T-09, T-10, T-11, T-12, T-13 | 14 |
| backend | T-14, T-15, T-16, T-17 | 5 |
| test | T-18, T-19 | 4 |
| review | T-20 | 1 |
| docs | T-21 | 1 |
| **合计** | — | **30** |

> 基线参考（AI 辅助目标）：42.5h（来自 baseline/estimation-rules.md）
> 本项目估算 30h，**Δ −29%**，原因：v0.8 骨架，无真实数据库，mock 层替代完整后端

---

## 变更记录

| 版本 | 日期 | 变更描述 |
|------|------|---------|
| v1.0 | 2026-05-06 | 初版；21 个任务，关键路径 10h，总工时 30h |

---

## Self-Check

- [x] 所有任务粒度 ≤ 4h（最大 2h，已逐条核查）
- [x] 依赖类型无遗漏（每个任务均已标注）
- [x] 关键路径已标注在顶部（T-01→T-02→T-14→T-15→T-18→T-20→T-21，10h）
- [x] 风险已同步到 docs/risks.md
- [x] WBS 合计工时（30h）与 PRD 规模量级自洽（5 功能，20 AC，中等复杂度骨架）
