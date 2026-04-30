---
description: 前端实现 · main thread + 6-phase（EXPLORE→PLAN→APPROVE→IMPLEMENT→VERIFY→SUMMARY），不再黑盒派发 subagent
argument-hint: "[--module <name>] [--auto] [--refresh]"
---

# /build-web

按 `docs/api-contract.yaml` 与 `docs/prd.md` UX 语义实现前端 UI。M6.4 起改用 main thread + 6-phase 范式，每组件流式可见，每文件 validation，每 step checkpoint commit。

**输入**：$ARGUMENTS

---

## Phase 1 — 前置校验

```bash
test -f docs/api-contract.yaml || { echo "❌ 请先运行 /design"; exit 1; }
test -f docs/prd.md || { echo "❌ 请先运行 /prd"; exit 1; }
[ -f "$DDT_PLUGIN_ROOT/bin/aggregate.mjs" ] || DDT_PLUGIN_ROOT=$(cat "${HOME}/.claude/delivery-metrics/.ddt-plugin-root" 2>/dev/null)
[ -f "$DDT_PLUGIN_ROOT/bin/aggregate.mjs" ] || DDT_PLUGIN_ROOT="${HOME}/.claude/plugins/marketplaces/digital-delivery-team"
[ -f "$DDT_PLUGIN_ROOT/bin/aggregate.mjs" ] || { echo "❌ DDT plugin root 未解析"; exit 1; }
export DDT_PLUGIN_ROOT
node "$DDT_PLUGIN_ROOT/bin/emit-phase.mjs" --phase build-web --action start
"$DDT_PLUGIN_ROOT/bin/check-blockers.sh" || exit 2

if command -v npx >/dev/null 2>&1; then
  npx --yes @redocly/cli lint docs/api-contract.yaml || exit 4
fi

# PR-E：frontend.type !== 'spa' 时直接 noop 退出，不创建 web/ 工程
#   server-side（Thymeleaf/JSP/...）→ 模板由 /build-api 在 backend 项目里处理
#   none / api-only / cli                → 无前端工程
FRONT_TYPE=$(node "$DDT_PLUGIN_ROOT/bin/get-frontend-type.mjs" 2>/dev/null)
if [ "$FRONT_TYPE" = "server-side" ] || [ "$FRONT_TYPE" = "none" ]; then
  echo "ℹ️  frontend.type=$FRONT_TYPE，/build-web 跳过：服务端渲染由 /build-api 在 backend 项目内处理（src/main/resources/templates 等）；纯 API/CLI 无前端工程。"
  node "$DDT_PLUGIN_ROOT/bin/emit-phase.mjs" --phase build-web --action end
  exit 0
fi
```

## Phase 2 — EXPLORE

main thread **必读**：
- `skills/frontend-development/SKILL.md`
- `skills/api-contract-first/SKILL.md`
- `skills/ai-native-design/SKILL.md`
- `docs/api-contract.yaml` + `docs/prd.md`
- `.ddt/tech-stack.json::frontend` + `.ddt/tech-stack.json::ai_design`

**EXPLORE 行动**（仅当 `frontend.type === "spa"` 进入此 phase）：

如果 `web/` 已存在：扫描组件树 + 已有 hooks / store / api client；找类似页面参照。
如果 `web/` 为空：跑 `tech-stack.json::frontend.scaffold_cmd`（如 `npm create vite@latest web -- --template react-ts`）+ 落基础配置（tailwind / shadcn）。

> Phase 1 已根据 `.ddt/tech-stack.json::frontend.type` 判断：`server-side` / `none` 类型已提前退出，不会进入 EXPLORE。

落盘 `docs/build-web-exploration.md`：

```markdown
# Build-Web Exploration

## 现有组件树
- App
  - Layout
    - <已有>

## 框架与依赖
- 框架: <react-vite / nextjs / vue-vite ...>
- UI 库: <tailwind+shadcn / antd / element-plus ...>
- 状态: <zustand / pinia / signals ...>

## 类似页面参照
- <文件路径>: <pattern>

## AI 设计源
- type: <claude-design / figma / v0>
- design brief 是否就绪: <yes/no>（无则先 `/design-brief` 编译）
- 是否需要先跑 /design-execute --channel <X>: <yes/no>
```

## Phase 3 — PLAN

按 `skills/frontend-development/SKILL.md::Phase 2 PLAN` 落 `docs/build-web-plan.md`：

- 完整组件树视图
- Files to Create / Modify
- Build Sequence（types → api client → atoms → molecules → pages → tests）
- Validation Strategy
- AI 设计源接入说明（若 ai_design.type 非 claude-design 且 brief 未派发，先跑 `/design-brief` 再 `/design-execute --channel <type>`）

`--module <name>` 时只规划该模块（如 `--module task-board` 只规划看板页相关组件）。

## Phase 4 — APPROVE

main thread 调用 `AskUserQuestion` 工具让用户批准 plan：

```bash
if ! printf '%s' "$ARGUMENTS" | grep -q -- '--auto'; then
  node "$DDT_PLUGIN_ROOT/bin/emit-decision.mjs" --phase build-web --action point \
    --options "approve|modify|reject|module-split"
fi
```

```typescript
{
  questions: [{
    question: "build-web Plan 已生成（N 个组件 / M 个 step），如何继续？",
    header: "Build-Web plan",
    multiSelect: false,
    options: [
      { label: "批准并实现 (Recommended)",
         description: "进入 IMPLEMENT",
         preview: "<组件树 + Build Sequence 摘要>" },
      { label: "修改 plan 某个步骤", description: "我会指出哪步要改" },
      { label: "拒绝并重新规划", description: "整体方向不对" },
      { label: "拆分为多个模块（--module）", description: "分块实现" }
    ]
  }]
}
```

按 decision-gate skill 处理答案。

## Phase 5 — IMPLEMENT

按 plan Build Sequence 逐步：

1. 写代码（Write / Edit）
2. validation-loop standard mode（tsc / eslint / vitest 当前 step spec）
3. checkpoint commit + 追加 checkpoints.log

`tech-stack.json::ai_design.type` 决定如何写 UI：

| type | 行为 |
|------|------|
| claude-design | `/design-execute --channel claude-design` → 用户在 claude.ai/design 迭代 → `--bundle <zip>` 摄取 → main thread 按 ai-native-design SKILL §7 改写 |
| figma | `/design-execute --channel figma` → 写 MCP 引导清单 → main thread 调 figma MCP get_design_context → 按 SKILL §7 转 React+Tailwind |
| v0 | `/design-execute --channel v0 --url <share>` → 解析 share URL → `npx shadcn@latest add <component>` |

## Phase 6 — VERIFY

```bash
cd web
npm run build              # 必须无 error
npm run lint               # 0 errors
npx tsc --noEmit           # 0 errors
npm test --run             # 全部通过

node "$DDT_PLUGIN_ROOT/bin/check-contract-alignment.mjs" web || exit 3
```

## Phase 7 — SUMMARY

落 `docs/build-web-summary.md`：

```markdown
# Build-Web Summary

## 已实现页面（N 个）
- TaskBoard: 主看板页
- ...

## 测试结果
- happy-path: 6/6 ✅
- edge case: 4/4 ✅

## checkpoint commits（N 个）

## bundle size
- web/dist: <size>

## 启动
\`\`\`
cd web && npm run dev
\`\`\`
```

## Phase 决策门 — M6.2

```bash
if ! printf '%s' "$ARGUMENTS" | grep -q -- '--auto'; then
  node "$DDT_PLUGIN_ROOT/bin/emit-decision.mjs" --phase build-web --action point \
    --options "accept|modify|add|regenerate"
fi
```

```typescript
{
  questions: [{
    question: "前端实现已完成（N 个页面 / X/X 测试通过），如何继续？",
    header: "Frontend review",
    multiSelect: false,
    options: [
      { label: "接受并继续 (Recommended)",
         description: "进入 /verify",
         preview: "<docs/build-web-summary.md 摘要>" },
      { label: "修改某个页面", description: "我会指出哪个" },
      { label: "新增页面", description: "我有遗漏的页面要补充" },
      { label: "重新生成（带说明）", description: "整体不对" }
    ]
  }]
}
```

按 decision-gate skill 处理。

## Phase 末 — 标记阶段完成

```bash
node "$DDT_PLUGIN_ROOT/bin/emit-phase.mjs" --phase build-web --action end
```

## --refresh

`--refresh` 重新 EXPLORE + PLAN 并增量更新现有 web/ 代码；**禁止**清空已实现的页面或组件。

## --module

`--module <name>`：只实现该模块；多轮独立 6-phase 跑齐复杂 UI。

$ARGUMENTS
