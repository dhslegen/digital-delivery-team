---
name: ai-native-design
description: AI 原生 UI 设计与代码一体化工作流（claude-design / figma / v0 / lovable）。auto-loaded by frontend-agent；由 /import-design 命令显式触发。
origin: DDT
---

# AI-Native Design

## Triggers

- frontend-agent 启动 / `/build-web` 命令 / `/impl` 同时派发前后端
- `/import-design --from <type>` 命令显式触发外部设计源导入
- `.delivery/tech-stack.json::ai_design.type` 决定默认通道

## Core Principles

1. **设计与代码无缝衔接**：AI-native 工具产出的代码必须直接落入 `web/`，禁止"copy-paste 后重写"
2. **契约优先于设计**：设计稿中的字段名、状态码、错误提示，必须与 `docs/api-contract.yaml` 对齐；冲突时以契约为准
3. **栈约束**：所有 AI 生成的代码都需要符合 `tech-stack.json::frontend`（默认 React 18 + Tailwind + shadcn-ui）；非默认栈触发警告并写 blocker

---

## 四种通道

### 1. claude-design（默认 / 零依赖）

**适用场景**：纯 Claude 生成 UI；无外部账号或资产。

**工作流**：

1. frontend-agent 直接基于 PRD + api-contract.yaml + Tailwind/shadcn 调色板生成组件
2. 利用 `web-artifacts-builder` skill（如已安装）创建复杂 artifact 预览
3. 落地代码到 `web/components/` + `web/pages/`
4. 跑构建 + lint + 最小 happy-path 测试

**输出契约**：纯 React + TypeScript + Tailwind + shadcn-ui 组件文件；每个新页面 ≥ 1 个 happy-path 测试。

**Don't**：不要使用 Material UI / Ant Design / Chakra 等 shadcn 之外的 UI 库（会与 preset 不一致）。

---

### 2. figma（设计师→代码）

**适用场景**：有 Figma 设计稿；团队已部署 Figma MCP。

**前置依赖**：

- `figma-mcp-server` 已配置（参考 ECC `mcp-configs/`）
- 设计稿启用 Code Connect 映射（更佳）

**工作流**：

1. 用户提供 figma URL（含 `?node-id=...`）→ `/import-design --from figma --url <url>`
2. import-design 命令派发 frontend-agent + 调用 `mcp__figma__get_design_context`
3. agent 把 Figma 输出的 React+Tailwind 草稿与 `tech-stack.json::frontend.ui` 对齐
4. 字段命名 / 错误码 / 状态机以 `docs/api-contract.yaml` 为准；图层文字与契约不符时写 blocker
5. 落地 → 构建 → 测试

**输出契约**：与 claude-design 相同；额外在 `web/__designs__/` 保留 figma 节点 ID → 组件文件的 mapping table，便于后续设计变更追踪。

**Don't**：不要直接 fork figma 输出的 inline style；必须转 Tailwind utility class。

---

### 3. v0（Vercel）

**适用场景**：Next.js 14 / App Router 项目（preset = node-modern）；快速生成现代化 UI。

**前置依赖**：用户在 v0.dev 已生成组件 → 复制 v0 提供的安装命令（如 `npx shadcn@latest add ...`）

**工作流**：

1. 用户在 brief 或 CLI 指定 `--ai-design v0`
2. `/import-design --from v0 --url <v0-share-url>` 触发
3. frontend-agent 解析 v0 share URL 中的组件元数据，调用 `npx shadcn@latest add <component>` 拉入 `web/components/ui/`
4. 与 api-contract.yaml 对齐字段；不符则改 v0 输出，不改契约
5. 落地 → 构建 → 测试

**输出契约**：v0 的组件目录结构遵循 shadcn 标准（`web/components/ui/`）；每个 v0 引入的组件至少 1 个使用样例 + 1 个 happy-path 测试。

**Don't**：不要用 v0 生成与契约无关的 mock 数据替代真实 API client；必须接 OpenAPI 生成的 fetcher。

---

### 4. lovable（Lovable.dev）

**适用场景**：UI 重的 ToC 项目；preset = python-fastapi 或 node-modern。

**工作流**：

1. 用户在 Lovable.dev 建好原型 → 导出 zip / 拉取 git URL
2. `/import-design --from lovable --url <github-or-zip-url>` 触发
3. frontend-agent 解压 / clone 到临时目录，挑出 `src/` 下的组件 / 页面
4. 移植到 `web/` 同时改写：
   - 替换 lovable 默认的 supabase client 为 OpenAPI 生成的 client
   - 移除 lovable 特有的 `<Lovable.*>` 组件，用 shadcn 等价物
   - 路由从 react-router → 项目 preset 路由（next.js app router 或 react-router v6）
5. 跑构建 + lint + 测试

**输出契约**：与 claude-design 相同；额外 `web/__lovable-meta__.json` 保留 lovable 项目 ID 与导入时间戳。

**Don't**：不要保留 lovable 的 supabase 依赖（与 backend preset 数据库冲突）。

---

## 选择决策树

```
  preset = java-modern?     →  默认 claude-design（团队熟悉度高）
  preset = node-modern?     →  默认 v0（与 Next.js 14 + App Router 完美匹配）
  preset = python-fastapi?  →  默认 lovable（ToC 场景多）
  有 Figma 设计稿?           →  优先 figma 通道（带 design system token）
  无设计稿且要求快速?         →  claude-design 或 v0
  设计师团队较大且重交付?     →  figma 通道（保留可追溯设计源）
```

## 与契约的对齐检查（每条 import 必跑）

import-design 命令在派发 frontend-agent 后必须验证：

1. 生成代码中**不存在** `docs/api-contract.yaml` 之外的字段（用 grep + ripgrep）
2. 所有错误提示文案对应 `error.code` 枚举值（不出现裸字符串）
3. 路由定义匹配契约中的资源路径（`/users/:id` 而非 `/getUser/:id`）

任一不符 → 写 blocker → 不放行 PR。

## Templates & References

- `templates/api-contract.template.yaml`（契约模板，含 ErrorCode enum）
- `templates/tech-stack-presets.yaml`（preset 中的 ai_design 默认值）
- `commands/import-design.md`（触发命令）
- ECC `skills/web-artifacts-builder`（claude-design 通道的辅助 skill）
- ECC `mcp-configs/figma.json`（figma MCP 配置参考）
