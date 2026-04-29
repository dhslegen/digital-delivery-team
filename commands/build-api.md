---
description: 后端实现 · main thread + ECC 6-phase（EXPLORE→PLAN→APPROVE→IMPLEMENT→VERIFY→SUMMARY），不再黑盒派发 subagent
argument-hint: "[--module <name>] [--auto] [--refresh]"
---

# /build-api

按 `docs/api-contract.yaml` 与 `docs/data-model.md` 实现后端 API。M6.4 起改用 main thread + ECC 6-phase 范式，每步流式可见，每文件 validation，每 step checkpoint commit。

**输入**：$ARGUMENTS

---

## Phase 1 — 前置校验

```bash
test -f docs/api-contract.yaml || { echo "❌ 请先运行 /design"; exit 1; }
test -f docs/data-model.md || { echo "❌ 请先运行 /design 生成数据模型"; exit 1; }
[ -f "$DDT_PLUGIN_ROOT/bin/aggregate.mjs" ] || DDT_PLUGIN_ROOT=$(cat "${HOME}/.claude/delivery-metrics/.ddt-plugin-root" 2>/dev/null)
[ -f "$DDT_PLUGIN_ROOT/bin/aggregate.mjs" ] || DDT_PLUGIN_ROOT="${HOME}/.claude/plugins/marketplaces/digital-delivery-team"
[ -f "$DDT_PLUGIN_ROOT/bin/aggregate.mjs" ] || { echo "❌ DDT plugin root 未解析，请重启会话或运行 /digital-delivery-team:doctor"; exit 1; }
export DDT_PLUGIN_ROOT
node "$DDT_PLUGIN_ROOT/bin/emit-phase.mjs" --phase build-api --action start
"$DDT_PLUGIN_ROOT/bin/check-blockers.sh" || exit 2

# 契约 lint 硬门禁
if command -v npx >/dev/null 2>&1; then
  npx --yes @redocly/cli lint docs/api-contract.yaml || exit 4
else
  echo "OpenAPI lint tool missing"; exit 5
fi
```

## Phase 2 — EXPLORE（理解现有代码）

main thread **必读**：
- `skills/backend-development/SKILL.md`（实现知识包）
- `docs/api-contract.yaml` + `docs/data-model.md`
- `.ddt/tech-stack.json`

**EXPLORE 行动**：

如果 `server/` 已存在：用 Grep / Glob / Read 扫描结构、找类似实现作参照。
如果 `server/` 为空或缺失：跑 `tech-stack.json::backend.scaffold_cmd` 生成骨架。

落盘 `docs/build-api-exploration.md`（用户可见 — 去黑盒）：

```markdown
# Build-API Exploration

## 现有代码扫描结果
- 已有文件: <count>
- 框架: <detected>
- 测试套: <jest/vitest/junit/...>

## 类似实现参照
- <文件路径>: <pattern>

## 复用清单
- 复用: <类/函数>
- 不复用 + 原因: <...>

## 集成点
- DB 连接: <文件:行号>
- 错误处理: <middleware 位置>
- 日志: <logger 实例>
```

## Phase 3 — PLAN（implementation blueprint）

按 `skills/backend-development/SKILL.md::Phase 2 PLAN` 落 `docs/build-api-plan.md`：
- Files to Create / Modify 表
- Build Sequence（按依赖序：types → db → service → routing → middleware → entry）
- Validation Strategy（每步要跑什么 validation 命令）
- 估算时间

`--module <name>` 时只规划该模块。

## Phase 4 — APPROVE（用户决策门）

main thread 调用 `AskUserQuestion` 工具让用户批准 plan：

```bash
if ! printf '%s' "$ARGUMENTS" | grep -q -- '--auto'; then
  node "$DDT_PLUGIN_ROOT/bin/emit-decision.mjs" --phase build-api --action point \
    --options "approve|modify|reject|module-split"
fi
```

```typescript
{
  questions: [{
    question: "build-api Plan 已生成（N 个文件 / M 个 step），如何继续？",
    header: "Build-API plan",
    multiSelect: false,
    options: [
      { label: "批准并实现 (Recommended)",
         description: "进入 IMPLEMENT，按 plan 逐步写代码 + 每步 validation",
         preview: "<Files to Create 表 + Build Sequence 摘要>" },
      { label: "修改 plan 某个步骤", description: "我会指出哪步要改" },
      { label: "拒绝并重新规划", description: "整体方向不对" },
      { label: "拆分为多个模块（--module）", description: "复杂度太高，分块实现" }
    ]
  }]
}
```

未传 --auto 时 main thread **必须**等待用户答案：

| 答案 | 行为 |
|------|------|
| approve | 进入 IMPLEMENT |
| modify | 询问"哪步要改"，按答案 --refresh 改 plan，再走 APPROVE |
| reject | --refresh 重新 EXPLORE + PLAN |
| module-split | 询问"拆成哪几个模块"，建议 `--module <name>` 多轮跑 |

## Phase 5 — IMPLEMENT（main thread 流式 + validation loop + checkpoint）

按 `docs/build-api-plan.md::Build Sequence` 顺序，对每个 step：

1. **写代码**：用 Write / Edit 落实 step 中的文件（一次只做一个 step）
2. **立即 validation**（按 `skills/validation-loop/SKILL.md::Standard Mode`）：
   - 跑 build / lint / type-check / 当前 step 相关 test
   - 失败 → 触发 AskUserQuestion（4 选项：修复 / 跳过 / 回滚 / 重新规划）
3. **checkpoint commit**（按 `skills/checkpoint-commit/SKILL.md`）：
   - 通过后 git add + commit + 追加 .ddt/checkpoints.log

**关键**：不要批量写多个文件再测 — 每个 step 闭环 validation + checkpoint。

## Phase 6 — VERIFY（最终全量验收）

按 `skills/validation-loop/SKILL.md::Strict Mode`：

```bash
cd server && npm run build && npm run lint && npx tsc --noEmit
npm test --run

node "$DDT_PLUGIN_ROOT/bin/check-contract-alignment.mjs" server || exit 3
test -f server/Makefile && (cd server && make smoke) || true
```

任一失败 → 写 blocker → 停止。

## Phase 7 — SUMMARY

落 `docs/build-api-summary.md`：

```markdown
# Build-API Summary

## 已实现 endpoint（N 个）
- GET /tasks: 200 / 500
- POST /tasks: 201 / 400 / 422

## 测试结果
- 集成测试: 15/15 ✅
- 覆盖率: 92.96%

## checkpoint commits（N 个）
- abc1234: P1.1 db layer
- def5678: P1.2 task service

## smoke 启动
\`\`\`
cd server && npm run dev
curl http://localhost:3001/health
\`\`\`
```

## Phase 决策门 — M6.2

按 `skills/decision-gate/SKILL.md` 在 SUMMARY 落盘后询问"是否接受本轮实现"。

```bash
if ! printf '%s' "$ARGUMENTS" | grep -q -- '--auto'; then
  node "$DDT_PLUGIN_ROOT/bin/emit-decision.mjs" --phase build-api --action point \
    --options "accept|modify|add|regenerate"
fi
```

```typescript
{
  questions: [{
    question: "后端实现已完成（N 个 endpoint / 测试 X/X 通过 / 覆盖率 Y%），如何继续？",
    header: "Backend review",
    multiSelect: false,
    options: [
      { label: "接受并继续 (Recommended)",
         description: "进入 /build-web 或 /verify",
         preview: "<docs/build-api-summary.md 摘要>" },
      { label: "修改某个 endpoint", description: "我会指出哪个 + 怎么改" },
      { label: "新增 endpoint", description: "我有遗漏的接口要补充" },
      { label: "重新生成（带说明）", description: "整体不对" }
    ]
  }]
}
```

emit resolved 后按答案分支（同 decision-gate skill）。

## Phase 末 — 标记阶段完成

```bash
node "$DDT_PLUGIN_ROOT/bin/emit-phase.mjs" --phase build-api --action end
```

## --refresh

`--refresh` 重新 EXPLORE + PLAN 并增量更新：基于已有 server/ 代码增量补缺，**禁止**清空已实现部分；走完 APPROVE → IMPLEMENT → VERIFY → SUMMARY。

## --module

`--module <name>`：只实现该模块；多轮拼成完整后端（每轮独立 6-phase）。

$ARGUMENTS
