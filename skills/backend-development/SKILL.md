---
name: backend-development
description: 后端实现知识包。auto-loaded by /build-api 与 /impl。当 main thread 实现 server/ 下代码时，本 skill 提供契约对齐 / 数据层规范 / 测试策略 / Hard Requirements。M6.4 起替代 backend-agent subagent，让实现过程在 main thread 流式可见。
origin: DDT
---

# Backend Development · 后端实现知识包

> M6.4 整改：v0.6.x 用 backend-agent subagent 黑盒派发，工时不可控、用户看不到中间步骤。
> v0.7.0 改 main thread + 6-phase 范式（EXPLORE→PLAN→APPROVE→IMPLEMENT→VERIFY→SUMMARY）。
> 本 skill 是 main thread 实现 server/ 时的"必读知识包"，不再是 subagent。

## Triggers

- `/build-api` 命令的 IMPLEMENT phase
- `/impl` 命令串行执行后端阶段
- 任何 main thread 写 `server/**/*.{ts,js,java,py,go}` 文件时

## Inputs（main thread 必读清单）

- `docs/api-contract.yaml`（唯一接口真相源）
- `docs/data-model.md`（数据层真相源）
- `.ddt/tech-stack.json`（栈选型 SSoT，禁止偏离）
- `skills/api-contract-first/SKILL.md`（契约优先原则）
- `contexts/delivery.md`（DDT 全局上下文）
- `rules/delivery/agent-invariants.md`（6 条全局不变量）
- `rules/delivery/contract-integrity.md`（契约完整性）
- 当前栈对应的 TDD skill（如 `skills/springboot-tdd`，若 ECC 已安装）

## Hard Requirements（main thread 必须遵守）

1. **契约 100% 匹配**：每个 endpoint 的 request / response / error 必须 100% 匹配 `docs/api-contract.yaml`
2. **每个 endpoint 配集成测试**：不合格不得提交（验证 happy path + 至少 1 个 edge case）
3. **事务边界**：数据层操作必须在 `data-model.md` 声明的事务边界内
4. **migration + smoke test**：跑 migration（如有 schema 变更）+ 本地 smoke test（health check + 简单 CRUD 路径）
5. **日志 requestId**：所有日志必须含 `requestId` 与关键业务字段（脱敏后）
6. **栈刚性约束**：必须使用 `.ddt/tech-stack.json::backend` 段定义的 language / framework / build / database / orm / testing；禁止偏离 preset
7. **SSoT 锁死**：`.ddt/tech-stack.json` 仅可 Read，**严禁 Write/Edit/MultiEdit**（PreToolUse hook 会硬拦截）
8. **validation loop**：每完成一个文件立即跑 build / lint / type-check / test（按 `skills/validation-loop/SKILL.md`）失败立即停下决策

## 6-Phase 实施流程（main thread）

### Phase 1: EXPLORE（理解现有代码）

如果 `server/` 已有代码：
- 用 `Grep` / `Glob` / `Read` 扫描现有结构
- 识别已有的 routing / middleware / db client / 测试套
- 找类似实现作参照（如已有 GET /tasks 实现，新增 POST /tasks 应沿用相同 pattern）
- 记录约定到 `docs/build-api-exploration.md`（用户可见 - 去黑盒）

如果 `server/` 是空目录：
- 跑 `tech-stack.json::backend.scaffold_cmd` 生成项目骨架
- 落 `server/package.json` / `pom.xml` / `go.mod` 等

### Phase 2: PLAN（implementation blueprint）

按 `tech-stack.json::backend` 与契约设计实现 plan，落 `docs/build-api-plan.md`：

```markdown
# Build-API Implementation Plan

## Files to Create
| 文件 | 角色 | 优先级 |
|------|------|--------|
| server/src/db.ts | DB 连接 + migration runner | P0 |
| server/src/routes/tasks.ts | tasks endpoint | P0 |
| server/src/services/taskService.ts | 业务逻辑 | P0 |
| server/src/middleware/errorHandler.ts | 全局错误处理 | P0 |
| server/tests/tasks.spec.ts | 集成测试 | P0 |

## Build Sequence（依赖序）
1. types & contracts（生成 OpenAPI types）
2. db layer（migration + connection）
3. service layer（业务逻辑 + 单测）
4. routing layer（endpoint + 集成测试）
5. middleware（errorHandler / requestId / logging）
6. main entry（server.ts 启动 + 路由注册）

## Validation Strategy（每步要跑什么）
- step 1-2: tsc --noEmit
- step 3: jest src/services/*.spec.ts
- step 4: jest tests/*.spec.ts （集成测试）
- step 5-6: npm run smoke
```

### Phase 3: APPROVE（用户决策门，由 build-api.md 触发）

由 commands/build-api.md 调用 AskUserQuestion 让用户批准 plan。
用户接受 → 进入 IMPLEMENT；否则修改 plan → 再批准。

### Phase 4: IMPLEMENT（按 plan 逐步，main thread 流式可见）

对 plan 中每个 step：

1. **写代码**：`Write` / `Edit` 落实 step 中的文件（一次只做一个 step）
2. **立即 validation**（按 `skills/validation-loop/SKILL.md`）：
   - 运行 step 对应的 validation 命令
   - 失败 → 停下来 + 在屏幕显示失败原因 → 让用户决策（修复 / 跳过 / 重新规划）
3. **checkpoint commit**（按 `skills/checkpoint-commit/SKILL.md`）：
   - 跑通后 git commit，message 含 step 编号 + 简述

不要一次性写 10 个文件然后跑一次测试——每个文件都要 validation。

### Phase 5: VERIFY（最终验收）

按 `skills/validation-loop/SKILL.md::strict mode`：
- 全量 build
- 全量 lint
- 全量 type-check
- 全量 test（含集成 + 单元 + smoke）
- 契约对齐检查：每个 endpoint 的实际响应与 `api-contract.yaml` schema 对照

任一失败 → 写 blocker → 停止。

### Phase 6: SUMMARY

落 `docs/build-api-summary.md`：

```markdown
# Build-API Summary

## 已实现 endpoint（N 个）
- GET /tasks: 200 / 500
- POST /tasks: 201 / 400 / 422
- ...

## 测试结果
- 集成测试: 15/15 ✅
- 单元测试: 8/8 ✅
- 覆盖率: 92.96%

## checkpoint commits（N 个）
- abc1234: P1.1 db layer
- def5678: P1.2 task service
- ...

## 已知 limitations
- 暂未实现批量 PATCH（v2 计划）

## 跑 smoke
\`\`\`
cd server && npm run dev
curl http://localhost:3001/health
\`\`\`
```

## --module 分块实现

复杂需求 wbs 含多个模块时，可按模块分轮：

```text
/build-api --module auth        # 只实现认证模块
# (走完 6 phase)
/build-api --module tasks       # 只实现任务模块
# (走完 6 phase)
/build-api --module stats       # 只实现统计模块
```

每轮独立 EXPLORE → PLAN → APPROVE → IMPLEMENT → VERIFY → SUMMARY。
不带 `--module` 时实现 wbs 中所有未完成的后端任务。

## 与 v0.6.x backend-agent 的差异

| 维度 | v0.6.x backend-agent (subagent) | v0.7.0 main thread + skill |
|------|--------------------------------|---------------------------|
| 执行环境 | Task 工具派发，黑盒 | main thread，每步可见 |
| 用户决策 | 写完才看到结果 | EXPLORE/PLAN 都落盘 + APPROVE 决策门 |
| validation | agent 内部 self-check | 每文件 validation loop，失败立即停 |
| 工时采集 | subagent_start/stop（v0.5.x bug 多） | phase_start/end + checkpoint commits（精确） |
| 复杂需求 | 一次性派发，写不完丢上下文 | --module 分块，多轮可控 |
| 上下文压力 | subagent 独立 context | main thread 单一 context（用 /relay 跨会话续作） |

## Self-Check（main thread 实现完成后必须验证）

- [ ] 所有 endpoint 响应匹配契约（已逐个核查 request / response / error）
- [ ] 每个 endpoint 有集成测试且通过
- [ ] migration 可正向 + 反向执行（若有 schema 变更）
- [ ] smoke test 通过
- [ ] 日志含 requestId（已全文搜索核查）
- [ ] tech-stack.json 未被任何 Edit 修改（git diff 验证）
- [ ] 每个 plan step 都有对应 checkpoint commit（git log 验证）

## Don't

- ❌ 不要一次性写 10 个文件然后批量测试 — 必须每文件 validation loop
- ❌ 不要为了跑通测试而绕过契约（如随便填个字段名）— 契约不清写 blocker
- ❌ 不要修改 docs/api-contract.yaml — 那是 architect 职责
- ❌ 不要修改 .ddt/tech-stack.json — PreToolUse hook 会硬拦截

## Do

- ✅ EXPLORE 阶段把发现写进 exploration.md，让用户看到你的思考
- ✅ PLAN 阶段提供 ≥ 2 个备选实现方案 + trade-off（用户在 APPROVE 决策门有得选）
- ✅ IMPLEMENT 每步立即 validation + checkpoint commit
- ✅ 复杂需求用 --module 分块（避免单次 token 爆炸）
- ✅ 失败立即停下问用户（不累积破损状态）

## Templates & References

- `templates/api-contract.template.yaml`（契约模板）
- `templates/data-model.template.md`（数据模型模板）
- `skills/api-contract-first/SKILL.md`（契约优先原则）
- `skills/validation-loop/SKILL.md`（每步验证）
- `skills/checkpoint-commit/SKILL.md`（git checkpoint）
- ECC `skills/springboot-tdd`（如已安装，Java 项目首选）
- ECC `commands/feature-dev.md`（6-phase 范式参考来源）
- ECC `commands/prp-implement.md`（validation loop 范式参考）
