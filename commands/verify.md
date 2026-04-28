---
description: 并行验证 · 同一轮对话同时派发 test-agent 与 review-agent。
argument-hint: ""
---

# /verify

---

## 关键约束

在**同一条消息**内同时发出两个 Task 工具调用：

- **Task 1**：`test-agent`（执行测试 + 覆盖率）
- **Task 2**：`review-agent`（代码评审，基线 `main`）

## 前置校验

```bash
test -f docs/prd.md           || { echo "❌ 请先运行 /prd"; exit 1; }
test -f docs/api-contract.yaml || { echo "❌ 请先运行 /design"; exit 1; }
```

## 两者都完成后汇总

读取 `tests/test-report.md` 和 `docs/review-report.md`，判断放行条件：

| 指标 | 放行条件 |
|------|----------|
| 覆盖率 | ≥ 70% |
| 阻塞级评审项 | = 0 |

若**任一不满足**：

> ❌ **禁止推进到 /ship**，建议下一步：
>
> - 阻塞级 > 0 时：`/fix --severity blocker --apply` 修复后重跑 `/verify`
> - 覆盖率不足时：补充测试用例后重跑 `/test`

```
/verify 完成

覆盖率:        <coverage>%  ✅ / ❌
阻塞级评审项:  <n> 条       ✅ / ❌
警告级评审项:  <n> 条
建议级评审项:  <n> 条
```

若全部放行：

> ✅ 建议下一步：`/ship`

$ARGUMENTS
