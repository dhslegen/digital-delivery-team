---
description: 自检命令 · 检查 DDT 插件安装、hook 注册、Node 版本、工具链是否就绪
argument-hint: ""
---

# /doctor

DDT 插件安装与运行环境的健康检查，建议安装后第一次运行。

---

## 执行

```bash
[ -f "$DDT_PLUGIN_ROOT/bin/aggregate.mjs" ] || DDT_PLUGIN_ROOT=$(cat "${HOME}/.claude/delivery-metrics/.ddt-plugin-root" 2>/dev/null)
[ -f "$DDT_PLUGIN_ROOT/bin/aggregate.mjs" ] || DDT_PLUGIN_ROOT="${HOME}/.claude/plugins/marketplaces/digital-delivery-team"
[ -f "$DDT_PLUGIN_ROOT/bin/aggregate.mjs" ] || { echo "❌ DDT plugin root 未解析。可能原因：(1) 插件未安装，请运行 /plugin install digital-delivery-team@digital-delivery-team；(2) shell 中 DDT_PLUGIN_ROOT 指向无效路径，请 unset DDT_PLUGIN_ROOT 后重启会话"; exit 1; }
export DDT_PLUGIN_ROOT
node "$DDT_PLUGIN_ROOT/bin/doctor.mjs"
```

## 检查项

| 项 | 通过条件 |
|----|----------|
| Node ≥ 22 | `node:sqlite` 内置模块需要 |
| 插件 root 完整性 | bin/ + hooks/handlers/ + 关键脚本齐全 |
| SessionStart marker | `~/.claude/delivery-metrics/.ddt-plugin-root` 存在且指向有效目录 |
| hooks.json 注册 | SessionStart/SessionEnd/PreToolUse/PostToolUse/SubagentStop/UserPromptSubmit/Stop 全部注册 |
| events.jsonl 可写 | 度量目录权限正常 |
| metrics.db 完整性 | 文件不存在视为正常（首次运行）；存在则大小 > 0 |
| @redocly/cli 可用 | OpenAPI lint 工具链 |
| check-blockers.sh 可执行 | 权限位 0o111 已设置 |

## 退出码

- `0`：全部通过
- `1`：至少一项失败（按提示逐项修复后重跑）

## 常见修复

- `Node ≥ 22 ❌` → `nvm install 22 && nvm use 22`
- `SessionStart marker ❌` → 重启 Claude Code 会话（SessionStart hook 会重新写入）
- `@redocly/cli ❌` → `npm i -g @redocly/cli` 或确认网络可达
