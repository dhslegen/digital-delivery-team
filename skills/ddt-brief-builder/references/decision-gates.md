# 3 个关键决策门完整模板

> SKILL.md 引用本文件作 D1/D2/D3 的 AskUserQuestion 完整结构。
> 必须三个一次发出（同一条消息内 3 个 questions），让用户在 1 屏完成所有决策。

## D1 技术栈预设

```typescript
{
  question: "选择技术栈预设？影响 /design 阶段是否走交互问卷。",
  header: "技术栈",
  multiSelect: false,
  options: [
    { label: "<根据输入信号给的推荐> (Recommended)",
      description: "<对应 preset 的一句话>",
      preview: "<适合场景 + 一句技术栈摘要>" },
    { label: "<次选 1>", description: "..." },
    { label: "<次选 2>", description: "..." },
    { label: "interactive (走 4 步问卷)",
      description: "/design 时主动问语言/数据库/前端/UI 4 个问题",
      preview: "适合：不确定栈 / 需要严格定制 / 学习用途" },
  ]
}
```

**5 个 preset 速查**（详见 `tech-stack-quick-pick.md`）：

| preset | 后端 | 前端 | DB | 适合 |
|---|---|---|---|---|
| **java-modern** ⭐企业首选 | Spring Boot 3 + Java 21 | React + Vite + TS | PostgreSQL 16 | B2B 后台 / 高合规 / 长服役 |
| **java-traditional** | Spring Boot 2.7 + Java 17 | Thymeleaf SSR | MySQL 8 | 老 Java 团队 / 内部后台 |
| **node-modern** ⭐SaaS 首选 | NestJS + Node 22 | Next.js 14 + tRPC | Postgres + Prisma | SaaS / 全栈 TS / shadcn |
| **go-modern** | Go + Gin + sqlc | React + Vite + TS | PostgreSQL 16 | 高并发 / 微服务 / 网关 |
| **python-fastapi** ⭐AI 首选 | FastAPI + Python 3.12 | React + Vite + TS | Postgres + SQLAlchemy | AI/ML 集成 / 数据密集 |

## D2 前端类型（PR-E 三态）

```typescript
{
  question: "前端形态？这决定 build-web / design-brief / design-execute 是否启用。",
  header: "前端类型",
  multiSelect: false,
  options: [
    { label: "spa (Recommended)",
      description: "独立前端工程（React/Vue/Angular SPA）",
      preview: "走完整 design-brief → design-execute → build-web 链路" },
    { label: "server-side",
      description: "服务端渲染（Thymeleaf / JSP / JTE / Templ）",
      preview: "build-web 自动跳过，模板由 build-api 在 backend 内处理" },
    { label: "none",
      description: "纯 API / CLI / 库（无 UI）",
      preview: "design-brief / design-execute / build-web 全部跳过" },
  ]
}
```

**默认推断**：含"页面/界面/前端/UI/dashboard/后台/管理"等词推 `spa`；提到"API/服务/库/CLI/SDK"推 `none`；提到"管理后台 + Java 模板"推 `server-side`。

## D3 AI 设计通道（仅 frontend.type=spa 时问）

```typescript
{
  question: "选择 AI 设计通道？把 design-brief 派发到哪个外部工具生成 UI。",
  header: "AI UI 通道",
  multiSelect: false,
  options: [
    { label: "claude-design (Recommended)",
      description: "claude.ai/design Hi-fi 设计工具 → bundle/Handoff URL → DDT 摄取",
      preview: "适合：Claude 订阅用户 / 多文件项目 / 零外部账号" },
    { label: "figma",
      description: "Figma Make / First Draft → MCP get_design_context",
      preview: "适合：团队已有 Figma 设计师 / Figma MCP 已部署" },
    { label: "v0",
      description: "v0.dev share URL → npx shadcn add",
      preview: "适合：Next.js + Vercel 项目 / 视觉质量优先" },
  ]
}
```

**默认**：用户没明确说就推 `claude-design`（v0.8 起首选，零外部账号）。

详细差异（隐私 / 成本 / 适合场景）见 `ai-design-quick-pick.md`。

## 集中提问 vs 分次提问

**正确做法（v0.9.4 KPI）**：在 LLM 单条消息内同时发 3 个 AskUserQuestion——用户在 1 屏完成所有决策。

**反模式**：
- ❌ 先问 D1，等答案，再问 D2，再问 D3——用户多次决策疲劳
- ❌ 用普通对话问"你想用什么栈"——AI 不能解析自由文本，必须用 AskUserQuestion 结构化选项
- ❌ 替用户跳过决策门，自动选默认值——破坏 DDT 协作式原则

**触发跳过的合法情况**：
- frontend.type ≠ spa 时跳过 D3（不问，直接 N/A）
- 用户在自然语言里已**显式**说"用 java-modern" + "spa" + "claude-design" → 仍要发 AskUserQuestion 让用户**确认**（preview 标注"用户输入提示")，但默认选项即可
