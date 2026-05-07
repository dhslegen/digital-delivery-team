# 示例：claude-design handoff bundle → brief §11 设计契约（D26 / v0.9.9）

> 输入类型 K（v0.9.9 D26）实战。覆盖 2 种形态：
> - **A. 本地 .tar.gz bundle**（用户从 claude.ai/design 下载）
> - **B. 解压后的目录**（已经解压或来自 `bin/ingest-claude-design.mjs` 落盘）

## 何时识别为类型 K

详细信号见 `references/ai-design-quick-pick.md`。强信号：

| 信号 | 例子 |
|---|---|
| 用户给 URL `https://api.anthropic.com/v1/design/h/<id>` | https://api.anthropic.com/v1/design/h/r_McQh94UXBuyrFdW2KynA |
| 单文件 `*.tar.gz` 含 gzip magic + tar 头 | `~/Downloads/handoff.tar.gz` |
| 解压目录含 `untitled/README.md` + `chats/` + `project/{tokens.css, *.jsx}` | `.ddt/design/claude-design/raw/` |
| 用户对话："我用 claude.ai/design 做了设计" / "handoff 包" | "已经在 https://claude.ai/design 跑过设计了" |

---

## 示例 A：本地 .tar.gz bundle

### 用户输入

```
我用 claude.ai/design 做了一版设计，handoff 包在 ~/Downloads/r_McQh94UXBuyrFdW2KynA.tar.gz，
请把它加到 brief 让 product-agent 在 /prd 阶段能用
```

### LLM 第一步：识别 + 告知用户

```
识别到 claude-design handoff bundle（输入类型 K）。
将跑 dump-design-handoff.mjs 解析后注入 brief §11 设计契约。
```

### 跑脚本

```bash
PR="${DDT_PLUGIN_ROOT:-$(cat "${HOME}/.claude/delivery-metrics/.ddt-plugin-root" 2>/dev/null)}"
PR="${PR:-${HOME}/.claude/plugins/marketplaces/digital-delivery-team}"

node "$PR/skills/ddt-brief-builder/scripts/dump-design-handoff.mjs" \
  ~/Downloads/r_McQh94UXBuyrFdW2KynA.tar.gz
```

### 输出（markdown 片段，可直接 append 到 brief §11）

```markdown
### 设计契约：无人物流车运营服务平台

| 项目 | 值 |
|---|---|
| Bundle 路径 | `~/Downloads/r_McQh94UXBuyrFdW2KynA.tar.gz` |
| Prototype 框架 | React (.jsx prototype)（**recreate 阶段最低成本路径**） |
| AI 推荐 UI 库 | AntD 5（chat 中 AI 已建议） |
| Design Tokens | 61 个 CSS variables（含 6 阶品牌色 + 4 状态色 + 3 字体族） |
| Prototype 文件 | 6 个 .jsx + 4 个 .css + 1 个 .html |
| 设计对话 | 1 个 chat（含用户决策追溯） |

**用户原始诉求**（chat 抽取）：
> 这是新系统的需求清单，帮我设计，要求比竞品有极高的竞争力

**关键设计决策**（AI 与用户共同确认）：
- **视觉**：深色科技指挥中心风（接近 Anduril/Palantir + 京东物流大屏的混合），主色用电光青蓝 + 物流橙告警
- **品牌**：参照新石器/白犀牛后台的专业感，但用更现代的字体（Geist Mono 数据 + 思源黑体中文）
- **数据**：用京东亚一/顺丰落地的口吻命名（看起来像真的产品 demo）
- **变体**：1 套精致版本 + Tweaks 切换主色/密度/深浅

**Design Token 速查**（前 4 阶品牌色）：
- `brand-50=#e6f7ff`
- `brand-100=#b3e7ff`
- `brand-200=#66cfff`
- `brand-300=#1ab2ff`

**AI 提及的技术栈**（chat 中出现）：React / AntD / TanStack Query / Zustand / ECharts / Three.js

> ⚠️ **下游消费**：product-agent 在 /prd 阶段可按需 Read prototype 与 tokens；/design-execute 阶段会用 `bin/ingest-claude-design.mjs` 全量摄取。
```

### 注入 brief 后下游效果

- **product-agent /prd**：用户故事可直接引用 prototype（如 "运行监测大屏 = page-monitor.jsx，含车辆地图 + 告警流 + KPI 卡 + 网点活跃度"）
- **§6 ui_components 子字段**：LLM 看到 AI 推荐 AntD 5 → 严格按 chat 决策填 `antd-5`，不凭训练偏置自由发挥
- **§7 framework**：bundle 全 .jsx → 强相关 `react`，check-brief-quality 不会发 D26 警告
- **/design-execute**：可直接用 `bin/ingest-claude-design.mjs --bundle <tar.gz>` 全量摄取到 `.ddt/design/`，无需重新去 claude.ai/design 拉

---

## 示例 B：URL 形态（先 ingest，再 dump）

URL 形态本 dump 脚本不直接支持（避免重复实现 SSRF / 体积 / magic bytes 安全检查）。流程拆两步：

### Step 1：先用 ingest-claude-design.mjs 落盘

```bash
node "$PR/bin/ingest-claude-design.mjs" \
  --url "https://api.anthropic.com/v1/design/h/r_McQh94UXBuyrFdW2KynA"
# 解压到 .ddt/design/claude-design/raw/
```

### Step 2：dump 解压目录

```bash
node "$PR/skills/ddt-brief-builder/scripts/dump-design-handoff.mjs" \
  .ddt/design/claude-design/raw/
```

输出与示例 A 一致。

---

## 与 §10 / §11 API 集成的区别

| 维度 | §10 参考资料 | §11 集成依赖 - 第三方 API（D25） | §11 集成依赖 - 设计契约（D26） |
|---|---|---|---|
| **形态** | URL / 文件路径 | endpoint × 鉴权 × 错误码 | prototype + tokens + chat 决策 |
| **下游消费** | product-agent 被动浏览 | product-agent **主动**消费（用户故事引用 endpoint） | product-agent **主动**消费（用户故事引用屏幕 + tokens）+ design-execute 全量摄取 |
| **典型来源** | 竞品官网 / 设计灵感 | 第三方 API 文档目录 / OpenAPI yaml | claude.ai/design / Figma / v0 share URL |

> 一个 brief 可以同时含 §11 三类内容（API 集成 + 设计契约 + 内部 SDK）。

---

## 反模式

- ❌ 把 design bundle 内容塞 §10 → product-agent 看不见，等于没用
- ❌ 把 design bundle 解压目录全部 list 到 §11 → 信息冗余；只存摘要 + 路径指针
- ❌ §6 framework 不读 §11 设计契约的 chat 决策 → LLM 凭训练偏置自由发挥（如 dump 抽出 "AntD 5"，brief 却写 "Element Plus"）
- ❌ §7 framework=Vue 但 §11 bundle 全 .jsx → check-brief-quality D26 软警告（30% 改造成本）
