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
test -f tests/test-report.md || { echo "❌ tests/test-report.md 不存在，请先运行 /test"; exit 1; }
test -f docs/review-report.md || { echo "❌ docs/review-report.md 不存在，请先运行 /review"; exit 1; }
[ -f "$DDT_PLUGIN_ROOT/bin/aggregate.mjs" ] || DDT_PLUGIN_ROOT=$(cat "${HOME}/.claude/delivery-metrics/.ddt-plugin-root" 2>/dev/null)
[ -f "$DDT_PLUGIN_ROOT/bin/aggregate.mjs" ] || DDT_PLUGIN_ROOT="${HOME}/.claude/plugins/marketplaces/digital-delivery-team"
[ -f "$DDT_PLUGIN_ROOT/bin/aggregate.mjs" ] || { echo "❌ DDT plugin root 未解析。可能原因：(1) 插件未安装；(2) shell 中 DDT_PLUGIN_ROOT 指向无效路径，请 unset DDT_PLUGIN_ROOT 后重启会话；(3) 运行 /digital-delivery-team:doctor 自检"; exit 1; }
export DDT_PLUGIN_ROOT

node "$DDT_PLUGIN_ROOT/bin/emit-phase.mjs" --phase package --action start
"$DDT_PLUGIN_ROOT/bin/check-blockers.sh" || exit 2
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



## Phase 决策门 — M6.2 用户决策注入

按 `skills/decision-gate/SKILL.md` 标准模板执行：

### Step 1: 检查 --auto

如果 `$ARGUMENTS` 含 `--auto`，跳过决策门直接进入"标记阶段完成"。否则继续 Step 2。

### Step 2: 发射 decision_point 事件

```bash
if ! printf '%s' "$ARGUMENTS" | grep -q -- '--auto'; then
  node "$DDT_PLUGIN_ROOT/bin/emit-decision.mjs" --phase package --action point \
    --options "accept|modify|add|regenerate"
fi
```

### Step 3: LLM 调用 AskUserQuestion

```typescript
{
  questions: [{
    question: "交付文档 已生成（README 行数 / 部署步骤 / Demo 时长），如何继续？",
    header: "Package review",
    multiSelect: false,
    options: [
      { label: "接受并继续 (Recommended)",
         description: "进入 /report",
         preview: "<填充本 phase 关键产物的 1-2 段摘要>" },
      { label: "修改某条具体内容",
         description: "我会指出哪条 + 怎么改" },
      { label: "新增内容",
         description: "我有遗漏的需求/字段/约束要补充" },
      { label: "重新生成（带说明）",
         description: "整体方向不对，重写本 phase" }
    ]
  }]
}
```

### Step 4: 收到答案后 emit decision_resolved

```bash
node "$DDT_PLUGIN_ROOT/bin/emit-decision.mjs" --phase package --action resolved \
  --user-action <accept|modify|add|regenerate|other> \
  --note "<用户备注摘要 ≤200 字>"
```

### Step 5: 按答案分支

| 用户选择 | 行为 |
|---------|------|
| 接受并继续 | 走"标记阶段完成"段落（emit-phase end）+ 提示用户运行 `/report` |
| 修改某条 | 进一步问"哪条？怎么改？"，用 `--refresh` 增量修订 → 修订完再走一次决策门 |
| 新增内容 | 问"补充什么？"，用 `--refresh` 增量新增 → 决策门 |
| 重新生成 | 问"原因？要保留什么？"，用 `--refresh` 重生成（保留已确认部分） → 决策门 |
| Other | 解析意图，按 4 类映射；映射不上写 blocker |

**关键**：未收到用户决策前禁止进入下一 phase 命令，禁止 emit-phase end。

## Phase 末 — 标记阶段完成（M6.1.3）

```bash
node "$DDT_PLUGIN_ROOT/bin/emit-phase.mjs" --phase package --action end
```

$ARGUMENTS
