---
description: 前端命令 · 按 OpenAPI 契约实现 web 侧（含最小 happy-path 测试）。
argument-hint: "[模块或页面范围]"
---

# /build-web

**输入**：$ARGUMENTS

---

## Phase 1 — 前置校验

```bash
[ -f "$DDT_PLUGIN_ROOT/bin/aggregate.mjs" ] || DDT_PLUGIN_ROOT=$(cat "${HOME}/.claude/delivery-metrics/.ddt-plugin-root" 2>/dev/null)
[ -f "$DDT_PLUGIN_ROOT/bin/aggregate.mjs" ] || DDT_PLUGIN_ROOT="${HOME}/.claude/plugins/marketplaces/digital-delivery-team"
[ -f "$DDT_PLUGIN_ROOT/bin/aggregate.mjs" ] || { echo "❌ DDT plugin root 未解析。可能原因：(1) 插件未安装；(2) shell 中 DDT_PLUGIN_ROOT 指向无效路径，请 unset DDT_PLUGIN_ROOT 后重启会话；(3) 运行 /digital-delivery-team:doctor 自检"; exit 1; }
export DDT_PLUGIN_ROOT

node "$DDT_PLUGIN_ROOT/bin/emit-phase.mjs" --phase build-web --action start
test -f docs/api-contract.yaml || { echo "❌ docs/api-contract.yaml 不存在，请先运行 /design"; exit 1; }
if command -v npx >/dev/null 2>&1; then
  npx --yes @redocly/cli lint docs/api-contract.yaml || exit 4
else
  echo "OpenAPI lint tool missing; cannot verify contract"
  exit 5
fi

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

契约 lint 失败直接停止，禁止在未验证契约时实现前端。

## Phase 2 — 脚手架确认

若 `web/` 目录不存在，询问用户是否用 `$ARGUMENTS` 中指定的脚手架初始化（如 `vite`、`next`、`nuxt`）。

## Phase 3 — 派发 frontend-agent

使用 Task 工具派发 `frontend-agent`，传入：

- `docs/api-contract.yaml`（接口契约）
- `docs/prd.md`（产品需求，含 UI 验收标准）
- `templates/api-contract.template.yaml`（字段约定参考）
- `$ARGUMENTS`（模块/页面范围）

frontend-agent 职责：
1. 按契约实现 API 调用层
2. 实现页面/组件
3. 编写最小 happy-path 测试

## Phase 4 — 自动质量校验

```bash
(cd web && npm run build && npm run lint && npm run typecheck && npm test -- --run)
```

任一失败时：

> ❌ **质量校验未通过，请修复后重跑 `/build-web`**

## Phase 5 — 汇总输出

```
/build-web 完成

新增页面/组件: <n> 个
测试通过:      <passed> / <total>
构建:          ✅ / ❌

建议下一步：/review 或 /verify
```

## --refresh

传入 `--refresh` 时，重新读取契约和 PRD，增量更新指定页面/模块；禁止清空 `web/` 或覆盖无关实现。


## Phase 末 — 标记阶段完成（M6.1.3）

```bash
node "$DDT_PLUGIN_ROOT/bin/emit-phase.mjs" --phase build-web --action end
```

$ARGUMENTS
