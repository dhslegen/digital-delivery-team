---
name: relay
description: 跨会话/跨 AI 接力不失忆。当用户说"接力"、"换会话"、"context 不够了"、"token 即将耗尽"、"/relay"、"换 AI 继续"、"导出当前进度给下个会话"、"备忘录"、"传家宝"，或检测到长会话需要切换时，立即触发本 skill 生成 AI 友好的接力 prompt 由用户复制到下一会话。
origin: DDT
---

# DDT Relay · 跨会话接力 skill

> DDT 13 段式接力 prompt 范式：覆盖 What WORKED / What Did NOT Work / Decisions / Next Step 等关键信息，叠加 DDT 项目特定背景注入（progress.json / tech-stack.json / 关键产物路径自动捕获）。

## 何时触发

只要用户表达"换会话续作"的意图，立即启动本 skill：

- 显式触发：`/digital-delivery-team:relay` 或 `/relay`
- 关键词触发："接力"、"换会话"、"换 AI"、"导出进度"、"context 不够"、"token 不够"、"备忘录"、"传家宝"、"会话切换"、"接力提示词"
- 隐式信号：会话已运行超过 4 小时 / 工具调用次数 ≥ 200 / 连续 3 次提示 compact

## 工作流

### Step 1: 收集材料（让 main thread 自己做，不开 subagent）

读取以下来源（按优先级）：

1. `.ddt/progress.json` — 阶段进度状态机
2. `.ddt/tech-stack.json` — 技术栈选型
3. `.ddt/project-id` — 项目 ID
4. `project-brief.md` — 原始需求
5. `docs/*.md` — 已落盘的产物（PRD / WBS / arch / blockers / review-report ...）
6. `git log --oneline -30` — 近 30 次提交（已确认有效的工作）
7. `git status --short` — 未提交的改动（在制品）
8. `git diff --stat HEAD~10` — 最近 10 个 commit 的变更摘要
9. 当前会话的对话历史 — 抽取本次会话内 LLM 自己识别的关键决策、失败尝试、未尝试方向

### Step 2: 调用 build-relay-prompt.mjs 生成结构化 prompt 文件

```bash
node "$DDT_PLUGIN_ROOT/bin/build-relay-prompt.mjs" --out .ddt/relay-$(date +%Y%m%d-%H%M%S).md
```

脚本自动注入：
- 项目 ID / 当前 phase / 已完成 phase
- 技术栈摘要
- 关键产物绝对路径
- git 历史摘要

### Step 3: LLM 在生成的 prompt 文件基础上补充会话内容

**LLM 必须填写的 9 个段落（13 段中其余 4 段由脚本自动填）**：

1. **What We Are Building** — 1-3 段：项目目标 + 为什么 + 系统位置（参考 brief + PRD 第 1 段）
2. **What WORKED (with evidence)** — 已验证有效的产出（每条带具体证据：test 通过 / lint 0 错 / git commit / 用户确认）
3. **What Did NOT Work (and why)** — 失败的尝试 + 精确原因（防止下次重试同一坑，**最关键**段）
4. **What Has NOT Been Tried Yet** — 待尝试的方向（含原因）
5. **Current State of Files** — 表格：路径 / status (✅ / 🟡 / ❌ / ⏸) / Notes
6. **Decisions Made** — 架构 / 技术选型决策 + 理由
7. **Blockers & Open Questions** — 未解决的阻塞 + 待回答的问题
8. **Exact Next Step** — 下次会话的第一步（精确到无需思考）
9. **Environment & Setup Notes**（可选） — 启动命令 / 环境变量 / 依赖

**禁忌**：
- 不要把"未确认有效"的工作放进 What WORKED（移到 What Has NOT Been Tried Yet）
- 不要省略 What Did NOT Work（即使写"无失败尝试"也比省略好）
- 不要在 Exact Next Step 里写"看情况"、"视需要"——必须精确

### Step 4: 输出完整 prompt 到屏幕

把整个 prompt 用 ```text``` 代码块包裹输出到屏幕，让用户能一键 copy。

显著标注："**请整段复制下面的 prompt 到下一个会话开头**"。

### Step 5: 提示用户操作

```
✅ Relay prompt 已生成
   文件存档：.ddt/relay-<timestamp>.md
   屏幕上方代码块：可一键复制

下一会话使用方法：
1. 打开新会话（同设备 / 不同设备 / 不同 AI 模型均可）
2. 把上面代码块整段粘贴到第一句对话
3. AI 会读到完整背景，从 "Exact Next Step" 直接续作
```

## prompt 模板（脚本预填 + LLM 补全）

```markdown
# DDT Relay Prompt（请整段复制到下一会话开头）

You are continuing DDT delivery for project: <project_id>
Last session ended: <ISO timestamp>

═══════════════════════════════════════════════════

## 项目背景（DDT 自动注入）

- **项目目录**: <absolute path>
- **项目 ID**: <from .ddt/project-id>
- **当前 phase**: <from .ddt/progress.json::current_phase>
- **已完成 phase**: <list of completed>
- **技术栈**: <one-line summary from .ddt/tech-stack.json>
- **AI 设计通道**: <ai_design.type>

### 关键产物路径
| 类型 | 路径 |
|------|------|
| PRD | docs/prd.md |
| WBS | docs/wbs.md |
| 架构 | docs/arch.md |
| API 契约 | docs/api-contract.yaml |
| 数据模型 | docs/data-model.md |
| 评审 | docs/review-report.md（含 Fix Log） |
| 测试 | tests/test-report.md |
| 阻塞 | docs/blockers.md |

### Git 摘要
- 当前分支: <branch>
- 最近 5 commits:
  - <sha>: <subject>
  - ...
- 未提交改动: <git status --short 行数>

═══════════════════════════════════════════════════

## 1. What We Are Building（LLM 填）

<1-3 段：项目目标 + 为什么 + 系统位置>

## 2. What WORKED (with evidence)（LLM 填）

- ✅ <成果>: 验证证据 = <具体证据，如 "15/15 测试通过 / lint 0 errors / commit abc123 / 用户已确认">
- ✅ ...

## 3. What Did NOT Work (and why)（LLM 填，最关键）

- ❌ <尝试>: 失败原因 = <具体 error message / 错误假设 / 被 X 阻塞，写得越精确越好>
- ❌ ...

## 4. What Has NOT Been Tried Yet（LLM 填）

- <方向>: <为什么值得尝试>
- ...

## 5. Current State of Files（LLM 填）

| File | Status | Notes |
| --- | --- | --- |
| docs/prd.md | ✅ Complete | 5 故事 / 26 AC |
| server/src/routes/tasks.ts | 🟡 In Progress | GET 已实现，POST 待写 |
| docs/blockers.md | ⚠️ 1 条未解决 | <blocker 摘要> |

## 6. Decisions Made（LLM 填）

- <决策>: 理由 = <为什么这样选 vs 替代方案>
- ...

## 7. Blockers & Open Questions（LLM 填）

- <blocker>: 等待 = <什么 / 谁>
- ...

## 8. Exact Next Step（LLM 填，最关键）

<精确到无需思考的下一步指令；含具体命令 / 文件路径 / 行号 / 验证方式>

## 9. Environment & Setup Notes（可选）

<启动命令 / 环境变量 / 依赖>

═══════════════════════════════════════════════════

## 续作前请先做：

1. `/digital-delivery-team:doctor` 确认环境
2. `/digital-delivery-team:resume` 读 progress.json
3. 然后从 "Exact Next Step" 开始

如有疑问按 Blockers 处理或新增 blocker（追加到 docs/blockers.md），不要猜测。
```

## DDT 范式

- `/relay` 是 **DDT 项目专用**接力（自动捕获 .ddt/* 与契约相关产物 + 13 段式结构化 prompt）
- 专注 DDT 项目背景的精准接力，不依赖外部插件。

## 与 /resume 的差异

| 命令 | 用途 | 输出位置 |
|------|------|---------|
| `/digital-delivery-team:resume` | 同会话/同设备恢复 | 屏幕（briefing） |
| `/digital-delivery-team:relay` | 跨会话/跨 AI 接力 | prompt 文件 + 屏幕（用户复制） |

- 同设备同会话续作 → `/resume`（自动）
- 切换会话 / 切换 AI 模型 / 跨设备 / 给同事 → `/relay`（导出 prompt）

## Don't

- 不要在 prompt 里写敏感信息（API key / token / 密码）—— 脚本会自动 redact 但 LLM 补全时也要小心
- 不要在 What WORKED 里塞未确认的工作（移到 Not Tried Yet）
- 不要省略 What Did NOT Work（这是接力最关键的段）
- 不要把 prompt 写成"对话日志"——它必须是**结构化背景信息**，下个 AI 才能直接接手

## Do

- 一次会话长达 1 小时以上，主动问用户"是否要 /relay 备份当前进度？"
- 检测到接近 token 上限时主动触发
- 复盘项目时跑一次 /relay，把完整背景作为档案归档
