---
name: ddt-brief-builder
description: 把任意输入（一段文字 / 文件路径 / URL / 已有 PRD / 比赛官网 / 截图 / 会议纪要 / xlsx 功能清单 / 第三方 API 文档 / claude-design handoff bundle / 多源混合）转成专业 DDT 友好的 project-brief.md，作 DDT 工作流第零步。当用户说"帮我写 project-brief"、"DDT 第零步"、"新项目设置"、"测试项目设置"、"把需求转成 brief"、"我想用 DDT 跑这个项目"、"比赛项目想用 DDT"、"项目简报"、"启动 alv-ops"，或粘贴一段需求/比赛说明/已有 PRD/会议纪要/API 文档目录/claude.ai/design handoff bundle 让你转成 DDT 输入时，立即触发本 skill。覆盖 11 类输入识别、3 个关键决策门、质量自检（含 D26 preset/framework/ai_design 交叉校验）、项目目录一键脚手、与 DDT 后续命令（/prd → /wbs → /design → /design-brief）的丝滑对接。Baseline 信息源（人员/工时/进度表）触发同包的姊妹 skill `ddt-baseline-sync`。
origin: DDT
---

# DDT Brief Builder · 工作流第零步

> **使命**：把任意非结构化输入转成 DDT 标准 `project-brief.md`，让 `/prd` 一跑即过、不卡。
> **设计 KPI**（v0.9.4 实战驱动）：从一句话 → 可启动 DDT 全流程 ≤ 90 秒、≤ 5 步互动。
> **范围**：仅产出 `project-brief.md`（可选附带项目目录脚手）。后续工作流由 DDT 各 phase 命令处理。

## 何时触发

| 用户场景 | 处理 |
|---|---|
| 显式要求："帮我写 brief" / "DDT 第零步" / "启动 alv-ops" | 主流程 |
| 粘贴非结构化需求 + 提到 DDT / 比赛 / 测试项目 | 主流程 |
| 给 URL / 文件 + 问"能用 DDT 开始吗" | 主流程 |
| 已有 PRD + "DDT 让我先填 brief" | 反向提炼模式 |
| **人员表 / 工时表 / 项目计划**（独立给出，无 brief 上下文） | **改触发姊妹 skill `ddt-baseline-sync`** |

**不触发**：
- 已有 `project-brief.md` 且只想刷新 → 直接 `/prd --refresh`
- 提到 `/design-brief` → 那是 v0.8 设计阶段，与本 skill 无关

## 输入识别（开场第一步）

| 类型 | 信号 | 处理 |
|---|---|---|
| **A** 自然语言描述 | 对话直接给文本（≥ 50 字） | 直接提取字段 |
| **B** 本地文件路径 | `.md` `.pdf` `.docx` `.txt` | 用 `Read` 读取 |
| **C** URL | `http(s)://` | 用 `WebFetch` 拉取 |
| **D** 已有 PRD | 提到 "PRD" / "需求文档" / 路径含 `prd.md` | **反向提炼**：从详细 PRD 向上抽象 |
| **E** 比赛官网 / 题目 | 含"比赛" / "hackathon" / "评分标准" | 评分项作硬指标 + 历届作品作参考 |
| **F** 项目截图 / 草图 | 上传图片 | `Read` 看图后提 UI 线索作 §核心功能 |
| **G** 多源混合 | 同时多类 | 按 PRD/URL > 文件 > 文字优先级合并 |
| **H** 会议纪要 / 评审记录 | 含"会议" / "纪要" / "※" / "目标上线日" / "客户代表" | **客户驱动模式**：会议确认范围作硬约束；§2 用户分甲方/乙方 |
| **I** xlsx / csv 功能清单 | 文件名含"功能清单" / "feature-list" / "需求" | **自动 dump**：见下方 §"如何调脚本（绝对路径）"，跑 `dump-xlsx.py` |
| **J** 第三方 API 文档（v0.9.8 D25） | 目录名含 `API` / `开放平台` / `SDK` / `OpenAPI` / `swagger` / `集成规约` / `对接文档`；或单 yaml/json 含 `openapi:` 顶层；或单 md 含 `## GET /xxx` 章节 | **自动 dump 进 §11 集成依赖**：跑 `dump-api-docs.mjs`，强制脱敏后注入 brief。详见 `$DDT_PLUGIN_ROOT/skills/ddt-brief-builder/references/integration-detection.md` |
| **K** claude-design handoff bundle（v0.9.9 D26） | 用户给 `https://api.anthropic.com/v1/design/h/<id>` URL / `*.tar.gz` 含 `untitled/README.md` / 解压目录含 `chats/` + `project/tokens.css` + `*.jsx` | **自动 dump 进 §11 设计契约**：跑 `dump-design-handoff.mjs`，从 chats 抽用户决策 + AI 推荐技术栈 + tokens 摘要 + 组件清单。**强相关**：bundle 全 .jsx → 推 React；chat 中 AI 推 AntD 5（B2B）/ shadcn-ui（SaaS）。URL 形态请先用 `bin/ingest-claude-design.mjs` 落盘到 `.ddt/design/` 再传给 dump 脚本。 |

**识别后必须先告知用户**："识别到 ⟨类型⟩，将走 ⟨路径⟩ 提取字段"——给用户机会纠正。

## 如何调用本 skill 的 scripts/（v0.9.5 D22）

**LLM 跑 Bash 时 cwd 是用户项目根，不是 skill 根**——必须用绝对路径调本 skill 的脚本：

```bash
# 推荐：先解析 plugin root（marker 文件 fallback chain）
PR="${DDT_PLUGIN_ROOT:-$(cat "${HOME}/.claude/delivery-metrics/.ddt-plugin-root" 2>/dev/null)}"
PR="${PR:-${HOME}/.claude/plugins/marketplaces/digital-delivery-team}"

# 然后调本 skill 的脚本（统一前缀 $PR/skills/ddt-brief-builder/scripts/）
python3 "$PR/skills/ddt-brief-builder/scripts/dump-xlsx.py"           <path>
node    "$PR/skills/ddt-brief-builder/scripts/dump-api-docs.mjs"      <path>             # v0.9.8 D25
node    "$PR/skills/ddt-brief-builder/scripts/dump-design-handoff.mjs" <bundle.tar.gz|dir> # v0.9.9 D26
node    "$PR/skills/ddt-brief-builder/scripts/check-brief-quality.mjs" <brief-path>
node    "$PR/skills/ddt-brief-builder/scripts/scaffold-brief.mjs"      --target <dir> --brief <brief-path>
```

**禁止**：
- ❌ `python3 scripts/dump-xlsx.py ...`（cwd 是项目根，找不到）
- ❌ `python3 .claude/plugins/...`（路径错——`.claude` 在 `~`，不在项目里）
- ❌ 把 skill 内绝对路径硬编码在 brief 产物里（让产物可移植）

## 关键场景特化

| 信号 | 默认行为 |
|---|---|
| **B2B 项目**（"客户" / "运营" / "合同" / "网点" / "车队" / "物流" / "工厂" / "医院" / "政府"） | D1 决策门首选 **java-modern**（B2B 后台稳定性 + 合规） |
| **多模块**（5+ 独立模块） | §4 不强制 3-7 条上限，改用模块化 markdown（每模块 H3 + P0/P1/P2） |
| **外部接口强依赖**（"对接 X 接口" / "取决于 X 能力"） | §5 加"外部接口依赖"子项 + 未确认的接口写**软 blocker**；**已提供文档** → 触发 dump-api-docs.mjs 注入 §11 集成依赖（v0.9.8 D25） |
| **会议纪要 ※ / [必做]** | §4 自动转 P0；其余 P1 / P2 |
| **工期/范围严重不匹配** | 触发软 blocker：`reasonability check 失败：N 模块 × M 子功能 vs T 人天` |
| **客户参与决策**（会议含"客户代表"） | §2 用户分**甲方运营 / 乙方业主**两类 |
| **包含人员/工时/进度表** | 同时触发姊妹 skill `ddt-baseline-sync` 做 baseline 增量 |

## 字段提取与填充（11 字段，v0.9.8 起；v0.9.9 D26 加子字段约束）

详细规则见 `$DDT_PLUGIN_ROOT/skills/ddt-brief-builder/references/field-rules.md`（用 Read 工具读绝对路径），speed cheat：

| # | 字段 | 必填 | 缺失处理 |
|---|---|---|---|
| 1 | 项目背景 | ✅ | AskUserQuestion 问核心痛点 |
| 2 | 目标用户 | ✅ | 缺则标 `<待用户确认>` + 软 blocker |
| 3 | 成功标准 | ✅ | 至少 1 条可量化；比赛项目用评分标准 |
| 4 | 核心功能 | ✅ | 简单项目 3-7 条；多模块用模块化结构 |
| 5 | 关键约束 | ✅ | 截止 / 工期 / 合规 / 外部依赖 / 团队规模 |
| 6 | 技术栈预设 + ui_components 子字段（v0.9.9 D26）| **决策门 D1** | 严格按 preset default 填 frontend.framework；ui_components 按场景（B2B 中后台 → antd-5；SaaS → shadcn-ui） |
| 7 | 前端类型（PR-E 三态）| **决策门 D2** | 同上 |
| 8 | AI-native UI 通道 | **决策门 D3**（仅 spa） | 同上；选 claude-design 时强相关 React |
| 9 | 非目标 | 可选 | 留空 OK，建议 1-2 条防 scope creep |
| 10 | 参考资料 | 可选 | URL / 文件路径；保留原始输入摘要（被动浏览） |
| 11 | 集成依赖（v0.9.8 D25 + v0.9.9 D26 设计契约） | 可选 | 第三方 API 契约 / claude-design handoff（主动消费）；输入类型 J/K 时由 dump-api-docs / dump-design-handoff 自动产出 |

### v0.9.9 D26 反模式（实战触发）

- ❌ **java-modern + Vue + Element Plus**：preset default 是 React + Vite + Tailwind + shadcn-ui，写 Vue 是凭训练偏置（国内 Java 项目偏置）。如确需 Vue，应改 preset=interactive
- ❌ **claude-design 通道 + 非 React 框架**：bundle 全 .jsx，写其他框架增加 ~30% 改造成本
- ❌ **brief §6 留空 ui_components**：让 LLM 在下游 /prd /design 阶段自由发挥 → 训练偏置污染产出
- ✅ **check-brief-quality 自动交叉校验**：上述反模式触发软警告（不阻塞 pass，但提醒）

## 3 个关键决策门（**必须用 AskUserQuestion**）

DDT 后续命令对这 3 个决策强依赖。详细模板见 `$DDT_PLUGIN_ROOT/skills/ddt-brief-builder/references/decision-gates.md`，**speed cheat**：

```
D1 技术栈预设  → java-modern (B2B/Recommended) | node-modern | go-modern | python-fastapi | interactive
D2 前端类型    → spa (Recommended for SaaS/后台) | server-side | none
D3 AI 设计通道 → claude-design (Recommended) | figma | v0
```

**默认推断**（按输入信号给 `(Recommended)` 标记）：
- B2B 信号 → java-modern；SaaS 信号 → node-modern；AI 信号 → python-fastapi；高并发 → go-modern；其他 → node-modern
- 含 UI 词 → spa；模板渲染 → server-side；纯 API → none
- 用户没明确说 → claude-design（零外部账号成本）

**集中提问原则**：D1+D2+D3 一次性 3 个 AskUserQuestion 问完——避免多轮打断用户心流。

## 质量自检（产出前必跑）

调用脚本（**绝对路径**，详见 §"如何调用本 skill 的 scripts/"）：

```bash
node "$PR/skills/ddt-brief-builder/scripts/check-brief-quality.mjs" <draft-brief-path> --json
```

返回 JSON：`{ fill_rate_pct, filled_total, blockers, warnings, field_details }`

**门槛**：
- `pass: true`（填充率 ≥ 70% 且必填字段全填）→ 直接产出
- `pass: false` 且必填缺 → 不产出，回头问用户补
- `pass: true` 但 warnings 非空 → 产出 + 在 brief 末尾列软 blocker

## 产物落盘 + 项目脚手（一键）

**两种落盘模式**：

### 模式 A：仅写 brief 到当前目录

适用于：用户已经在项目目录里，只要 brief 文件。

```bash
# LLM 用 Write 工具写到 cwd/project-brief.md
# 已存在则 AskUserQuestion 选：覆盖 / 写 draft 旁路 / 取消
```

### 模式 B：一键脚手新项目目录（**演示首选 / 丝滑模式**）

适用于：用户给项目名 + brief 内容，期望立即 cd 进去跑 `/prd`。

```bash
# 先把 brief 写到临时位置（如 /tmp/brief.md），再调脚本（**绝对路径**）：
node "$PR/skills/ddt-brief-builder/scripts/scaffold-brief.mjs" --target <project-dir> --brief <brief-path>
```

脚本会一次完成：mkdir → cp brief → cp .gitignore → git init → initial commit → 输出"下一步"引导。

**适用场景判断**：
- 用户说 "启动 alv-ops" / "新建项目目录" / "为 X 项目脚手" → 走模式 B
- 用户在已有项目目录里 → 走模式 A

## 产出后立即输出"下一步指南"

```
✅ project-brief.md 已生成（填充率 X%，关键决策已确认）

填充摘要：
- 项目：<名称>
- 技术栈：<preset> | 前端：<spa|server-side|none> | AI 通道：<channel|N/A>
- 成功标准：<n> 条（其中 <m> 条可量化）
- 软 blocker：<n> 条（不阻塞，留 /prd 阶段细化）

下一步链路：
1. /digital-delivery-team:prd            # product-agent 出 PRD
2. /digital-delivery-team:wbs            # 拆任务（baseline 已校准则估算更准）
3. /digital-delivery-team:design         # 出架构 + OpenAPI 契约
4. (spa) /digital-delivery-team:design-brief → design-execute --channel claude-design
5. /digital-delivery-team:impl → :verify → :ship

完整流程图：docs/architecture/flowchart.md（v0.9 A1 自动生成）
如有人员/工时表 → 对 Claude 说"导入 baseline 工时数据"触发 ddt-baseline-sync
```

## 与 DDT 体系的对齐契约（违反就是 BUG）

1. `/prd` Phase 1 检查 `project-brief.md` 存在 → 路径 `cwd/project-brief.md`
2. `/design` Phase 2b 读"技术栈预设"字段 → 值在 `java-modern | java-traditional | node-modern | go-modern | python-fastapi | interactive | custom` 7 个枚举内
3. `/design` Phase 2b 检查 `interactive` / `custom` → 本 skill D1 必须 AskUserQuestion 让用户选
4. `/design-brief` 引用 brief 的"目标用户"、"核心功能" → 必填非空
5. `/design-execute` 读 `.ddt/tech-stack.json::ai_design.type` → D3 决策门必须给清晰值

## 边界（**做 / 不做**）

✅ **做**：
- D1+D2+D3 集中一次 AskUserQuestion 问完（避免多轮打断）
- 缺字段标 `<待用户确认>` + 写软 blocker，不编假数据
- 已有 brief 默认旁路 `project-brief.draft.md`，不直接覆盖
- 在 §10 参考资料保留原始输入摘要让 product-agent 后续能 cross-reference
- 比赛项目把评分标准作 §3 硬指标
- 多源输入按 PRD/URL > 文件 > 文字优先级合并

❌ **不做**：
- 替用户决定技术栈（哪怕输入暗示 Java，也必须 D1 显式确认）
- 越界写 PRD（用户故事 / Given-When-Then AC 是 /prd 阶段的事）
- 覆盖已有 brief 而不问
- 跳过质量自检（填充率 < 70% 仍产出但不警告）
- 把人员/工时表内容塞 brief 字段（应触发 ddt-baseline-sync）

## 资源索引

```
ddt-brief-builder/
├── SKILL.md                                ← 本文件（识别 + 决策 + 自检 + 输出）
├── scripts/
│   ├── dump-xlsx.py                        ← xlsx 全文 dump（自动 pip install openpyxl）
│   ├── dump-api-docs.mjs                   ← 第三方 API 文档摘要（v0.9.8 D25，零依赖 yaml + 脱敏）
│   ├── dump-design-handoff.mjs             ← claude-design handoff bundle 摘要（v0.9.9 D26）
│   ├── check-brief-quality.mjs             ← brief 字段填充率自检（11 字段 + D26 交叉校验）
│   └── scaffold-brief.mjs                  ← 项目目录一键脚手（mkdir+cp+git init+commit）
├── references/
│   ├── field-rules.md                      ← 11 字段决策准则（含 §6 §7 D26 反模式）
│   ├── integration-detection.md            ← 类型 J 第三方 API 文档识别信号（v0.9.8 D25）
│   ├── ui-library-by-scenario.md           ← UI 库场景化推荐（v0.9.9 D26）
│   ├── tech-stack-quick-pick.md            ← D1 速查（输入暗示 → preset 推荐）
│   ├── ai-design-quick-pick.md             ← D3 速查（3 通道差异 + claude-design 框架强相关）
│   └── decision-gates.md                   ← D1/D2/D3 完整 AskUserQuestion 模板
└── examples/
    ├── from-paragraph.md                   ← 用户粘贴一段文字 → brief
    ├── from-existing-prd.md                ← 已有 PRD 反向提炼 brief
    ├── from-competition-url.md             ← 比赛项目特化（评分项作硬指标）
    ├── from-meeting-minutes.md             ← B2B 多模块实战（会议纪要 + xlsx 多源）
    ├── from-api-docs-folder.md             ← 第三方 API 文档目录 + OpenAPI yaml 双例（v0.9.8 D25）
    └── from-design-handoff.md              ← claude-design handoff bundle 实战（v0.9.9 D26）
```

**姊妹 skill**：
- `skills/ddt-baseline-sync/`：人员/工时/进度表 → `baseline/historical-projects.csv` 增量同步
