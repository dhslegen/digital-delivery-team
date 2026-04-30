# Claude Design 项目设计任务 · {{PROJECT_NAME}}

> 由 ddt-derive-channel-package 自动生成。粘贴到 [https://claude.ai/design](https://claude.ai/design) 项目对话框首条消息。
> 附件包同时拖入 uploads（7 个文件）。

---

## 上下文（已上传附件，请先扫一遍）

- **01-design-brief.md**：完整 10 字段 Brief，已显式回答你可能会问的所有问题
  （scope / vibe / brand_color / innovation / variations / data 等），**不要再问这些**
- **02-prd.md**：产品 PRD，含 user stories
- **03-api-contract.yaml**：OpenAPI 3.0 契约 — **决定页面数据形态**
- **04-tech-stack.json**：锁定栈（React 18 + Vite + TypeScript + Tailwind + shadcn-ui）
- **05-design-tokens.json**：已定的设计 token，**请直接采用，不要重新设计**
- **06-components-inventory.md**：现有 shadcn 组件清单，**请复用而非新造**
- **07-references/**：参考截图（如有）

---

## 项目模式（强制 2 步）

### Step 1：先创建 Design System

基于 `05-design-tokens.json` 创建命名为 `{{PROJECT_NAME}}-ds` 的 Design System 项目。
**不要在此项目里画屏幕**，只建：colors / typography / spacing / radius / motion / 基础组件（按 06-components-inventory.md 清单）。

### Step 2：基于 Design System spawn Hi-fi design 项目

逐屏实现 brief §4 Screen Inventory，**每屏 1 个独立的 Hi-fi design 子项目**或 1 个 Page，便于反向 Handoff 时 DDT 摄取。

---

## Visual Direction（已锁定）

**风格方向**：`{{VISUAL_DIRECTION}}`

**理由**：{{VISUAL_DIRECTION_RATIONALE}}

> ⚠️ 不要混搭其他风格。9 种方向是单选。如果你想改方向，先输出"建议改为 X，理由 Y"让用户决策，**不要直接换风格**。

---

## 输入约束

- 不要问 scope / vibe / brand_color / innovation——已在 brief 显式回答
- 如有不清楚的字段（来自 OpenAPI），问"哪个 endpoint 的哪个字段"，而非泛泛"什么数据"
- 输出文件命名要求：
  - `components/<screen-name>.jsx`（每文件 < 1000 行）
  - `stylesheets/<screen-name>.css`
  - `tokens.css`（标准 CSS variables，从 05-design-tokens.json 派生）

---

## 输出约束（与 DDT 项目契约对齐）

### 必须

- **tokens.css 标准 CSS variables**：`--color-primary` 而非 `color-primary`，能直接被 Tailwind config 引用
- **shadcn-ui composition pattern**：使用 `<FieldGroup>` / `<ToggleGroup>` 等模式，不要新造同名组件
- **8 状态显式输出**：每个交互组件画 `default / hover / active / disabled / focus / loading / empty / error / success`
  - ⚠️ Claude Design 默认 miss `empty / error / loading`，**必须主动输出**
- **JSX 单文件 < 1000 行**：超出请拆分子组件
- **React 18 + 标准 JSX**：不依赖 Anthropic 私有库
- **数据形态 100% 匹配 03-api-contract.yaml**：字段名 / 类型 / 必填一致

### 禁止

- ❌ 重新生成 design tokens（用 05-design-tokens.json）
- ❌ 重新设计已有组件（参考 06-components-inventory.md 复用）
- ❌ 用 `fetch('/api/...')` / `axios.get(...)` —— DDT 后续会替换为 OpenAPI client
- ❌ 用 mock 数据 / placeholder（数据形态从 03-api-contract.yaml 推导）
- ❌ 用 localStorage / sessionStorage 存业务态（DDT 项目用 zustand persist）

---

## 反 AI-slop 黑名单（11 条强制，逐字遵守）

{{ANTI_PATTERNS_BLOCK}}

---

## User Stories（来自 brief §2）

{{USER_STORIES_BLOCK}}

---

## Screen Inventory（来自 brief §4）

{{SCREEN_INVENTORY_PLACEHOLDER}}

> 注：完整内容在 01-design-brief.md §4，本段仅作快速对照。每屏要画的状态见 brief §5（Component States 8 状态矩阵）。

---

## Design Tokens 摘要（详见 05-design-tokens.json）

{{TOKENS_SUMMARY}}

---

## API Endpoints 摘要（来自 brief §6）

{{ENDPOINTS_SUMMARY}}

> ⚠️ 详细 schema 见 03-api-contract.yaml。每个 endpoint 的 request/response 字段名、类型、必填项**必须严格一致**。

---

## 完成后如何回贴

请用以下两种方式之一把 design bundle 传回 DDT：

1. **优选**：`Share → Handoff to Claude Code → Local coding agent`
   （DDT 已在监听 Handoff bundle 落盘路径，会自动接管）

2. **备选**：`Download as .zip` → 在 Claude Code 中跑：

   ```
   /design-execute --channel claude-design --bundle <zip-path>
   ```

DDT 会自动：
- 解压 bundle 到 `.ddt/design/claude-design/raw/`
- 改写 `tokens.css → web/styles/tokens.css` + 注入 tailwind.config.js
- 改写 `components/*.jsx → web/components/` 适配项目结构
- 替换所有 fetch 为 `web/lib/api-client.ts`（OpenAPI 生成）
- 跑构建 + lint + 测试 + 10 维评分决策门
