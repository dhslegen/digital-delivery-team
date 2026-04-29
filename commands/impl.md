---
description: 串行实现 · 串行调用 /build-api → 决策门 → /build-web → 决策门 → 汇总（M6.4 起从黑盒并行改为透明串行）
argument-hint: "[--web-only|--api-only] [--auto] [--module <name>]"
---

# /impl

**M6.4 重大变更**：v0.6.x 用 frontend-agent + backend-agent 同消息并行派发（黑盒）；v0.7.0 改为串行调用 `/build-api` → `/build-web`，每步 main thread 流式可见，每步用户决策门。

彻底解决：
- 工时不可证明（lookback join 并发错配）
- 黑盒（subagent 黑盒派发，用户看不到）
- 用户失语（盲盒严重）

**输入**：$ARGUMENTS

---

## Phase 1 — 前置校验

```bash
test -f docs/api-contract.yaml || { echo "❌ 请先运行 /design"; exit 1; }
[ -f "$DDT_PLUGIN_ROOT/bin/aggregate.mjs" ] || DDT_PLUGIN_ROOT=$(cat "${HOME}/.claude/delivery-metrics/.ddt-plugin-root" 2>/dev/null)
[ -f "$DDT_PLUGIN_ROOT/bin/aggregate.mjs" ] || DDT_PLUGIN_ROOT="${HOME}/.claude/plugins/marketplaces/digital-delivery-team"
[ -f "$DDT_PLUGIN_ROOT/bin/aggregate.mjs" ] || { echo "❌ DDT plugin root 未解析"; exit 1; }
export DDT_PLUGIN_ROOT
node "$DDT_PLUGIN_ROOT/bin/emit-phase.mjs" --phase impl --action start
"$DDT_PLUGIN_ROOT/bin/check-blockers.sh" || exit 2

# 契约 lint 硬门禁
if command -v npx >/dev/null 2>&1; then
  npx --yes @redocly/cli lint docs/api-contract.yaml || exit 4
else
  echo "OpenAPI lint tool missing"; exit 5
fi
```

## 串行执行流程

### Step 1: 后端实现（除非 --web-only）

```bash
if ! printf '%s' "$ARGUMENTS" | grep -q -- '--web-only'; then
  echo "▶ 进入后端实现：/build-api"
  # 透传 --module / --auto / --refresh
fi
```

main thread 调用 `/build-api $ARGUMENTS_FILTERED`（过滤掉 --web-only）。

`/build-api` 内部走 ECC 6-phase（EXPLORE → PLAN → APPROVE → IMPLEMENT → VERIFY → SUMMARY）+ 决策门：
- 用户在 PLAN 阶段批准 plan
- IMPLEMENT 每 step validation + checkpoint
- SUMMARY 后决策门 4 选项

**未传 --auto 时 main thread 必须等待 build-api 决策门返回 `accept` 才进入 Step 2**。

### Step 2: 前端实现（除非 --api-only）

```bash
if ! printf '%s' "$ARGUMENTS" | grep -q -- '--api-only'; then
  echo "▶ 进入前端实现：/build-web"
fi
```

main thread 调用 `/build-web $ARGUMENTS_FILTERED`（过滤掉 --api-only）。

`/build-web` 内部同样走 ECC 6-phase + 决策门。

**未传 --auto 时 main thread 必须等待 build-web 决策门返回 `accept` 才进入 Step 3**。

## Step 3 — 汇总输出

main thread 落 `docs/impl-summary.md`：

```markdown
# Impl Summary

## 已实现
- 后端 endpoint: <N>
- 前端页面: <M>
- 集成测试: <X>/<Y>
- 前端测试: <A>/<B>

## checkpoints
- build-api: <list of checkpoint shas>
- build-web: <list>

## 已知限制
- <如有 deferred / blockers>
```

```
/impl 完成

后端 endpoint:    <n>
前端页面:         <m>
后端测试通过率:   <passed> / <total>
前端测试通过率:   <passed> / <total>
checkpoint commits: <count>

✅ 建议下一步：/verify
```

## Phase 决策门 — M6.2

按 `skills/decision-gate/SKILL.md` 在 impl-summary 落盘后询问。

```bash
if ! printf '%s' "$ARGUMENTS" | grep -q -- '--auto'; then
  node "$DDT_PLUGIN_ROOT/bin/emit-decision.mjs" --phase impl --action point \
    --options "accept|modify|add|regenerate"
fi
```

```typescript
{
  questions: [{
    question: "前后端实现已完成，进入验收？",
    header: "Impl review",
    multiSelect: false,
    options: [
      { label: "接受并继续 (Recommended)",
         description: "进入 /verify",
         preview: "<docs/impl-summary.md 摘要>" },
      { label: "修改某个 endpoint 或页面", description: "我会指出哪个" },
      { label: "新增 endpoint 或页面", description: "我有遗漏的要补" },
      { label: "重新生成（带说明）", description: "整体不对" }
    ]
  }]
}
```

emit resolved 后按答案分支：
- accept → emit-phase end + 提示 /verify
- modify/add/regenerate → 询问具体 + 跑对应 `/build-api --refresh` 或 `/build-web --refresh`

## Phase 末 — 标记阶段完成

```bash
node "$DDT_PLUGIN_ROOT/bin/emit-phase.mjs" --phase impl --action end
```

## 与 v0.6.x 的差异

| v0.6.x（黑盒并行） | v0.7.0（透明串行） |
|------------------|-------------------|
| 同消息并行派发 frontend+backend agent | 串行 /build-api → /build-web |
| subagent 黑盒，写完才看到结果 | main thread 流式，每步可见 |
| 工时不可证明（lookback join 并发错配） | phase_runs 准确（无并发） |
| 用户全程是观察者 | 每个 phase 决策门，用户参与关键节点 |
| 无 validation loop | 每文件 validation，失败立即停 |
| 一次性大 commit | 每 step checkpoint commit |
| 无 --module 概念 | 支持 --module 分块多轮跑 |

## 参数

| 参数 | 行为 |
|------|------|
| `--web-only` | 只跑 /build-web（跳过 /build-api） |
| `--api-only` | 只跑 /build-api（跳过 /build-web） |
| `--auto` | 跳过所有决策门（兼容自动模式） |
| `--module <name>` | 透传给 build-api 与 build-web，分块实现 |
| `--refresh` | 透传，重新 EXPLORE + PLAN |

$ARGUMENTS
