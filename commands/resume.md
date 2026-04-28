---
description: 恢复命令 · 读取 .delivery/progress.json 显示当前进度与下一步建议
argument-hint: ""
---

# /resume

显示当前 DDT 项目的阶段进度与下一步建议。适用于跨会话接力或长项目断点续传。

---

## 执行

```bash
[ -f "$DDT_PLUGIN_ROOT/bin/aggregate.mjs" ] || DDT_PLUGIN_ROOT=$(cat "${HOME}/.claude/delivery-metrics/.ddt-plugin-root" 2>/dev/null)
[ -f "$DDT_PLUGIN_ROOT/bin/aggregate.mjs" ] || DDT_PLUGIN_ROOT="${HOME}/.claude/plugins/marketplaces/digital-delivery-team"
[ -f "$DDT_PLUGIN_ROOT/bin/aggregate.mjs" ] || { echo "❌ DDT plugin root 未解析。可能原因：(1) 插件未安装；(2) shell 中 DDT_PLUGIN_ROOT 指向无效路径，请 unset DDT_PLUGIN_ROOT 后重启会话；(3) 运行 /digital-delivery-team:doctor 自检"; exit 1; }
export DDT_PLUGIN_ROOT
node "$DDT_PLUGIN_ROOT/bin/resume.mjs"
```

## 输出

```
=== DDT Resume ===
项目 ID: proj-xxx
最后活动: 2026-04-28T07:55:00Z（5 分钟前）

阶段进度：
  ✅ prd（2026-04-28T01:00）
  ✅ wbs（2026-04-28T01:30）
  🔄 design（已 12 分钟）
  ⏸ build-web
  ⏸ build-api
  ...

已完成: 2 / 10

=== 下一步建议 ===
🔄 当前在 design 阶段，最近 12 分钟内有活动。
   建议：继续完成 design（产物：docs/arch.md, docs/api-contract.yaml, docs/data-model.md）
```

## 状态机

| 状态 | 图标 | 含义 |
|------|------|------|
| pending | ⏸ | 尚未开始 |
| in_progress | 🔄 | 正在进行中 |
| completed | ✅ | 已完成（artifact 文件存在 + agent self-check 通过） |
| stale | ⚠️ | in_progress 但 > 30 分钟无活动 |

## 与其它命令的关系

- `/resume` 只读，不改变进度
- `progress.json` 由 hook 自动维护：
  - SessionStart：infer 现有 artifact 文件推断状态
  - UserPromptSubmit：检测到 phase 命令时标 in_progress
  - Stop：每个 turn 结束跑 infer，artifact 出现则标 completed
- 若进度推断错误，可手动跑 `node "$DDT_PLUGIN_ROOT/bin/progress.mjs" --update <phase> <status>`

## 可重入

幂等只读命令，可任意多次调用。
