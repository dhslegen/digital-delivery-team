---
name: frontend-development
description: 前端实现知识包。auto-loaded by /build-web 与 /impl。当 main thread 实现 web/ 下代码时，本 skill 提供契约对齐 / UI 库规范 / AI 设计源接入 / Hard Requirements。M6.4 起替代 frontend-agent subagent，让实现过程在 main thread 流式可见。
origin: DDT
---

# Frontend Development · 前端实现知识包

> M6.4 整改：v0.6.x 用 frontend-agent subagent 黑盒派发。v0.7.0 改 main thread + 6-phase 范式。
> 本 skill 是 main thread 实现 web/ 时的"必读知识包"。

## Triggers

- `/build-web` 命令的 IMPLEMENT phase
- `/impl` 命令串行执行前端阶段
- 任何 main thread 写 `web/**/*.{tsx,ts,vue,html,css}` 文件时
- `/import-design --from <type>` 导入外部设计源时

## Inputs（main thread 必读清单）

- `docs/api-contract.yaml`（唯一接口真相源）
- `docs/prd.md`（UX 语义参考）
- `.ddt/tech-stack.json`（前端栈 + ai_design 选项 SSoT，禁止偏离）
- `skills/api-contract-first/SKILL.md`（契约优先原则）
- `skills/ai-native-design/SKILL.md`（AI 设计稿工作流：claude-design / figma / v0 / lovable）
- `contexts/delivery.md`（DDT 全局上下文）
- `rules/delivery/agent-invariants.md`（6 条全局不变量）

## Hard Requirements（main thread 必须遵守）

1. **严格按契约**：不得擅自发明字段、改字段名、改错误码（contract 不清写 blocker，不要猜）
2. **build/lint/typecheck**：完成后必须跑构建 + lint + type-check + 最小 happy-path UI 测试
3. **代码组织**：`web/` 目录；组件测试放 `web/__tests__/`
4. **统一 client**：所有网络调用走统一 client（自动从 OpenAPI 生成 types，如 `openapi-typescript`）
5. **栈刚性约束**：必须使用 `.ddt/tech-stack.json::frontend` 段定义的 framework / bundler / ui / state / data_fetching；禁止偏离
6. **AI-native UI 工作流**：按 `tech-stack.json::ai_design.type` 决定 UI 来源（claude-design / figma / v0 / lovable）
7. **SSoT 锁死**：`.ddt/tech-stack.json` 仅可 Read，**严禁 Write/Edit/MultiEdit**（PreToolUse hook 硬拦截）
8. **validation loop**：每完成一个组件立即跑 build / lint / type-check / 组件测试，失败立即停下

## 6-Phase 实施流程（main thread）

### Phase 1: EXPLORE

如果 `web/` 已有代码：
- 用 Grep / Glob / Read 扫描组件树 + 已有 hooks / store / api client
- 找类似页面作参照
- 落 `docs/build-web-exploration.md`

如果空目录：
- 跑 `tech-stack.json::frontend.scaffold_cmd`
- 落基础配置

### Phase 2: PLAN

落 `docs/build-web-plan.md`：组件树 / Files to Create / Build Sequence / Validation Strategy。
组件树视图让用户能扫一眼判断结构。

### Phase 3: APPROVE（由 build-web.md 触发）

调用 AskUserQuestion 让用户批准 plan。

### Phase 4: IMPLEMENT（main thread）

按 plan 逐步：写代码 → validation-loop → checkpoint commit。

若 `tech-stack.json::ai_design.type` 是 figma / v0 / lovable，先跑 `/import-design` 拉外部源。

### Phase 5: VERIFY

- vite build / eslint 0 errors / tsc --noEmit 0 errors / vitest run
- `bin/check-contract-alignment.mjs`（扫禁用模式 + 字段对齐）

### Phase 6: SUMMARY

落 `docs/build-web-summary.md`。

## --module 分块实现

```text
/build-web --module auth-pages
/build-web --module task-board
```

每轮独立 6-phase。

## AI-native UI 工作流（按 tech-stack.json::ai_design.type 选）

| type | 流程 |
|------|------|
| claude-design（默认） | main thread 基于 PRD + contract + shadcn 生成组件 |
| figma | `/import-design --from figma --url ...` → 调 figma MCP get_design_context → 转 React+Tailwind |
| v0 | `/import-design --from v0 --url <share>` → 解析 share URL → `npx shadcn@latest add ...` |
| lovable | `/import-design --from lovable --url <github>` → 移除 supabase → 接 OpenAPI client |

详见 `skills/ai-native-design/SKILL.md`。

## Self-Check

- [ ] 构建通过（vite build / next build 无报错）
- [ ] lint 0 error
- [ ] type-check 0 error
- [ ] 每个新页面有至少 1 个 happy-path 测试
- [ ] 未出现契约外字段（已全文搜索核查）
- [ ] 状态管理 / 数据获取与 tech-stack.json 一致
- [ ] tech-stack.json 未被 Edit（git diff 验证）

## Don't

- ❌ 不要随便加 antd / mui 等 tech-stack.json 外的 UI 库
- ❌ 不要硬编码 mock 数据替代 API client
- ❌ 不要保留 supabase / v0-sdk 等"AI 设计源框架默认依赖"

## Do

- ✅ EXPLORE 阶段先看现有 web/，避免重写
- ✅ PLAN 阶段提供组件树视图
- ✅ IMPLEMENT 每个组件立即 vitest run
- ✅ 复杂 UI 用 --module 分块

## Templates & References

- `skills/api-contract-first/SKILL.md`
- `skills/ai-native-design/SKILL.md`
- `skills/validation-loop/SKILL.md`
- `skills/checkpoint-commit/SKILL.md`
