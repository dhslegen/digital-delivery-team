---
description: 后端命令 · 按 OpenAPI 契约 + 数据模型实现 server 侧（含集成测试）。
argument-hint: "[模块或 endpoint 范围]"
---

# /build-api

**输入**：$ARGUMENTS

---

## Phase 1 — 前置校验

```bash
test -f docs/api-contract.yaml || { echo "❌ docs/api-contract.yaml 不存在，请先运行 /design"; exit 1; }
test -f docs/data-model.md     || { echo "❌ docs/data-model.md 不存在，请先运行 /design"; exit 1; }
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

契约 lint 失败直接停止，禁止在未验证契约时实现后端。

## Phase 2 — 脚手架确认

若 `server/` 目录不存在，询问用户是否用 `$ARGUMENTS` 指定脚手架初始化（如 `fastapi`、`express`、`gin`、`spring`）。

## Phase 3 — 派发 backend-agent

使用 Task 工具派发 `backend-agent`，传入：

- `docs/api-contract.yaml`（接口契约）
- `docs/data-model.md`（数据模型）
- `templates/api-contract.template.yaml`（字段约定参考）
- `$ARGUMENTS`（模块/endpoint 范围）

backend-agent 职责：
1. 按契约实现所有 endpoint
2. 按数据模型实现数据库迁移
3. 编写集成测试
4. 在 `server/Makefile`（或等价脚本）中写入 `migrate` 和 `smoke` 命令

## Phase 4 — 自动质量校验

```bash
(cd server && make migrate && make smoke)
```

任一失败时：

> ❌ **后端校验未通过，请修复后重跑 `/build-api`**

## Phase 5 — 汇总输出

```
/build-api 完成

新增 endpoint: <n> 个
测试通过率:    <passed> / <total>
迁移:          ✅ / ❌
Smoke:         ✅ / ❌

建议下一步：/review 或 /verify
```

## --refresh

传入 `--refresh` 时，重新读取契约和数据模型，增量更新指定 endpoint/模块；禁止清空 `server/` 或覆盖无关实现。

$ARGUMENTS
