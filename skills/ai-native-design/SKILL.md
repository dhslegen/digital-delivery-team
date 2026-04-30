---
name: ai-native-design
description: AI 原生 UI 设计与代码一体化工作流。3 通道（claude-design / figma / v0）从 design-brief.md 派生 prompt + 附件包，用户在外部工具完成迭代，DDT 摄取设计源后 main thread 改写为 web/ 项目契约对齐代码。由 /design-brief 与 /design-execute 自动加载；/build-web main thread 进入 IMPLEMENT phase 时加载。
origin: DDT
---

# AI-Native Design · v0.8

> v0.8 起 DDT 把"前端 UI 实现"重新定位为 **"PRD / 契约 → 结构化 Brief"的编译器** + "3 通道分发器"。
> Brief 是 SSoT（single source of truth），3 个通道都从它派生定制化 prompt + 附件包。

---

## Triggers

- `/design-brief` 命令的所有 phase（编译 brief / 决策门 / 提示用户）
- `/design-execute --channel <X>` 的派发分支（生成附件包并引导用户）
- `/design-execute --bundle <zip>` / `--url <share>` 的摄取分支（main thread 读 ingest-report 改写 web/）
- `/build-web` IMPLEMENT phase 收尾（验证契约对齐 + 跑构建测试）

---

## Core Principles

1. **Brief 是 SSoT**：用户审核一份 Brief，3 个通道派生不同 prompt + 附件包；不要让用户分别为各通道写 3 份不同输入。
2. **契约一等公民**：所有通道的 prompt 都强制注入 `docs/api-contract.yaml`；所有通道生成的代码必须经 `web/lib/api-client.ts`，禁止 mock 数据漂移。
3. **stack-aware 通道选择**：用户 `frontend.type === 'spa'` 才走本 skill；`server-side` / `none` 由 `/build-api` 处理（PR-E）。
4. **强观点设计方向**：brief §8.1 强制 `visual_direction` 9 选 1（不允许混搭）；通道 prompt 注入此选择，禁止通道擅自换风格。
5. **反 AI-slop 黑名单**：brief §8.3 的 11 条 anti-patterns 在所有通道 prompt 逐字注入，禁止通道自由发挥。
6. **摄取脚本只做 staging**：`bin/ingest-*.mjs` 把外部源拉到 `.ddt/design/<channel>/raw/`，**不直接改 web/**；main thread 读 `ingest-report.json` 后按本 skill 改写。

---

## 三通道总览

| 通道 | 适用 | 输入 | 输出 |
|------|------|------|------|
| **claude-design**（首选默认） | 用户已订阅 Claude；多文件项目；零外部账号 | `.ddt/design/claude-design/upload-package/`（7 文件附件包） + `prompt.md` | bundle zip 或 Handoff to Claude Code → DDT 摄取 |
| **figma** | 团队已有 Figma 设计师 / Figma MCP 已部署 | `.ddt/design/figma/upload-package/`（7 文件） + TC-EBC `prompt.md` | Figma file URL → MCP get_design_context |
| **v0** | Next.js + Vercel 项目；视觉质量优先 | `.ddt/design/v0/v0-sources/` + Project Instructions + 每屏 prompt | v0 share URL → npx shadcn add |

> **不支持**：Lovable（v0.8 决定不支持，强 Supabase 集成与 DDT 后端契约冲突）。

---

## 通道 A · claude-design（首选默认）

### 产品定位

`claude.ai/design` 是 Anthropic 2026-04-17 推出的独立产品，与 Claude Code、Claude Artifacts 完全不同：

| 维度 | claude.ai/design | claude.ai chat Artifacts | Claude Code |
|------|-----------------|-------------------------|-------------|
| 形态 | 独立 SPA 多文件项目 | 单文件 inline 预览 | CLI 本地 IDE Agent |
| 输出 | JSX < 1000 行 / 文件 + tokens.css 标准 CSS variables | 单文件 React/HTML | 直接修改 repo |
| DDT 集成 | **首选默认通道** | 不作通道使用 | 已是 DDT 运行时 |

订阅要求：Pro / Max / Team / Enterprise 全包含；Enterprise 默认 OFF 需 admin 开启。

三种产物模式（项目创建时选）：
- **Design System**：先建 colors / typography / components / tokens（官方推荐先建 DS 再 spawn 其他）
- **Hi-fi design**：高保真静态布局
- **Interactive prototype**：含交互动效

### 派发流程（main thread 在 `/design-execute --channel claude-design` 时执行）

1. 调用 `bin/derive-channel-package.mjs --channel claude-design`，产出：
   - `.ddt/design/claude-design/upload-package/`（7 文件：design-brief / prd / api-contract / tech-stack / tokens / components-inventory / references）
   - `.ddt/design/claude-design/prompt.md`（项目首条 prompt，已注入 visual_direction + 11 anti-patterns）
2. 引导用户：
   - 打开 https://claude.ai/design 创建新项目
   - 项目模式选 **Design System**，命名 `<project>-ds`（先建 DS）
   - 把 `upload-package/` 内 7 个文件全部拖入 uploads
   - 粘贴 `prompt.md` 内容到对话框首条消息
   - 在 Claude Design 内迭代设计（先建 DS，再 spawn Hi-fi design 项目）

### 摄取流程（main thread 在 `/design-execute --bundle <zip>` 时执行）

#### Step 1：调脚本解压 + 扫描

```bash
node "$DDT_PLUGIN_ROOT/bin/ingest-claude-design.mjs" --bundle <zip-path>
```

产出：
- `.ddt/design/claude-design/raw/`（解压目录）
- `.ddt/design/claude-design/ingest-report.json`（含 counts / files / red_flags）

#### Step 2：main thread 读 `ingest-report.json` 决定改写策略

```typescript
// 伪代码：main thread 读 report 决定每个文件的处理
const report = JSON.parse(fs.readFileSync('.ddt/design/claude-design/ingest-report.json'))

// 红线检查：任一红线触发，停下来询问用户决策
if (report.red_flags.length > 0) {
  // 输出红线给用户，调 AskUserQuestion 选"修复后重审 / 强制接受 / 重跑通道"
}

// tokens.css → web/styles/tokens.css + tailwind.config
if (report.files.tokens_css) {
  // 1. 读 raw 中的 tokens.css
  // 2. 合并到 web/styles/tokens.css（保留已有项目 token，叠加新增）
  // 3. 在 tailwind.config.js 的 theme.extend 中引用新增 var
}

// JSX 组件改写
for (const jsxRel of report.files.jsx) {
  // 1. 读 raw 中的 jsx
  // 2. 改写：
  //    - 把 fetch / axios / 直连 API 改为 web/lib/api-client.ts 的 OpenAPI fetch
  //    - 把组件命名对齐 components-inventory（复用而非新造）
  //    - 把 Tailwind class 中的硬编码颜色 / 间距改为 tokens 变量
  //    - 把 React Router / Next.js 路由对齐项目栈
  // 3. 落到 web/components/<screen>.tsx
}
```

#### Step 3：跑构建 + 测试 + 决策门

```bash
(cd web && npm run build && npm run lint && npm test --run) || exit 6
node "$DDT_PLUGIN_ROOT/bin/score-design-output.mjs"      # W6 实现，10 维评分
```

随后走 `/design-execute` Phase 5 决策门，让用户审阅评分摘要。

### Handoff to Claude Code（v2 路径，未排期）

`Share → Handoff to Claude Code → Local coding agent` 把 design bundle 直接传给 Claude Code，DDT 监听 Handoff 落盘路径自动接管。当前 v0.8 v1 用 zip 摄取（100% 稳定），v2 在用户实测一次确认落盘机制后再做 Hook 自动接管。

### 红线（任一触发就丢弃 Claude Design 输出）

- 单 jsx > 1000 行（违反 Claude Design 自身约束）
- 含 `fetch('/api/...')` / `axios.*` 直连
- tokens.css 不是标准 CSS variables（不可被 Tailwind config 引用）
- 含非 white-listed UI 库（antd / mui / chakra-ui）

`bin/ingest-claude-design.mjs::detectRedFlags` 自动检测前 3 条；UI 库由 main thread 改写时校验 components-inventory.md 红线段。

---

## 通道 B · figma

### 适用

- 团队已有 Figma 设计师在用
- 项目已部署 Figma MCP（`mcp__figma__*` 工具可用）
- 用户偏好 Figma Make / First Draft 这类 0→1 工具

### 派发流程

1. `bin/derive-channel-package.mjs --channel figma` 产出：
   - `.ddt/design/figma/upload-package/`（7 文件，与 claude-design 同结构）
   - `.ddt/design/figma/prompt.md`（**TC-EBC 框架**：Task / Context / Elements / Behavior / Constraints）
2. 引导用户：
   - 打开 Figma Make（推荐）或 First Draft
   - 上传 `upload-package/07-references/` 内截图
   - 粘贴 `prompt.md` 内容（TC-EBC）
   - 在 Figma 内完成设计稿，回到 Claude Code 跑 `/design-execute --channel figma --url <figma-url>`

### 摄取流程

#### Step 1：调脚本解析 URL 并写引导清单

```bash
node "$DDT_PLUGIN_ROOT/bin/ingest-figma-context.mjs" --url <figma-url>
```

bin 脚本只做 URL 解析（提取 fileKey / nodeId / kind），写出 `.ddt/design/figma/ingest-instructions.md`——**main thread 后续读这个文件再调 MCP**（bin 脚本不能直接调 MCP）。

#### Step 2：main thread 读 instructions 调 MCP

按 `ingest-instructions.md` 的指令执行：

```typescript
// Step 2.1: 拉节点上下文（含 React + Tailwind 参考代码 + 截图 + tokens）
mcp__figma__get_design_context({ fileKey, nodeId })

// Step 2.2: 拉截图（用于 W6 视觉对比）
mcp__figma__get_screenshot({ fileKey, nodeId })
// 落到 .ddt/design/figma/screenshots/

// Step 2.3: 拉 Figma Variables（与 tokens.json 对齐）
mcp__figma__get_variable_defs({ fileKey })
```

#### Step 3：改写为 web/ 结构

MCP 返回的代码是**参考代码**，不是直接落地代码。main thread 按下面规则改写：

- 数据层 → `web/lib/api-client.ts`（OpenAPI 生成）
- 组件名对齐 `components-inventory.md`
- Figma Variables → `web/styles/tokens.css` + `tailwind.config.js`
- 路由对齐项目栈（React Router v6 / Next.js App Router）

#### Step 4：构建 + 测试 + 决策门

同 claude-design 通道。

### Code Connect 提前打桩（高级用法）

如果团队已经维护内部组件库（如 `@company/ui`），建议给主要组件打 Code Connect：

```
Button.figma.ts  → @company/ui/Button
Input.figma.ts   → @company/ui/Input
```

打桩后 `mcp__figma__get_design_context` 返回项目真实代码而不是通用 React+Tailwind。这是 figma 通道输出可直接用代码的护城河。

详见 https://developers.figma.com/docs/code-connect/

### 红线

- 输出含 `<Figma.*>` / `<Make.*>` 等 Figma 私有组件
- tokens 不是 CSS variables（不可与 Tailwind config 兼容）
- 数据层用裸 fetch 而非 OpenAPI client

---

## 通道 C · v0

### 适用

- Next.js + Vercel 全家桶项目
- 重视生成代码视觉质量（v0 视觉比 figma / claude-design 更精）
- 用户已订阅 v0 Pro

### 派发流程

1. `bin/derive-channel-package.mjs --channel v0` 产出：
   - `.ddt/design/v0/v0-sources/`（4 文件：openapi.yaml + tokens.css + design-brief.md + components-inventory.md）
   - `.ddt/design/v0/project-instructions.md`（粘到 v0 Settings → Instructions）
   - `.ddt/design/v0/prompts/<screen>.md`（每屏 stub）
2. 引导用户：
   - 在 v0.dev 创建 Project（一次性，跨多次生成共享上下文）
   - **Settings → Sources**：上传 `v0-sources/` 内全部文件
   - **Settings → Instructions**：粘贴 `project-instructions.md` 内容（含 11 anti-patterns 英文版）
   - 每屏在 v0 chat 中粘贴对应 `prompts/<screen>.md`
   - 完成后回贴 share URL：`/design-execute --channel v0 --url <v0-share-url>`

### 摄取流程

#### Step 1：调脚本拉组件

```bash
node "$DDT_PLUGIN_ROOT/bin/ingest-v0-share.mjs" --url <v0-share-url> [--target web/]
```

脚本内部跑：

```bash
npx shadcn@latest add "<v0-share-url>"
```

把 v0 生成的组件拉到 `web/components/ui/`（shadcn 标准目录）。

> ⚠️ shadcn add 直接落到 `web/components/ui/`，不经 staging。这是 shadcn CLI 的设计，不是 DDT 选择。如果用户想先 staging 再人工审，可在 v0 chat 复制代码而不用 share URL（但失去自动化便利）。

#### Step 2：main thread 改写

- 把 v0 默认的 mock 数据替换为 `web/lib/api-client.ts` 调用
- 把 v0 默认的 indigo / blue 色替换为 brief §8 tokens（v0 system prompt 默认禁用 indigo / blue，但偶尔漏网）
- 反幻觉数据 lint：

```bash
grep -rn "mockData\|fakeUsers\|placeholder.*data" web/
```

任一命中 → blocker。

#### Step 3：构建 + 测试 + 决策门

同上。

### 高级用法：DDT 自家 shadcn registry

如果项目维护了 `web/registry/`（项目自有组件），可以让 v0 以 DDT 设计系统为基础生成：

```
https://v0.dev/chat/api/open?url=https://your-domain/registry/index.json
```

把 DDT 设计系统注入 v0 上下文，生成的组件直接复用 DDT 已有 component 而非新造。

### 红线

- v0 生成代码使用了 `redux` / `mobx` / `recoil`（与项目 zustand + react-query 冲突）
- 数据层用裸 fetch 而非 OpenAPI client
- 出现 `mockData` / `fakeUsers` / `placeholder` 关键字

---

## 通用 · main thread 改写流程（所有通道共用）

无论用哪个通道，main thread 在 ingest 后改写 web/ 时都按下列步骤：

### 1. 红线检查（先扫一遍，发现就停）

```typescript
// 读 ingest-report.json（claude-design） 或 instructions（figma） 或 components-inventory（v0）
// 检测：
//   - 含 fetch / axios 直连 → 必改
//   - 含 mock / placeholder → 必改
//   - 含 antd / mui / chakra-ui → 直接拒绝，回 AskUserQuestion 让用户决策
//   - 含 redux / mobx / recoil → 同上
//   - tokens 不是 CSS variables → 同上
```

### 2. tokens 合并

- 读外部源的 tokens（claude-design：tokens.css；figma：Variables；v0：组件内 inline tokens）
- 合并到 `web/styles/tokens.css`（保留已有项目 token，叠加新增）
- 在 `tailwind.config.js` 的 `theme.extend` 引用 CSS variables：
  ```js
  theme: {
    extend: {
      colors: {
        primary: 'var(--color-primary)',
        ...
      }
    }
  }
  ```

### 3. 组件改写（每个组件）

- 读 staging 区的组件源
- **改写规则**：
  - 数据层：所有 `fetch` / `axios` → `web/lib/api-client.ts`（OpenAPI 生成的 typed fetcher）
  - 组件命名：对照 `components-inventory.md`，复用而非新造（如 v0 生成 `<MyButton>`，应改为 `<Button>`）
  - 路由：对齐项目栈（React Router v6 用 `<Routes>` / `<Route>`；Next.js App Router 用 `app/<route>/page.tsx`）
  - 状态管理：客户端态 zustand / 服务端态 react-query / 表单 react-hook-form + zod
  - 路径别名：所有 import 用 `@/` 而非相对路径
- 落到 `web/components/<screen>.tsx` 或 `web/app/<route>/page.tsx`

### 4. 8 状态完备性检查

每个交互组件必须实现 8 状态（来自 brief §5）：

```
default / hover / active / disabled / focus / loading / empty / error / success
```

外部通道**默认 miss empty / error / loading**（已知痛点）。main thread 改写时必须显式补齐：

- `loading`：用 shadcn `<Skeleton>` / `<Spinner>`
- `empty`：用项目 `<EmptyState>` 组件（components-inventory.md 应已登记）
- `error`：用 shadcn `<Alert variant="destructive">` + 错误文案对应 ErrorCode 枚举

### 5. 跑构建 + lint + 测试

```bash
cd web
npm run build
npm run lint
npm test --run
```

任一失败 → 不能进入决策门，先修复。

### 6. 10 维评分（W6 实现）

```bash
node "$DDT_PLUGIN_ROOT/bin/score-design-output.mjs"
```

输出 `.ddt/design/design-scorecard.json`，含 10 维客观评分。决策门展示评分摘要。

### 7. checkpoint commit + 决策门

每个屏完成后 `git add web/components/<screen>.tsx && git commit -m "chore(design): <channel> ingest <screen>"`，然后调 AskUserQuestion 让用户审阅评分。

---

## 反 AI-slop 黑名单（11 条 · 注入所有通道 prompt）

来自 brief §8.3，由 `bin/derive-channel-package.mjs` 在派生 prompt 时**逐字注入**：

| # | 反模式 | 替代做法 |
|---|--------|---------|
| 1 | 紫蓝默认渐变 | 实色 + 单一品牌色 accent |
| 2 | 无意义 glass morphism | 实色 + 微妙阴影 |
| 3 | 不该圆角的圆角（统一 8px） | 多档圆角（sm 4 / md 8 / lg 16） |
| 4 | 滚动过度动画 / scroll-jacking | 仅在关键节点用 staggered fade-in |
| 5 | 居中 hero on stock gradient | 网格不对称布局 + 真实参考图 |
| 6 | 通用 sans-serif（Inter / Arial / 系统默认） | 按 visual_direction 选具体字体 |
| 7 | 通用情感色（饱和蓝 / 天蓝） | 品牌色 + 中性色优先；情感色仅作语义 |
| 8 | interchangeable SaaS hero | hero 区必须含产品独特视觉锚点 |
| 9 | generic card piles | 信息分层（summary / detail / action 三类各异） |
| 10 | random accent without system | 所有 accent 必须出自 tokens.json |
| 11 | motion that exists only because animation was easy | 每个动效必须服务于具体 task |

main thread 改写时，**审阅每个组件是否触发任一反模式**；触发即记 blocker 询问用户。

---

## Visual Direction 9 选 1（注入所有通道）

来自 brief §8.1，由 `bin/derive-channel-package.mjs` 注入：

```
brutally-minimal / editorial / industrial / luxury / playful /
geometric / retro-futurist / soft-organic / maximalist
```

强约束：**单选，不允许混搭**。如果通道输出违反 visual_direction（例如选了 `industrial` 但出了 `playful` 风），main thread 改写时识别并拒绝。

---

## Self-Check（main thread 改写完每屏后必跑）

- [ ] 红线检查无残留（fetch / mock / antd / 非 CSS variables）
- [ ] tokens 已合并到 `web/styles/tokens.css` + `tailwind.config.js`
- [ ] 8 状态显式实现（empty / error / loading 必有）
- [ ] 数据层 100% 经 `web/lib/api-client.ts`
- [ ] 路由对齐项目栈
- [ ] 组件命名对照 `components-inventory.md`，复用 ≥ 80%
- [ ] visual_direction 一致（无混搭）
- [ ] 11 anti-patterns 无任一触发
- [ ] `npm run build` / `lint` / `test` 全过
- [ ] checkpoint commit 落地

未全勾不得报告"完成"。

---

## Don't

- ❌ 不要 Lovable（v0.8 已删除，强 Supabase 集成与 DDT 后端契约冲突）
- ❌ 不要让外部通道直接写 `web/`（必须经 staging + main thread 改写）
- ❌ 不要保留 mock 数据 / placeholder（必须经 OpenAPI client）
- ❌ 不要混搭 visual direction（强观点设计 = 单选）
- ❌ 不要新造已在 `components-inventory.md` 登记的组件（如 Button / Input / Card / Dialog / Form）

## Do

- ✅ 派发前 brief 编译完整（10 字段 + visual_direction + anti-patterns）
- ✅ 通道 prompt 注入 11 anti-patterns 逐字（不允许通道删减）
- ✅ ingest 脚本只 staging，不直接改 web/
- ✅ main thread 流式可见（每屏改写一段就 commit + 询问，不批量缓冲）
- ✅ 8 状态显式补齐 empty / error / loading（外部通道默认 miss）
- ✅ 决策门基于 10 维评分（客观 + 主观双轨）

---

## Templates & References

### DDT 内置（已实现）

- `templates/design-brief.template.md`（10 字段 SSoT）
- `templates/design-tokens.template.json`（默认 tokens）
- `templates/components-inventory.template.md`（含 5 区段红线）
- `templates/prompts/claude-design.template.md`（claude.ai/design 项目首条 prompt）
- `templates/prompts/figma.template.md`（TC-EBC 框架）
- `templates/prompts/v0.template.md`（Project Instructions + 三段式）
- `bin/compile-design-brief.mjs`（W1，编译器）
- `bin/derive-channel-package.mjs`（W2，3 通道附件包派生）
- `bin/ingest-claude-design.mjs`（W4，zip 摄取 + 红线检测）
- `bin/ingest-figma-context.mjs`（W4，URL 解析 + MCP 引导清单）
- `bin/ingest-v0-share.mjs`（W4，shadcn add 包装）

### 业界参考

- Figma TC-EBC 框架：[Figma Make Brief Pattern](https://www.figma.com/blog/...)
- Vercel v0 三段式：[Vercel v0 Best Practices](https://vercel.com/blog/...)
- Anthropic frontend-design skill 哲学（Pick a direction and commit）

### 其他 DDT skills

- `skills/api-contract-first/SKILL.md`（契约消费方约束）
- `skills/frontend-development/SKILL.md`（前端实现 hard requirements）
- `skills/decision-gate/SKILL.md`（决策门标准模板）

---

## 与 v0.7 `ai-native-design` 旧版的差异

| 维度 | v0.7（旧 132 行） | v0.8（当前 ~400 行） |
|------|------|------|
| 通道数 | 4（claude-design / figma / v0 / lovable） | **3**（删 lovable，强 Supabase 集成与后端契约冲突） |
| 输入来源 | "已有 figma URL" 假设 | **brief 编译器**（PRD + 契约 → 10 字段 SSoT） |
| visual_direction | 无 | **9 选 1 强制单选**，注入所有通道 |
| anti-patterns | 无 | **11 条逐字注入** 3 通道 prompt |
| 摄取流程 | 含混叙述 | **3 个独立 ingest 脚本**（staging-only） |
| Brief / prompt 模板 | 无 | 7 模板齐全（含中英双语） |
| main thread 改写 | 隐含 | **明确 7 步流程**（红线 / tokens / 改写 / 状态 / 测试 / 评分 / commit） |

v0.8 的核心定位升级：从"导入设计稿的搬运工" → **"PRD / 契约 → 结构化 Brief 编译器 + 3 通道分发器"**。
