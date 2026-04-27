---
description: 测试命令 · 从验收标准生成测试并跑回归，输出覆盖率报告。
argument-hint: "[--regression-only]"
---

# /test

**输入**：$ARGUMENTS

---

## Phase 1 — 前置校验

```bash
test -f docs/prd.md || { echo "❌ docs/prd.md 不存在，请先运行 /prd"; exit 1; }
test -f docs/api-contract.yaml || { echo "❌ docs/api-contract.yaml 不存在，请先运行 /design"; exit 1; }

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

## Phase 2 — 派发 test-agent

使用 Task 工具派发 `test-agent`，传入：

- `docs/prd.md`（验收标准来源）
- `docs/api-contract.yaml`（接口契约）
- `templates/test-plan.template.md`（测试计划模板）
- `$ARGUMENTS`（如 `--regression-only`）

test-agent 职责：
1. 解析 PRD 中的验收标准，生成对应测试用例
2. 执行全量测试 + 计算覆盖率
3. 产出 `tests/test-report.md`

## Phase 3 — 覆盖率守门

test-agent 完成后检查覆盖率。若覆盖率 < 70%：

> ❌ **覆盖率 < 70%，禁止推进到 /review，请补充测试**

## Phase 4 — 汇总输出

```
/test 完成

验收标准覆盖: <covered> / <total> 条
覆盖率:      <coverage>%
缺陷统计:
  critical: <n> 条
  major:    <n> 条
  minor:    <n> 条

报告: tests/test-report.md
```

若缺陷 ≤ minor 级别：

> ✅ 建议下一步：`/review`

若存在 critical / major：

> ⚠️ 建议修复后重跑 `/test`

## --refresh

传入 `--refresh` 时，重新读取 PRD 与契约，增量更新测试计划、测试代码和测试报告；禁止删除已有有效测试。

$ARGUMENTS
