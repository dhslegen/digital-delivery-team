---
description: 预览命令 · 输出指定 phase 产物的关键摘要 + diff（决策门前快速扫一眼）
argument-hint: "<prd|wbs|design|impl|test|review|fix|package|report|all>"
---

# /preview

输出指定 phase 产物的**关键指标摘要** + **vs 上次 commit 的 diff stat**，让你不用打开多个文件就能决策。

通常在决策门触发前主动跑一次：

```text
/preview prd      → 看 PRD 摘要 → 决定是否接受
/preview design   → 看架构 / 契约 / 数据模型 → 决定
/preview all      → 9 个 phase 全部摘要一次性输出
```

---

## 执行

```bash
[ -f "$DDT_PLUGIN_ROOT/bin/aggregate.mjs" ] || DDT_PLUGIN_ROOT=$(cat "${HOME}/.claude/delivery-metrics/.ddt-plugin-root" 2>/dev/null)
[ -f "$DDT_PLUGIN_ROOT/bin/aggregate.mjs" ] || DDT_PLUGIN_ROOT="${HOME}/.claude/plugins/marketplaces/digital-delivery-team"
[ -f "$DDT_PLUGIN_ROOT/bin/aggregate.mjs" ] || { echo "❌ DDT plugin root 未解析"; exit 1; }
export DDT_PLUGIN_ROOT
node "$DDT_PLUGIN_ROOT/bin/preview.mjs" $ARGUMENTS
```

## 各 phase 摘要内容

| Phase | 输出指标 |
|-------|---------|
| `prd` | 用户故事数 / Given/When/Then 验收数 / P0/P1 优先级分布 / 文件大小 / vs HEAD diff |
| `wbs` | 任务数 / 关键路径 / 总工时 / 风险条目 |
| `design` | ADR 数 / API endpoint 数 / 数据模型实体 / 契约 lint hint |
| `impl` | 后端 ts/js 文件数 + 测试数 / 前端组件 + 测试数 |
| `test` | 覆盖率 / 通过率 / 失败用例 |
| `review` | 阻塞级 / 警告级 / 建议级条目数 / Fix Log 段落存在性 |
| `fix` | fixed / deferred / blocked 条目数 |
| `package` | README 行数 / 部署步骤数 / Demo 时长 |
| `report` | 总提效 / 阶段对比数 / 质量劣化警告 |
| `all` | 全部 9 个 phase 一次输出 |

## 与决策门的关系

`/preview <phase>` 是**决策门前的辅助工具**，不强制：
- 用户在 AskUserQuestion 决策门弹出后觉得 preview 字段信息不够 → 跑 `/preview <phase>` → 看完再决定
- `decision-gate` skill 推荐 LLM 在 AskUserQuestion 的 preview 字段里填 1-2 段摘要，不需要用户额外跑 `/preview`

## 可重入

只读命令，可任意多次调用。

$ARGUMENTS
