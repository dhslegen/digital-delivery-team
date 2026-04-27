# WBS · <项目名称>

> 版本：v1.0 · 作者：pm-agent · 日期：<YYYY-MM-DD>
> 关键路径：<T-XX → T-XX → T-XX>（总工时：<N>h）

---

## 任务清单

| 任务 ID | 描述 | 粒度(h) | 依赖类型 | 前置任务 | 承担人 |
|--------|------|--------|---------|---------|-------|
| T-01 | <任务描述> | <0.5–4> | blocker | — | architect |
| T-02 | <任务描述> | <0.5–4> | parallelizable | T-01 | frontend |
| T-03 | <任务描述> | <0.5–4> | parallelizable | T-01 | backend |
| T-04 | <任务描述> | <0.5–4> | optional | T-02 | docs |

> 依赖类型说明：`blocker`（强前置，必须完成才能开始）/ `parallelizable`（可与前置并行）/ `optional`（可延后）

## 里程碑

| 里程碑 | 完成条件 | 预计日期 |
|-------|---------|---------|
| M1：设计冻结 | arch.md + api-contract.yaml 通过 lint | <YYYY-MM-DD> |
| M2：实现完成 | 构建通过 + smoke test 绿 | <YYYY-MM-DD> |
| M3：验收通过 | 覆盖率 ≥ 70%，阻塞级评审 = 0 | <YYYY-MM-DD> |

## 工时汇总

| 承担人 | 预估总工时(h) |
|-------|------------|
| product | <N> |
| pm | <N> |
| architect | <N> |
| frontend | <N> |
| backend | <N> |
| test | <N> |
| review | <N> |
| docs | <N> |
| **合计** | **<N>** |

---

## Self-Check

- [ ] 所有任务粒度 ≤ 4h（已逐条核查）
- [ ] 依赖类型无遗漏（每个任务均已标注）
- [ ] 关键路径已标注在顶部
- [ ] 风险已同步到 docs/risks.md
- [ ] WBS 合计工时与 PRD 规模量级自洽
