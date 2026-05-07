---
name: ddt-brief-builder
description: 把任意输入（一段文字 / 文件路径 / 比赛官网 URL / 已有 PRD / 散乱描述）转成专业 DDT 友好的 project-brief.md，作为 DDT 工作流第零步。当用户说"帮我写 project-brief"、"DDT 第零步"、"新项目设置"、"把需求转成 brief"、"我想用 DDT 跑这个项目"、"测试项目设置"、"比赛项目想用 DDT"、"项目简报"、"写 brief"、"开新项目"，或粘贴一段需求/比赛说明/已有 PRD 让你转成 DDT 输入时，立即触发本 skill。覆盖输入识别、字段提取、3 个关键决策门、质量自检、与 DDT 后续命令（/prd → /wbs → /design → /design-brief）的丝滑对接。
origin: DDT
---

# DDT Brief Builder · 工作流第零步

> **使命**：把任意非结构化输入转成 DDT 标准 `project-brief.md`，让 `/prd` 一跑即过、不卡。
> **价值**：避免用户卡在"DDT 第一个文件填什么/怎么填/字段太多"的入门摩擦上。
> **范围**：仅产出 `project-brief.md`。后续工作流（PRD/WBS/架构/契约）由 DDT 各 phase 命令处理，本 skill 不越界。

---

## 何时触发

任意以下场景：
1. 用户**显式要求**写 brief：「帮我写 project-brief」「生成 brief」「DDT 第零步」「新项目入口」
2. 用户**粘贴非结构化需求**并提到 DDT / 测试项目 / 比赛 / 想跑工作流
3. 用户**给出 URL/文件路径**并问"能不能基于这个用 DDT 开始"
4. 用户**已有 PRD/需求文档**但说"DDT 让我先填 brief"

**不触发**：
- 用户已有 `project-brief.md` 且只想刷新——直接跑 `/prd --refresh`，本 skill 不重写
- 用户跑到 `/design-brief`（v0.8 引入的设计 brief）——那是 v0.8 设计阶段产物，与本 skill 不同

---

## 输入识别（开场第一步）

LLM 必须先**识别输入类型**，再走对应路径。可同时存在多类，按优先级合并：

| 输入类型 | 识别信号 | 处理路径 |
|---|---|---|
| **A. 自然语言描述** | 用户对话直接给文本（≥ 50 字） | 直接提取字段 |
| **B. 本地文件路径** | 路径以 `./` `/` `~/` 开头，含 `.md` `.pdf` `.docx` | 用 Read 工具读取后提取 |
| **C. URL** | 含 `http://` / `https://` | 用 WebFetch 拉取后提取 |
| **D. 已有 PRD** | 提到 "PRD"、"产品需求文档"、"我已经写了 prd.md" | 反向提炼为 brief（向上抽象） |
| **E. 比赛官网/题目** | 含"比赛"、"挑战赛"、"hackathon"、"评分标准" | 特殊处理：提取硬约束 + 评分项 |
| **F. 项目截图/草图** | 用户上传图片 | 用 Read 加载后提取布局/UI 线索作 §核心功能 |
| **G. 多源混合** | 同时含上述多个 | 按 PRD/URL > 文件 > 文字优先级合并 |
| **H. 会议纪要 / 评审记录** | 含"会议"、"纪要"、"参加人员"、"评审"、"※" 标识、"目标上线日" | **客户驱动模式**：把会议确认范围作硬约束 |
| **I. xlsx / csv 功能清单类** | 路径含 `.xlsx` `.csv`，文件名含"功能清单"、"功能列表"、"feature-list" | **自动 dump**：用 `python3 -c "import openpyxl; ..."` 解析，无需用户额外操作 |
| **J. 人员/工时/进度表（baseline 信息源）** | 文件名含"人员需求"、"工时"、"项目计划"、"进度"、"resource-plan" | **不塞 brief**——解析后追加到 `baseline/historical-projects.csv` 一行（让 pm-agent /wbs 阶段有更准的工时基准）；同时把"总人月 / 时间窗口"提取到 brief §5 |

**识别后必须先告知用户**："我识别到你的输入是 ⟨类型⟩，将走 ⟨路径⟩ 提取字段"——让用户能纠正。

### 关键场景特化

| 场景信号 | 特化处理 |
|---|---|
| **B2B 项目**（"客户"、"运营"、"合同"、"账单"、"乙方/甲方"、"网点"、"车队"、"物流"、"工厂"、"医院"、"政府"、"企业内部"） | D1 决策门 **首选 java-modern**（B2B 后台对稳定性/合规/长服役要求高，Spring Boot 生态最匹配） |
| **多模块项目**（含 5+ 个独立功能模块，每模块有独立增删改查） | §4 核心功能允许"按模块归类"，每模块 1 条 summary + 关键 sub-features，**不强制 3-7 条上限** |
| **外部接口强依赖**（"对接 X 接口"、"取决于 X 能力"、"X 的接口协议"） | §5 关键约束新增"外部接口依赖"子项，未确认的接口写**软 blocker** |
| **会议纪要 ※ / [必做] 标识** | 把带 ※ 的功能标 **P0**（v1.0 范围内），其余标 P1 / P2 |
| **工期不现实**（如 5 大模块 9 天上线 / 10 人天做 50 个功能） | 必触发**软 blocker**："工期 reasonability check 失败：N 模块 × M 子功能 vs T 人天，建议确认是否已有底座或缩范围" |
| **客户参与决策**（会议纪要含"客户代表"参与确认） | §2 目标用户分**甲方 / 乙方两类**：甲方运营人员（主要使用者）+ 乙方业主/客户（决策方/付费方/审视方） |

### xlsx / csv 自动解析协议（应对输入类型 I/J）

**Read 工具不直接支持 xlsx**——必须用 Bash + Python openpyxl 解析。模板：

```bash
# 检测 openpyxl 可用性
python3 -c "import openpyxl; print('OK')" 2>&1
# 不可用：pip3 install openpyxl --quiet

# 全文 dump（功能清单 / 人员表通用）
python3 -c "
import openpyxl
f = '<path-to-xlsx>'
wb = openpyxl.load_workbook(f, data_only=True)
for sheet_name in wb.sheetnames:
    ws = wb[sheet_name]
    print(f'--- Sheet: {sheet_name} ---')
    for row in ws.iter_rows(values_only=True):
        cells = [str(c) if c is not None else '' for c in row]
        if any(c.strip() for c in cells):
            print(' | '.join(cells))
"
```

不要让用户先 export csv——skill 内部完成解析。

### baseline 增量同步（应对输入类型 J）

**当用户给的是"项目人员需求计划表"等 baseline 信息源时**：
1. 解析人员表得到角色 × 进入/离开时间 × 人月
2. **按 phase 反向映射**：
   - 项目经理/架构 → architecture（design 阶段）
   - 产品经理 → requirements（prd + wbs）
   - UI 设计 → design（UI 部分）
   - 前端 → frontend
   - 后端 → backend
   - 测试 → test + review
3. 计算总工时：`总人月 × 22 工作日 × 8 小时 = 总工时`
4. **追加一行到** `<project-root>/baseline/historical-projects.csv`（如不存在则从插件 baseline 复制后追加）
5. 写到 brief §5 关键约束："团队规模 N 人月 / 时间窗 YYYY-MM-DD ~ YYYY-MM-DD / 总工时 H 小时"
6. 写到 brief §10 参考资料引用人员表路径

**复杂度判定**（用于 D1 默认推断）：
- 总工时 ≤ 60h → 简单
- 60-200h → 中等
- > 200h → 复杂（B2B / 多模块项目典型）

### 多模块项目的 §4 处理

当输入有 5+ 模块时，§4 不强制 3-7 条，改用**模块化 markdown** 结构：

```markdown
## 核心功能

### 模块 1：<名称>（P0）
- 子功能 1.1：<一句话描述>
- 子功能 1.2：<一句话描述>

### 模块 2：<名称>（P0）
- 子功能 2.1：<一句话描述>

### 模块 N：<名称>（P1）
- ...
```

每模块标 P0/P1/P2 优先级（从 ※ 标识 / "必做" / "v1.0 范围内" 等信号识别）。

---

## 字段提取与填充（10 个 brief 字段）

### 必填字段（5 个，缺一硬警告）

| 字段 | 提取策略 | 缺失处理 |
|---|---|---|
| **项目背景** | 1-3 句话：为什么做 + 解决什么痛点。从输入直接抽 | 缺：用 AskUserQuestion 问"这个项目要解决的核心痛点是？" |
| **目标用户** | 主要用户 + 次要用户。从输入提取角色 | 缺：默认假设"内部团队成员" + 标注 `<待用户确认>` |
| **成功标准** | 至少 1 条可量化指标 | 缺：从输入提关键动作（如"5 分钟内完成 X"），转成"X 操作 ≤ 5 分钟" |
| **核心功能** | 3-7 个一句话功能 | 缺：从输入抽出动名词组合 |
| **关键约束** | 截止日期 / 工期 / 合规 | 缺：标注 `<需用户补充>`，写软 blocker |

### 决策字段（3 个，必须用 AskUserQuestion）

详见 §"3 个关键决策门"。

### 可选字段（2 个）

| 字段 | 处理 |
|---|---|
| **非目标** | 从输入抽"不做 X" 类语句；缺则留空 |
| **参考资料** | URL/文件路径/竞品名称；缺则留空 |

---

## 3 个关键决策门（**必须用 AskUserQuestion**）

DDT 后续命令对这 3 个决策**强依赖**——如果替用户选错，后续 /design / /design-brief / /build-web 会走错分支。

### 决策门 D1：技术栈预设

**目的**：决定 `/design` 是直接展开 preset 默认，还是走 4 步交互问卷。

```typescript
{
  question: "选择技术栈预设？影响 /design 阶段是否走交互问卷。",
  header: "技术栈",
  multiSelect: false,
  options: [
    { label: "java-modern (Recommended)",
      description: "Spring Boot 3 + Java 21 + Maven + PostgreSQL + JPA",
      preview: "适合：Java 团队 / 企业级后台 / 已有 Java 基建" },
    { label: "node-modern",
      description: "Next.js 14 + tRPC/Prisma + PostgreSQL",
      preview: "适合：全栈 TS / SaaS / shadcn-ui 友好" },
    { label: "go-modern",
      description: "Go + Gin + sqlc + PostgreSQL",
      preview: "适合：高并发 / 微服务 / 性能敏感" },
    { label: "python-fastapi",
      description: "FastAPI + SQLAlchemy + Pydantic + PostgreSQL",
      preview: "适合：AI/ML 集成 / 数据密集 / 快速 POC" },
    { label: "interactive (走 4 步问卷)",
      description: "/design 时主动问语言/数据库/前端/UI 4 个问题",
      preview: "适合：不确定栈 / 需要严格定制 / 学习用途" },
  ]
}
```

**默认推断**（按输入信号）：
- 含 B2B 信号（"客户"、"运营"、"合同"、"账单"、"乙方/甲方"、"网点"、"车队"、"物流"、"工厂"、"医院"、"政府"、"企业内部"、"管理后台" + "5+ 模块"） → **java-modern**（B2B 后台稳定性/合规/长服役）
- 含 SaaS 信号（"产品"、"订阅"、"自助注册"、"shadcn"、"Vercel"、"Next.js"） → **node-modern**
- 含 AI/数据信号（"大模型"、"RAG"、"向量"、"NumPy"、"Jupyter"、"OpenAI SDK"） → **python-fastapi**
- 含高并发信号（"网关"、"微服务"、"高并发"、"云原生"） → **go-modern**
- **完全无信号 → node-modern**（最广 SaaS / Web App 适用面，DDT v0.8+ 默认）

**注意**：默认仅是 AskUserQuestion 中第一选项 `(Recommended)`，**禁止替用户跳过决策门**。

### 决策门 D2：前端类型（PR-E 三态）

**目的**：决定 `/design`、`/build-web`、`/design-brief` 是否参与流程。

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

**默认**：含"页面/界面/前端/UI/dashboard/后台"等词推 `spa`；提到"API/服务/库/CLI/SDK"推 `none`；提到"管理后台 + Java 模板"推 `server-side`。

### 决策门 D3：AI 设计通道（仅 frontend.type=spa 时问）

**目的**：决定 `/design-execute --channel <X>` 默认派发到哪个外部工具。

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

**默认**：用户没明确说就推 `claude-design`（v0.8 起首选，要求最少）。

---

## 质量自检（产出前必跑）

把填好的 brief **每个字段过一遍**，按下表评分：

| 字段 | 通过标准 | 不通过的处置 |
|---|---|---|
| 项目背景 | 含痛点 + 为什么现在做 | 重新询问用户 |
| 目标用户 | 至少 1 个具体角色（非"用户"二字） | AskUserQuestion 问主要用户角色 |
| 成功标准 | 至少 1 条可量化（含数字 / 时间 / 比例） | AskUserQuestion 问衡量指标 |
| 核心功能 | 3-7 条，动名词结构 | 不足 3 → 补；超过 7 → 合并 |
| 关键约束 | 截止日期 + 工期至少有 1 个 | 标 `<待补充>` + 写软 blocker |
| 技术栈预设 | D1 决策门已收到答案 | **未通过则不允许产出**——强制走 D1 |
| AI-native UI | 仅 frontend.type=spa 时必填，且 D3 已答 | 同上 |

**填充率 ≥ 70%** 才算可用 brief。低于则在产出顶部加警告：

```markdown
> ⚠️ 本 brief 由 ddt-brief-builder 生成，关键字段填充率 X%（< 70%）。
> 建议先补全标注 `<待补充>` 的字段再跑 `/prd`，否则 PRD 质量会受影响。
```

---

## 产物落盘

写入位置：**当前工作目录的 `project-brief.md`**（DDT 项目根约定）。

```bash
# 1. 检查目标位置
test ! -f project-brief.md && echo "OK 写入新 brief" || echo "⚠️ 已存在，需 --refresh 或用户授权覆盖"

# 2. 写入
# （LLM 用 Write 工具写，不用 cat 重定向，避免 emoji / 中文标点编码问题）
```

如果 `project-brief.md` 已存在：
- **AskUserQuestion**：覆盖 / 在旁边写 `project-brief.draft.md` / 取消
- 默认推荐"在旁边写 draft，让用户对比后手动合并"——避免覆盖已有内容

---

## 产出后立即输出"下一步指南"

```
✅ project-brief.md 已生成（填充率 X%，关键决策已确认）

填充摘要：
- 项目：<名称>
- 技术栈：<preset> | 前端：<frontend.type> | AI 通道：<channel-or-N/A>
- 成功标准：<n> 条（其中 <m> 条可量化）
- 关键约束：<n> 条
- 软 blocker：<n> 条（不阻塞，留待 /prd 阶段细化）

下一步：
1. （可选）打开 project-brief.md 检查 / 微调
2. 跑 `/prd` 让 product-agent 生成完整 PRD（5+ 用户故事 + Given/When/Then AC）
3. 跑 `/wbs` 拆任务
4. 跑 `/design` 出架构 + OpenAPI 契约
5. （仅 spa）跑 `/design-brief` → `/design-execute --channel <D3 选的通道>`
6. 跑 `/impl` → `/verify` → `/ship`

整条流程图：见 docs/architecture/flowchart.md（DDT v0.9 A1 自动生成）
```

---

## 与 DDT 体系的对齐契约

本 skill 必须确保产出的 brief 满足以下下游约束（**违反任一就是 BUG**）：

1. `/prd` Phase 1 检查 `project-brief.md` 存在 → 本 skill 必产此文件，路径 `cwd/project-brief.md`
2. `/design` Phase 2 读 brief 的"技术栈预设"字段 → 本字段必须是 `java-modern | java-traditional | node-modern | go-modern | python-fastapi | interactive | custom` 之一
3. `/design` Phase 2b 检查"interactive / custom" → 本 skill 决策门 D1 给用户选，禁止 LLM 自决
4. `/design-brief` 引用 brief 的"目标用户"、"核心功能" → 必填非空
5. `/design-execute` 读 `.ddt/tech-stack.json::ai_design.type`（由 /design 解析），但 brief 的 "AI-native UI" 是来源 → D3 必须给清晰值

---

## 反模式（**禁止做**）

- ❌ **替用户做技术栈决策**：哪怕用户的输入暗示了 Java，也必须用 D1 AskUserQuestion 让用户**显式**确认（防默认值与用户实际意图不符）
- ❌ **填假数据**：缺成功标准就标 `<待用户确认>` 写软 blocker，不要编一个 "MAU > 10000" 类假指标
- ❌ **越界写 PRD**：本 skill 只产 brief。用户故事 / Given-When-Then AC 是 /prd 阶段产物
- ❌ **覆盖已有 brief**：即使用户说"重新写"，先用 AskUserQuestion 确认（默认 draft 旁路）
- ❌ **跳过质量自检**：填充率 < 70% 仍产出但不警告，下游 /prd 会卡
- ❌ **"用户没说就推 java-modern"**：除非用户输入含 Java/Spring 字样，否则推 `node-modern`（最广适用面，DDT v0.8+ 实战均用此预设）

---

## 实践要点（**应该做**）

- ✅ **决策门集中提问**：D1 + D2 + D3（仅 spa）一次性 3 个 AskUserQuestion 问完，避免多轮打断用户心流
- ✅ **默认值合理**：每个决策门第一选项标 `(Recommended)` 让用户最快路径走完
- ✅ **preview 字段填具体**：让用户在选项面板就能扫一眼差异
- ✅ **写 draft 而非覆盖**：已有 brief 时默认旁路 `project-brief.draft.md`
- ✅ **带原始输入 reference**：在 brief 末尾的"参考资料"段保留用户的原始输入摘要，让 product-agent 后续能 cross-reference
- ✅ **比赛项目特殊照顾**：识别为比赛输入时，把"评分标准"作为成功指标的硬来源；把"截止日期"作为关键约束的硬约束

---

## reference 速查

详细字段决策准则：`reference/field-rules.md`
技术栈 5 预设速查：`reference/tech-stack-quick-pick.md`
AI 通道 3 选 1 速查：`reference/ai-design-quick-pick.md`

## examples 实战参照

`examples/from-paragraph.md`：用户粘贴一段散乱描述 → brief
`examples/from-existing-prd.md`：已有 PRD 反向提炼 brief
`examples/from-competition-url.md`：比赛官网链接（含外部资源处理）
