---
name: api-contract-first
description: Knowledge pack for designing and evolving OpenAPI 3.0 contracts that enable frontend/backend parallel development. Auto-loaded by architect-agent；由 /build-api / /build-web main thread 在实现阶段流式加载（M6.4 起替代 backend/frontend-agent 黑盒派发）。
origin: DDT
---

# API Contract First

## Triggers
- architect-agent 启动 / `/design` 命令（写契约）
- `/build-api` / `/build-web` main thread 加载 backend-development / frontend-development skill 时只读链入（契约消费方，M6.4 起 main thread 直接执行而非 subagent）

## Core Principles
1. **契约先于代码**：没有 lint 通过的 OpenAPI，不允许动 web/ 或 server/
2. **契约是唯一真相源**：UI 文案、错误提示、日志格式以外的所有接口约定必须出自契约
3. **契约变更 = 事件**：每次契约变更在 `docs/arch.md` 的 ADR 章节追加一条，说明原因、影响面、兼容策略

## Design Rules

### URL 结构（DDT 标准）
```
# 资源名：名词、复数、小写、kebab-case
GET    /api/v1/users
POST   /api/v1/users
GET    /api/v1/users/:id
PUT    /api/v1/users/:id
PATCH  /api/v1/users/:id
DELETE /api/v1/users/:id

# 子资源（所有权关系）
GET    /api/v1/users/:id/orders

# 动作（谨慎使用，限非 CRUD）
POST   /api/v1/orders/:id/cancel
```

### 字段约束
- 所有字段含 `type` / `required` / `description` / `example`
- 所有错误响应用枚举（`error.code`）+ 人类可读 message，避免只有数字码
- 分页统一：`page` + `pageSize` + `total`，或游标 `cursor` + `nextCursor` 二选一，**全局一致**
- 幂等操作必须声明 `Idempotency-Key` header
- 所有时间字段 ISO-8601 UTC

### HTTP 状态码（强制）
```
200 OK                    — GET/PUT/PATCH 有响应体
201 Created               — POST 成功（含 Location header）
204 No Content            — DELETE/PUT 无响应体
400 Bad Request           — 格式错误、缺少必填字段
401 Unauthorized          — 未认证
403 Forbidden             — 已认证但无权限
404 Not Found             — 资源不存在
409 Conflict              — 重复创建、状态冲突
422 Unprocessable Entity  — 语义非法（格式合法但业务无效）
429 Too Many Requests     — 限流（含 Retry-After header）
500 Internal Server Error — 不暴露内部细节
```

### 分页（二选一，全局保持一致）
- **Offset**（小数据集 < 10K / 管理后台）：`?page=2&pageSize=20`
- **Cursor**（大数据集 / 无限滚动）：`?cursor=<opaque>&limit=20`，响应含 `nextCursor`

### 版本化策略（ADR）
```
1. URL Path 版本（推荐）：/api/v1/ → /api/v2/
2. 不破坏性变更不需要新版本：
   - 新增可选字段、新增端点、新增可选查询参数
3. 破坏性变更必须新版本：
   - 删改字段名/类型、改 URL 结构、改认证方式
4. 废弃策略：宣告（6 个月） → Sunset header → 410 Gone
```

## Do
- 用 `npx @redocly/cli lint` 跑 schema lint，lint 必须通过后才能进入实现阶段
- 用 `openapi-typescript` 或等价工具生成前端 types
- 用 `openapi-generator` 或等价工具生成后端路由骨架
- 每个 endpoint 含完整的 request / response / error 示例（见 `templates/api-contract.template.yaml`）

## Don't
- 不在代码里偷偷加字段再"回头补契约"（即"代码先于契约"）
- 不把 UI 状态字段放进 API 契约（那是前端 state，不属于接口定义）
- 不把内部实现细节（SQL 列名、内部枚举值）泄露到 API
- 不使用 `200` 返回所有场景（"200 for everything" 反模式）

## ADR 格式（契约变更必须附此记录）
```
### ADR-NNN: <决策标题>
- **日期**：YYYY-MM-DD
- **状态**：提议 / 接受 / 废弃
- **背景**：为什么要做此变更
- **方案 A**：... | **方案 B**：...
- **Trade-off 表**：| 维度 | A | B |
- **决策**：选 X，原因 Y
- **影响面**：前端 / 后端 / 测试 / 文档
- **兼容策略**：向前兼容 / 版本递升 / 废弃通知
```

## Templates & References
- `templates/api-contract.template.yaml`（含 ErrorCode enum 示例）
- `bin/aggregate.mjs`（事件数据结构参考，与契约字段保持一致）
