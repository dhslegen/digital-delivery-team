---
description: 交付命令 · 生成 README + 部署指南 + 演示脚本。
argument-hint: "[--demo-length <minutes>]"
---

# /package

**输入**：$ARGUMENTS

---

## Phase 1 — 前置校验

以下任一不满足直接拒绝：

```bash
# 检查测试报告存在
test -f tests/test-report.md || { echo "❌ tests/test-report.md 不存在，请先运行 /test"; exit 1; }

# 检查评审报告无阻塞
test -f docs/review-report.md || { echo "❌ docs/review-report.md 不存在，请先运行 /review"; exit 1; }

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

若 `docs/review-report.md` 中阻塞级条目 > 0，拒绝执行并提示：

> ❌ **存在阻塞级问题，请修复后重跑 `/review`**

## Phase 2 — 派发 docs-agent

使用 Task 工具派发 `docs-agent`，传入：

- `docs/prd.md`（产品需求文档）
- `docs/arch.md`（架构决策，若存在）
- `templates/deploy.template.md`（部署模板）
- `templates/demo-script.template.md`（演示脚本模板）
- `$ARGUMENTS`（如 `--demo-length 5`）

docs-agent 产出：

| 产出文件 | 说明 |
|----------|------|
| `README.md` | 项目主文档，含功能概述、快速启动 |
| `docs/deploy.md` | 一键部署指南，含环境要求和步骤 |
| `docs/demo-script.md` | 演示脚本，含时间节点和话术 |

## Phase 3 — 自动校验

```bash
README_LINES=$(wc -l < README.md 2>/dev/null || echo 0)
STEPS=$(grep -c "^[0-9]\+\." docs/deploy.md 2>/dev/null || echo 0)
DEMO_MINS=$(grep -oE "[0-9]+ min" docs/demo-script.md 2>/dev/null | tail -1 || echo "—")
```

## Phase 4 — 汇总输出

```
/package 完成

README:    <README_LINES> 行
部署步骤:  <STEPS> 步
Demo 时长: <DEMO_MINS>

产出文件:
  README.md
  docs/deploy.md
  docs/demo-script.md

建议下一步：/report
```

## --refresh

传入 `--refresh` 时，重新读取验证结果与代码树，增量刷新 README、部署指南和演示脚本；禁止删除已有仍有效的交付说明。

$ARGUMENTS
