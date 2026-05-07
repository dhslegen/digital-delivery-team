# AI-native UI 通道 3 选 1 速查（决策门 D3）

> 仅 frontend.type=spa 时问 D3。本表是每个通道的"何时该选"。

| 通道 | 外部工具 | 用户成本 | 适合场景 | 不适合 |
|---|---|---|---|---|
| **claude-design** ⭐v0.8+ 首选 | claude.ai/design | 已有 Claude Pro/Max/Team/Enterprise 订阅，无需额外账号 | Claude 用户 / 多文件项目 / 零外部依赖 / 高保真静态布局 | 无 Claude 订阅 / Enterprise 默认 OFF（需 admin 开） |
| **figma** | Figma + Figma MCP | 需 Figma 账号 + Figma MCP server 部署 | 团队已有 Figma 设计师 / Figma MCP 已部署 / 需要严格 token 同步 | 个人开发者（Figma 团队费）/ 没有现成设计稿 |
| **v0** | v0.dev (Vercel) | 需 Vercel 账号 + v0 订阅 | Next.js + Vercel 项目 / 视觉质量优先 / shadcn-ui 深度集成 | 非 Next.js 项目 / 不想用 v0 share URL（半公开） |

---

## 决策助手（输入 → 推荐通道）

| 用户输入暗示 | 推荐 |
|---|---|
| "Claude 订阅 / 已订阅 Pro / Anthropic" | claude-design |
| "团队有 Figma / 设计稿在 Figma / 已部署 Figma MCP" | figma |
| "用 v0 / Next.js + Vercel / shadcn 重度使用 / v0.dev" | v0 |
| "比赛项目 / 个人 / 没有外部账号 / 零成本" | claude-design |
| **任何不在以上的场景** | **claude-design**（默认推荐） |

---

## 三通道关键差异（让用户在 AskUserQuestion preview 里能选准）

### claude-design

- **流程**：跑 `/design-execute --channel claude-design` → 用户去 claude.ai/design → 完成后 Share → Handoff to Claude Code（URL）→ DDT 摄取（v0.8.2 D14 后支持 --url）
- **产物**：JSX < 1000 行 / 文件 + tokens.css（标准 CSS variables）+ chats/*.md（设计决策追溯）
- **DDT 摄取**：`bin/ingest-claude-design.mjs --bundle <zip|tar.gz> | --url <handoff>` — **/design-execute 阶段**全量摄取到 `.ddt/design/`，brief 阶段不处理（v0.9.10 D27 收敛）
- **隐私**：bundle 在 claude.ai/design 项目内，不公开

#### 框架推荐（宽松，由 /design-brief 阶段精细化）

Bundle 里的 prototype 是 **HTML + JSX + tokens.css**，README 明说 "recreate them pixel-perfectly in whatever technology fits（React, Vue, native, whatever）"。

| frontend.framework | 与 claude-design 的契合度 |
|---|---|
| **react** | ⭐ **零迁移**（bundle .jsx 直接抄） |
| vue / svelte / angular | 可用，需重写组件结构（具体改造路径由 /design-brief 阶段决定） |

> ⚠️ brief 阶段**不强制 React**，仅在 §6 写 vue/svelte + ai_design=claude-design 时给软警告（cross-validation D26）。这只是"提示"，不是 block。  
> 真正的设计层细化（哪个 framework / 哪个 UI 库 / 怎么映射 tokens）属于 `/design-brief` 范围——brief 应保持宽松，给后续阶段留决策空间。

#### UI 库与 tokens.css 解耦（重要）

tokens.css 是 W3C Design Tokens 风格 CSS variables，可以映射到**任何 UI 库**的主题系统：
- **AntD 5** ConfigProvider 通过 antd-theme.ts 映射
- **shadcn-ui** 直接消费 CSS variables
- **MUI 5** ThemeProvider 转 mapping
- **Chakra UI** theme.tokens 映射

因此 claude-design **不锁定 UI 库**——按场景选（详见 `ui-library-by-scenario.md`）。常见组合：B2B 中后台 → AntD 5；SaaS C 端 → shadcn-ui。具体由 /design-brief 阶段确认，brief 只填粗略建议。

### figma

- **流程**：跑 `/design-execute --channel figma` → 用户在 Figma Make / First Draft 完成 → DDT 用 figma-mcp 拉 design context
- **产物**：Figma 节点 → 自动转 React/Tailwind 代码（依赖 Figma MCP 实现质量）
- **DDT 摄取**：`bin/ingest-figma-context.mjs --url <figma-file-url>`
- **隐私**：取决于 Figma 文件分享设置

### v0

- **流程**：跑 `/design-execute --channel v0` → 用户在 v0.dev 完成 → 拿 share URL → DDT 摄取
- **产物**：shadcn-ui 组件 React 代码
- **DDT 摄取**：`bin/ingest-v0-share.mjs --url <v0-share-url>`
- **隐私**：share URL 半公开（任何人有 URL 都能看）

---

## 反模式

- ❌ frontend.type ≠ spa 时还问 D3 → 直接 N/A，不问
- ❌ 用户说 "用 Figma 设计" 就推 figma → 还要问"有 Figma MCP 吗？"——没 MCP 推 claude-design 替代
- ❌ 比赛项目推 figma 或 v0 → 这两个都需要付费/账号成本，比赛优先 claude-design

---

## 与 /design-execute 的对齐契约

brief 的 "AI-native UI" 字段值会被 `/design` Phase 2b 写入 `.ddt/tech-stack.json::ai_design.type`。`/design-execute` 命令读这个字段决定派发到哪个通道。

**本 skill 必须确保 D3 决策门后写入的值在以下枚举**：
`claude-design | figma | v0 | none`

`none` 表示用户不需要 AI 设计源（直接手写代码）——`/design-execute` 命令会跳过。
