---
description: 产品经理命令 · 生成或刷新 PRD（含用户故事与 Given/When/Then 验收标准）。
argument-hint: "[--refresh] [补充说明文本]"
---

# /prd

**输入**：$ARGUMENTS

---

## Phase 1 — 前置校验

```bash
git rev-parse --is-inside-work-tree 2>/dev/null || { echo "❌ 非 git 仓库"; exit 1; }
```

若 `project-brief.md` 不存在：

```bash
cp templates/project-brief.template.md project-brief.md
echo "⚠️ 已创建 project-brief.md 骨架，请填写后重跑 /prd"
exit 1
```

## Phase 2 — 项目 ID 自检

`SessionStart` hook 已在新会话首次进入项目时自动 bootstrap。命令本身只读取已有 ID：

```bash
[ -f "$DDT_PLUGIN_ROOT/bin/aggregate.mjs" ] || DDT_PLUGIN_ROOT=$(cat "${HOME}/.claude/delivery-metrics/.ddt-plugin-root" 2>/dev/null)
[ -f "$DDT_PLUGIN_ROOT/bin/aggregate.mjs" ] || DDT_PLUGIN_ROOT="${HOME}/.claude/plugins/marketplaces/digital-delivery-team"
[ -f "$DDT_PLUGIN_ROOT/bin/aggregate.mjs" ] || { echo "❌ DDT plugin root 未解析。可能原因：(1) 插件未安装；(2) shell 中 DDT_PLUGIN_ROOT 指向无效路径，请 unset DDT_PLUGIN_ROOT 后重启会话；(3) 运行 /digital-delivery-team:doctor 自检"; exit 1; }
export DDT_PLUGIN_ROOT

node "$DDT_PLUGIN_ROOT/bin/emit-phase.mjs" --phase prd --action start
export DDT_PROJECT_ID=$(cat .ddt/project-id 2>/dev/null || echo "$DDT_PROJECT_ID")
test -n "$DDT_PROJECT_ID" || { node "$DDT_PLUGIN_ROOT/bin/aggregate.mjs" --bootstrap --name "$(basename "$(pwd)")"; export DDT_PROJECT_ID=$(cat .ddt/project-id); }
```

## Phase 3 — 增量 / refresh 选择

若 `docs/prd.md` 已存在且未传 `--refresh`，进入增量修订模式（默认）。

若传入 `--refresh`，重新读取 `project-brief.md` 与 `$ARGUMENTS`，刷新受影响章节；仍必须保留已验证内容与变更记录，禁止无差别全量覆盖。

## Phase 4 — 派发 product-agent

使用 Task 工具派发 `product-agent`，传入：

- `project-brief.md`（项目简报）
- `docs/prd.md`（已有 PRD，若存在）
- `templates/prd.template.md`（PRD 模板）
- `$ARGUMENTS`（补充说明）

product-agent 产出 `docs/prd.md`，必须包含：
- 用户故事列表
- 每条验收标准（Given / When / Then 格式）
- 功能优先级（P0 / P1 / P2）

## Phase 5 — 汇总输出

```
/prd 完成

变更摘要:
  新增用户故事: <n> 条
  修改:         <n> 条
  删除:         <n> 条

项目 ID: <DDT_PROJECT_ID>
报告:    docs/prd.md
```

若 `docs/blockers.md` 有新增条目：

> ⚠️ **存在阻塞项（docs/blockers.md），请处理后再推进**

否则：

> ✅ 建议下一步：`/wbs`

## --refresh

传入 `--refresh` 时，重新读取上游输入并增量刷新 `docs/prd.md`；禁止替换整份产物或移除已有变更记录。



## Phase 决策门 — M6.2 用户决策注入

按 `skills/decision-gate/SKILL.md` 标准模板执行：

### Step 1: 检查 --auto

如果 `$ARGUMENTS` 含 `--auto`，跳过决策门直接进入"标记阶段完成"。否则继续 Step 2。

### Step 2: 发射 decision_point 事件

```bash
if ! printf '%s' "$ARGUMENTS" | grep -q -- '--auto'; then
  node "$DDT_PLUGIN_ROOT/bin/emit-decision.mjs" --phase prd --action point \
    --options "accept|modify|add|regenerate"
fi
```

### Step 3: LLM 调用 AskUserQuestion

```typescript
{
  questions: [{
    question: "PRD 已生成（5 个用户故事 / 26 条 AC / P0=3 P1=2），如何继续？",
    header: "PRD review",
    multiSelect: false,
    options: [
      { label: "接受并继续 (Recommended)",
         description: "进入 /wbs",
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
node "$DDT_PLUGIN_ROOT/bin/emit-decision.mjs" --phase prd --action resolved \
  --user-action <accept|modify|add|regenerate|other> \
  --note "<用户备注摘要 ≤200 字>"
```

### Step 5: 按答案分支

| 用户选择 | 行为 |
|---------|------|
| 接受并继续 | 走"标记阶段完成"段落（emit-phase end）+ 提示用户运行 `/wbs` |
| 修改某条 | 进一步问"哪条？怎么改？"，用 `--refresh` 增量修订 → 修订完再走一次决策门 |
| 新增内容 | 问"补充什么？"，用 `--refresh` 增量新增 → 决策门 |
| 重新生成 | 问"原因？要保留什么？"，用 `--refresh` 重生成（保留已确认部分） → 决策门 |
| Other | 解析意图，按 4 类映射；映射不上写 blocker |

**关键**：未收到用户决策前禁止进入下一 phase 命令，禁止 emit-phase end。

## Phase 末 — 标记阶段完成（M6.1.3）

```bash
node "$DDT_PLUGIN_ROOT/bin/emit-phase.mjs" --phase prd --action end
```

$ARGUMENTS
