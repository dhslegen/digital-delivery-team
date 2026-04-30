# Design Brief · <项目名称>

> 版本：v1.0 · 作者：design-brief-agent · 日期：<YYYY-MM-DD> · 项目：`<project_id>`
>
> 由 /design-brief 自动编译。**编辑此文件后跑 /design-brief --refresh**，不要直接改 .ddt/design/<channel>/ 内的派生产物。
> Brief 是 SSoT，3 个通道（Claude Design / Figma / v0）的 prompt 与附件包都从它派生。

---

## 1. Problem Alignment

> 来自 `docs/prd.md` 的概述与目标段。

**用户**：<persona，如 "内部物流调度员"，含画像与典型工作场景>

**痛点**：<pain，1-2 句，越具体越好>

**为什么现在做**：<urgency，业务/技术/合规驱动力>

**成功指标**：<metric，与 PRD 的可量化指标对齐>

---

## 2. User Stories

> 自动从 `docs/prd.md § 用户故事` 提取，保留 Given/When/Then 结构。

| ID | 角色 | 我想 | 以便 | Given/When/Then |
|----|------|------|------|----------------|
| US-01 | <role> | <goal> | <value> | Given ... / When ... / Then ... |
| US-02 |  |  |  |  |

---

## 3. Information Architecture

> 完整页面树（含路由）。

```text
/                       <首页用途>
/login                  <登录>
/dashboard              <主仪表盘>
  /projects             <项目列表>
  /projects/:id         <项目详情>
/settings               <设置>
```

---

## 4. Screen Inventory

> 每屏必填以下字段；缺一律视为 brief 不完整。

### Screen 1: <名称> (`<route>`)

- **入口**：<从哪里进入此屏>
- **出口**：<跳出到哪里>
- **数据**：<对应 OpenAPI endpoint，如 `POST /api/auth/login` → 见 api-contract.yaml#L42>
- **状态枚举**：<列出本屏所有可能状态，如 default / submitting / error-401 / error-network / success-redirecting>

### Screen 2: ...

---

## 5. Component States（强制 8 状态矩阵）

> 每个交互组件必须画 8 状态：default / hover / active / disabled / focus / loading / empty / error / success
> （Claude Design 等通道默认 miss empty / error / loading，必须在此显式列出。）

| 组件 | default | hover | active | disabled | focus | loading | empty | error | success |
|------|---------|-------|--------|----------|-------|---------|-------|-------|---------|
| Button | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | - | ✅ | ✅ |
| Form | ✅ | - | - | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Card | ✅ | ✅ | - | - | - | ✅ | ✅ | ✅ | - |

---

## 6. Data & API Contract

> 直接引用 `docs/api-contract.yaml`，不在此重复 schema。

**关键 endpoints**（按使用频率排序）：

- `<METHOD> <path>` → 见 api-contract.yaml#L<line>，对应屏幕：`<screen>`
- ...

**禁止使用 mock 数据**。所有 fetch 必须经 `web/lib/api-client.ts`（由 `openapi-typescript` 生成）。

**契约对齐红线**（自动 lint 检测）：
- ❌ 出现 `mockData` / `fakeUsers` / `placeholder.*data` 关键字
- ❌ 出现 `fetch('/api/...')` / `axios.get(...)`（应走 api-client）
- ❌ 出现裸字符串错误文案（应对应 ErrorCode 枚举）

---

## 7. Validation & Error

**字段级**：见 `docs/api-contract.yaml` 各 schema 的 `validation` 规则。

**系统级**（错误文案必须对应 ErrorCode 枚举，禁止裸字符串）：

| 状态码 | 文案 | 处理 |
|-------|------|------|
| 401 | "登录已过期，请重新登录" | 跳转 /login |
| 429 | "请求过于频繁，X 秒后重试" | 显示倒计时 |
| 5xx | "服务暂时不可用，已通知管理员" | 自动重试 1 次 |
| network-offline | "网络连接已断开" | 显示离线条 |

---

## 8. Visual Direction & Design Tokens

### 8.1 Visual Direction（强制单选 1 种风格方向）

> **强观点设计原则**：必须从下面 9 种方向中**单选一种**，不允许混搭。混搭会导致设计无主张，AI 输出退化为"通用 SaaS 模板"。

| 方向 | 适用 | 字体倾向 | 色彩倾向 | 留白 | 动效 |
|------|------|---------|---------|------|------|
| `brutally-minimal` | 工程 / 内部工具 | Geist Mono / IBM Plex | 黑白 + 单一品牌色 | 极宽 | 几乎无 |
| `editorial` | 内容 / 文档 / 博客 | Serif（Source Serif / Iowan） | 米白 + 墨黑 + 极少 accent | 中 | 文字 reveal |
| `industrial` | 数据 / 监控 / 物流 | Mono + Sans 混排 | 深灰 + 高对比 accent | 紧凑 | 状态过渡 |
| `luxury` | 高端 ToC / 品牌 | Serif Display + Sans | 米色 + 暖金 + 深棕 | 宽 | 缓慢 ease |
| `playful` | 教育 / 儿童 / 社区 | Round Sans（Quicksand） | 多彩饱和 | 中 | 弹性 spring |
| `geometric` | 设计 / 创意工具 | Geometric Sans（Inter Tight） | 大色块 + 几何形 | 中 | 形状变换 |
| `retro-futurist` | Web3 / Gaming | Mono + 装饰字 | 霓虹 + 深紫黑 | 紧凑 | glow / scanline |
| `soft-organic` | 健康 / 冥想 / 母婴 | Round Sans / Hand-drawn | 柔粉 + 灰绿 + 米白 | 宽 | flowing |
| `maximalist` | 时尚 / 媒体 / 创意 | 多字体混排 | 撞色 + 大图 | 紧凑 | 多图层 |

**本项目的选择**：

```yaml
visual_direction:
  selected: <从上表 9 选 1，必填>
  rationale: <为什么选它，1-2 句>
```

### 8.2 Design Tokens

> 来自 `.ddt/design/tokens.json`。**审阅时务必打开 `.ddt/design/tokens-preview.html` 查看真实渲染效果**，不要只读 JSON。

```json
{
  "color": {
    "primary": "#1F6FEB",
    "danger":  "#D73A49",
    "warning": "#F59E0B",
    "success": "#0F9D58",
    "neutral-50":  "#F6F8FA",
    "neutral-100": "#EAEEF2",
    "neutral-500": "#6E7781",
    "neutral-900": "#1F2328"
  },
  "spacing": [4, 8, 12, 16, 24, 32, 48, 64],
  "radius": { "sm": "4px", "md": "8px", "lg": "16px" },
  "typography": {
    "font-sans": "Geist Sans, ui-sans-serif",
    "font-mono": "Geist Mono, ui-monospace",
    "scale":     [12, 14, 16, 20, 24, 32, 48]
  }
}
```

### 8.3 Anti-Patterns（强制黑名单 · 11 条）

> **每个通道的 prompt 都会逐字注入此清单**，防止 AI 输出退化为"通用 SaaS slop"。

| # | 反模式 | 替代做法 |
|---|--------|---------|
| 1 | 紫蓝默认渐变（`from-purple-500 to-blue-500`） | 实色 + 单一品牌色 accent |
| 2 | 无意义 glass morphism（毛玻璃滥用） | 实色 + 微妙阴影 / 微高斯模糊仅在覆盖层 |
| 3 | 不该圆角的圆角（按钮 / 卡片 / 输入框统一 8px） | 多档圆角（sm 4 / md 8 / lg 16），每类组件独立选 |
| 4 | 滚动过度动画（parallax / scroll-jacking） | 仅在关键节点用 staggered fade-in |
| 5 | 居中 hero on stock gradient | 网格不对称布局 + 真实参考图 |
| 6 | 通用 sans-serif（Inter / Arial / 系统默认） | 按 visual_direction 选具体字体（Geist / IBM Plex / Satoshi 等） |
| 7 | 通用情感色（饱和蓝 / 天蓝） | 品牌色 + 中性色优先；情感色仅作语义（success / warning / error） |
| 8 | "interchangeable SaaS hero"（标题 + 副标 + 双 CTA） | hero 区必须含产品独特视觉锚点（screenshot / 数据 / 真实截图） |
| 9 | "generic card piles"（无层级的卡片堆叠） | 信息分层：summary card / detail card / action card 三类各异 |
| 10 | "random accent without system"（随手用色） | 所有 accent 必须出自 tokens.json，禁止 inline 颜色 |
| 11 | "motion that exists only because animation was easy" | 每个动效必须能回答"它服务于什么 task" |

---

## 9. References

> 用户上传的视觉参考；与 visual_direction 一起决定通道生成风格。

**参考产品**（业界对标）：
- <产品名>：<风格关键词，如 "Linear（极简 + 高密度）">
- <产品名>：<...>

**参考截图**（已落到 `.ddt/design/assets/`）：
- `.ddt/design/assets/ref-01-<desc>.png`
- `.ddt/design/assets/ref-02-<desc>.png`

**风格关键词**：<3-5 个，与 visual_direction 互补，如 "minimal / professional / dense / monochrome with single accent">

---

## 10. Constraints

- **平台**：<Web / Mobile Web / PWA / Electron>
- **浏览器**：<Chrome / Safari / Firefox latest 2 versions>
- **断点**：sm 640 / md 768 / lg 1024 / xl 1280
- **可达性**：WCAG 2.1 AA（焦点环 / 对比度 ≥ 4.5:1 / 键盘导航完整 / 屏幕阅读器）
- **性能预算**：FCP < 1.5s / LCP < 2.5s / 总 JS < 200KB gzipped
- **i18n**：<支持的语言列表>
- **暗色模式**：<必须 / 可选 / 不支持>

---

## 11.（可选）参考实现

- 已有内部组件库：<如 `@company/ui`，位于 monorepo/packages/ui>
- shadcn registry：<如 `https://ui.example.com/registry`>
- 已有 Figma 设计稿：<URL，将通过 figma 通道导入>

---

## 编译信息（自动生成，请勿手改）

```yaml
generated_at:  <ISO 8601 timestamp>
generator:     ddt-design-brief-compiler v0.8.0
inputs:
  prd:           docs/prd.md@<git sha>
  api_contract:  docs/api-contract.yaml@<git sha>
  tech_stack:    .ddt/tech-stack.json
  user_assets:
    - .ddt/design/assets/ref-01-*.png
    - .ddt/design/tokens.json
derived_packages:
  - .ddt/design/claude-design/upload-package/
  - .ddt/design/figma/upload-package/   (if --channel includes figma)
  - .ddt/design/v0/v0-sources/          (if --channel includes v0)
```
