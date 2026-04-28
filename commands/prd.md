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
: "${DDT_PLUGIN_ROOT:=$(cat "${HOME}/.claude/delivery-metrics/.ddt-plugin-root" 2>/dev/null)}"
test -d "$DDT_PLUGIN_ROOT" || { echo "❌ DDT plugin root 未解析，请重启会话或运行 /digital-delivery-team:doctor"; exit 1; }
export DDT_PROJECT_ID=$(cat .delivery/project-id 2>/dev/null || echo "$DDT_PROJECT_ID")
test -n "$DDT_PROJECT_ID" || { node "$DDT_PLUGIN_ROOT/bin/aggregate.mjs" --bootstrap --name "$(basename "$(pwd)")"; export DDT_PROJECT_ID=$(cat .delivery/project-id); }
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

$ARGUMENTS
