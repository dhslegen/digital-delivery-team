# digital-delivery-team

> 一人一队 · 全栈工程师的 AI 数字员工交付插件

为 Claude Code 提供 **契约先行（Contract-First）+ 数字员工分工（Agent-Owned）+ 自动度量（Hooks-Driven）+ 人机协作（Decision-Gated）** 的端到端交付工作流。**一句话**：从产品需求到上线交付，由 8 个数字员工接力完成，每个关键节点你都能介入决策，每个阶段自动度量，每条产物可追溯。

8 数字员工 · 19 命令 · 11 技能 · 8 类 Hook · 5 套技术栈预设 · 4 套 AI-native UI 通道 · 6-phase 开发范式 · 决策门 · 进度状态机 · 跨会话接力 · Node 22+ 零 npm 依赖

[![Tests](https://img.shields.io/badge/tests-122%2F122%20passing-brightgreen)](#testing) [![Version](https://img.shields.io/badge/version-0.7.0-blue)](./CHANGELOG.md) [![License](https://img.shields.io/badge/license-MIT-blue)](./LICENSE)

---

## 安装

通过 Claude Code 插件市场（推荐，零配置）：

```text
/plugin marketplace add https://github.com/dhslegen/digital-delivery-team
/plugin install digital-delivery-team@digital-delivery-team
/reload-plugins
```

> Claude Code v2.1+ 会自动加载 hooks，无需修改 `~/.claude/settings.json`。

安装后**先做一次自检**：

```text
/digital-delivery-team:doctor
```

应见 11 项全部 ✅。任一未通过按提示处理。

---

## 5 分钟上手

```bash
cd your-project/
echo "我要做一个任务清单 Web App，支持看板视图和标签管理" > project-brief.md
```

回到 Claude Code 会话内：

```text
/kickoff                    # 默认 interactive 模式：每个 phase 落盘后暂停决策门
/impl                       # 串行 /build-api → 决策门 → /build-web，每文件 validation
/verify                     # 测试 + 评审并行
/ship                       # 文档 + 效率报告 + 打包
```

如果想要旧版"一键自动"体验：

```text
/kickoff --auto             # 跳过所有决策门，按 v0.6.x 串行 chain 跑
```

完成后产出全部位于项目目录：

```text
docs/prd.md  docs/wbs.md  docs/risks.md
docs/arch.md  docs/api-contract.yaml  docs/data-model.md
docs/build-api-exploration.md  docs/build-api-plan.md  docs/build-api-summary.md
docs/build-web-exploration.md  docs/build-web-plan.md  docs/build-web-summary.md
web/...  server/...  tests/test-report.md
docs/review-report.md  docs/efficiency-report.md
README.md  docs/deploy.md  docs/demo-script.md
.ddt/progress.json  .ddt/tech-stack.json  .ddt/checkpoints.log  .ddt/decisions.jsonl
delivery-<project-id>-<timestamp>.tar.gz   ← 一键交付包
```

> 中途随时 `/preview <phase>` 看摘要、`/resume` 看进度、`/relay` 导出接力 prompt。

---

## v0.7.0 三大核心能力

### 1. 6-phase 开发范式（去 subagent 黑盒）

`/build-api` 与 `/build-web` 不再用 subagent 黑盒派发，改为 main thread 流式 6-phase：

```
EXPLORE  →  PLAN  →  APPROVE  →  IMPLEMENT  →  VERIFY  →  SUMMARY
   ↓         ↓         ↓            ↓             ↓         ↓
扫现状    生 plan   决策门      逐步写+测      全量测   落 summary
落盘     落盘      用户批准    每step checkpoint  契约对齐
```

**关键约束**：每写一个文件立即跑 build/lint/typecheck/test（`skills/validation-loop`）；通过则 `git commit` checkpoint（`skills/checkpoint-commit`）；失败立即停下让用户决策。

### 2. 决策门（去盲盒）

10 个 phase 落盘后强制触发 `AskUserQuestion` 4 选项问卷：

- **接受并继续** → 进入下一 phase
- **修改某条具体内容** → 询问哪条 + 怎么改 → `--refresh` 增量
- **新增内容** → 询问补什么 → `--refresh`
- **重新生成** → 询问原因 → `--refresh` 重写

未传 `--auto` 时每个 phase 都暂停决策门——你不再是被动观察者，而是每个关键节点的决策者。

详见 `skills/decision-gate/SKILL.md`。

### 3. 跨会话接力（不失忆）

```text
/relay                      # 输出 13 段式接力 prompt
                            # 自动注入 progress.json / tech-stack.json / git log / 关键产物路径
```

把屏幕输出整段复制到下一会话开头 → AI 读到完整背景 → 从 "Exact Next Step" 直接续作。同设备 / 不同设备 / 不同 AI 模型都能用。

---

## 命令矩阵

### 岗位命令（按角色，10 个）

| 岗位 | 命令 | 主要产物 | 实现方式 |
|------|------|---------|---------|
| 产品 | `/prd` | `docs/prd.md`（含 Given/When/Then 验收标准） | product-agent |
| PM | `/wbs` | `docs/wbs.md` + `docs/risks.md` | pm-agent |
| 架构 | `/design` | `docs/arch.md` + `docs/api-contract.yaml` + `docs/data-model.md` | architect-agent |
| 后端 | `/build-api` | `server/`（含集成测试 + summary） | **main thread + 6-phase + skill** |
| 前端 | `/build-web` | `web/`（含 happy-path 测试 + summary） | **main thread + 6-phase + skill** |
| 测试 | `/test` | `tests/test-report.md`（覆盖率 ≥ 70%） | test-agent |
| 评审 | `/review` | `docs/review-report.md`（阻塞/警告/建议三级） | review-agent |
| 修复 | `/fix` | review-report 条目逐条 patch（默认 dry-run） | fix-agent |
| 文档 | `/package` | `README.md` + `docs/deploy.md` + `docs/demo-script.md` | docs-agent |
| 度量 | `/report` | `docs/efficiency-report.md`（含洞察 + 优化建议） | metrics-agent |

> v0.7.0 起 `/build-api` `/build-web` 不再用 subagent 派发，改为 main thread 流式可见 + 每文件 validation。

### 编排命令（4 个）

| 命令 | 等价于 | 适用场景 |
|------|--------|---------|
| `/kickoff [--auto] [--preset]` | `/prd` → `/wbs` → `/design` | 新项目起手；默认 interactive |
| `/impl [--web-only\|--api-only] [--auto] [--module <name>]` | **串行** `/build-api` → `/build-web` | 设计冻结后实现 |
| `/verify` | `/test` ‖ `/review`（并行） | 实现完成后并行验收 |
| `/ship` | `/package` → `/report` + 打包 tar.gz | 交付出包 |

### 辅助命令（5 个）

| 命令 | 用途 |
|------|------|
| `/fix [--severity blocker\|warning\|all] [--apply]` | 按 review-report 修复，默认 dry-run |
| `/design-brief` | 从 PRD + 契约编译结构化 brief（10 字段 SSoT） |
| `/design-execute --channel claude-design\|figma\|v0 [--bundle <path>\|--url <share>]` | 派发 brief 到外部 AI 设计工具，再摄取产物到 `.ddt/design/<channel>/raw/` |
| `/preview <prd\|wbs\|design\|impl\|test\|review\|fix\|package\|report\|all>` | 输出指定 phase 关键摘要 + diff（决策门前快速扫一眼） |
| `/resume` | 显示当前进度 + 下一步建议（同会话恢复） |
| `/relay [--out <path>]` | **跨会话接力**：13 段式 prompt 输出，复制到下一会话即可续作 |
| `/digital-delivery-team:doctor` | 11 项安装自检 |

---

## 技术栈选型

### 5 套预设（最快路径）

`project-brief.md` 中写 `**技术栈预设**: <name>`：

| 预设 | 后端 | 前端 | 默认 AI 设计 |
|------|------|------|------------|
| `java-modern` ⭐ | Spring Boot 3.5 + MySQL 8 + Redis 7 + Maven + MyBatis-Plus | React 18 + Vite + Tailwind + shadcn-ui | claude-design |
| `java-traditional` | Spring Boot 2.7 + MySQL 5.7 + Maven + MyBatis | Vue 3 + Element Plus | claude-design |
| `node-modern` | Nest.js 10 + Postgres + Prisma | Next.js 14 (App Router) + Tailwind + shadcn-ui | v0 |
| `go-modern` | Gin + Postgres + GORM | React 18 + Tailwind + shadcn-ui | claude-design |
| `python-fastapi` | FastAPI + Postgres + SQLAlchemy + Alembic | React 18 + Tailwind + shadcn-ui | claude-design |

### Spring Initializr 等价问卷（推荐路径，v0.6.1+）

`project-brief.md` 中写 `**技术栈预设**: interactive`，跑 `/kickoff` 时 LLM 主动调用 `AskUserQuestion` 4 步问卷：

1. **主语言栈**（Java SpringBoot 3 / Node TS / Python FastAPI / Go）
2. **数据库 + 缓存**（PostgreSQL+Redis / MySQL+Redis / SQLite / MongoDB）
3. **前端框架**（React+Vite / Next.js 14 / Vue 3 / Angular 19）
4. **UI 组件库**（动态：根据前端选项展示 tailwind+shadcn / antd / element-plus 等）

每个选项含 `preview` 字段展示完整 stack 摘要。

完整 22 分组 200+ 组件清单见 `templates/tech-stack-options.yaml`（吸收 https://start.spring.io 实测数据）。

### 优先级链

CLI flag → `project-brief.md`：技术栈预设字段 → 已存在的 `.ddt/tech-stack.json` → manifest 自动检测（`pom.xml`/`package.json`/`go.mod`/`pyproject.toml`）→ 默认 `java-modern`。

> `.ddt/tech-stack.json` 是技术栈 SSoT，**仅 `bin/resolve-tech-stack.mjs` 可写入**；agent / LLM 直接编辑会被 PreToolUse hook 硬拦截（v0.6.1+）。

---

## AI-native UI 通道（v0.8 W3 重构：brief 编译器 + 3 通道分发器）

工作流分两步（v0.8 删除 `/import-design` 与 `lovable` 通道）：

```text
/design-brief                                    # 从 PRD + 契约编译 10 字段 brief
/design-execute --channel <type> [...]           # 派发 brief 到外部工具 + 摄取产物
```

| 通道 | 适用场景 | 工作流要点 |
|------|---------|----------|
| `claude-design` ⭐ | 首选默认；用户已订阅 Claude，零成本零网络外发 | brief → claude.ai/design 迭代 → `--bundle <zip>` 摄取 → main thread 按 SKILL §7 改写 |
| `figma` | 设计稿驱动 | brief → figma MCP 引导清单 → main thread 调 `get_design_context` → 转 React + Tailwind |
| `v0` | Next.js 现代化 UI | brief → `--url <share>` → 解析 v0 share URL → `npx shadcn add` → 接 OpenAPI client |

> v0.7 的 `lovable` 通道在 v0.8 删除——强 Supabase 集成与 DDT 后端契约冲突，不做 alias（密集开发期无历史用户）。

详细工作流见 `skills/ai-native-design/SKILL.md`。

---

## 架构概览

```text
project-brief.md
    └─ /kickoff ────── product-agent   ──► docs/prd.md                   （决策门 ✅）
                  ├─── pm-agent        ──► docs/wbs.md + docs/risks.md   （决策门 ✅）
                  └─── architect-agent ──► docs/arch.md + docs/api-contract.yaml + docs/data-model.md
                                            （契约 lint 通过 + 决策门 ✅）

    └─ /impl ────── 【串行】
        ├─ /build-api  EXPLORE → PLAN → APPROVE → IMPLEMENT → VERIFY → SUMMARY
        │              （main thread + skills/backend-development）
        │              （每文件 validation-loop + checkpoint-commit）
        │
        └─ /build-web  EXPLORE → PLAN → APPROVE → IMPLEMENT → VERIFY → SUMMARY
                       （main thread + skills/frontend-development）
                       （ai_design.type 决定 UI 来源）

    └─ /verify ─────── test-agent      ──► tests/test-report.md          （并行）
                  └─── review-agent    ──► docs/review-report.md         （并行）

    └─ /fix ────────── fix-agent       ──► 源码 patch + Fix Log

    └─ /ship ───────── docs-agent      ──► README.md + docs/deploy.md + docs/demo-script.md
                  └─── metrics-agent   ──► docs/efficiency-report.md
                                            + delivery-<id>-<ts>.tar.gz
```

### 插件目录

| 目录 | 内容 |
|------|------|
| `agents/` | 8 个数字员工子代理（v0.7.0 删除 backend/frontend，转入 skills） |
| `commands/` | 19 个命令（10 岗位 + 4 编排 + 5 辅助 + relay/preview） |
| `skills/` | 11 个领域知识 + 范式包 |
| `hooks/` | 8 类事件注册 + handlers + lib/ |
| `bin/` | 15 个脚本（aggregate / report / progress / resume / relay / preview / emit-phase / emit-decision / doctor / ...） |
| `templates/` | 12 个模板（含 **tech-stack-presets** + **tech-stack-options** Spring Initializr 等价清单） |
| `contexts/delivery.md` | 全局交付上下文（agent 必读） |
| `rules/delivery/` | 6 条 Global Invariants 权威定义 |
| `tests/` | 22 个测试文件（122 用例） |
| `baseline/` | 历史项目基准数据 + 估算规则 |

### 11 个 skill（v0.7.0）

| Skill | 用途 | 来源 |
|-------|------|------|
| `acceptance-criteria` | Given/When/Then 验收标准写法 | DDT |
| `api-contract-first` | OpenAPI 3.0 契约设计规范 | DDT |
| `efficiency-metrics` | 度量基线 + 效率报告 | DDT |
| `delivery-package` | README/deploy/demo 模板 | DDT |
| `ai-native-design` | 3 套 AI 设计源工作流（claude/figma/v0；v0.8 删 lovable） | DDT |
| **`backend-development`** | 后端实现知识包（替代 backend-agent，v0.7.0） | DDT |
| **`frontend-development`** | 前端实现知识包（替代 frontend-agent，v0.7.0） | DDT |
| **`validation-loop`** | 每文件 build/lint/test，失败立即停 | DDT (v0.7.0) |
| **`checkpoint-commit`** | 每 step git commit + .ddt/checkpoints.log | DDT (v0.7.0) |
| **`decision-gate`** | 标准 4 选项决策门模板 | DDT (v0.6.2) |
| **`relay`** | 跨会话接力 13 段式 prompt | DDT (v0.6.0) |

---

## 度量与效率追踪

8 类自动 hook（零侵入，无需手动触发）：

| Hook 事件 | 触发时机 | 采集内容 |
|-----------|---------|---------|
| `SessionStart` | 会话开始 | session_id / Node 版本 / 持久化 plugin-root marker / 自动 bootstrap project_id / progress 推断 / 注入 additionalContext |
| `SessionEnd` | 会话结束 | token 消耗 + 释放本会话 advisory lock |
| `UserPromptSubmit` | 用户输入 | 抓 slash command 作 phase 标签 → 写 `phase_start` 事件 |
| `PreToolUse` | 工具调用前 | 工具名 / 文件路径 / Bash 头 / Task 时写 `subagent_start` + advisory lock + tech-stack.json **硬拦截 deny** |
| `PostToolUse` | 工具调用后 | 成功/失败 / 耗时 / 自动捕获 test-report.md 与 review-report.md 中的质量指标 |
| `PostToolUseFailure` | 工具调用失败 | 失败工具事件（与 PostToolUse 共享 handler） |
| `SubagentStop` | 子代理完成 | 通过 lookback join 反查 PreToolUse 记录的 `subagent_start`，重建真实 name + duration |
| `Stop` | 每个 turn 结束 | 关闭未闭合 phase + 后台触发 metrics 聚合 + progress.json infer |

数据链路（v0.6.0+ 增量 ingest）：

```text
hooks → ~/.claude/delivery-metrics/events.jsonl
    └─→ bin/aggregate.mjs (watermark 增量) → metrics.db
        └─ sessions / tool_calls / subagent_runs / phase_runs / quality_metrics
        └─ ingest_watermark / decisions
        └─→ bin/report.mjs → docs/efficiency-report.raw.md
            └─→ metrics-agent → docs/efficiency-report.md
                                 （工时缺失时严格判定"不可证明"，禁止用 WBS 预估替代）
```

> Baseline 文件（`baseline/baseline.locked.json`）首次 `/report` 自动封盘，封盘后不可变。

---

## 进度状态机与跨会话恢复

每个 DDT 项目在 `.ddt/progress.json` 维护一份状态机：

```json
{
  "schema_version": 1,
  "project_id": "proj-xxx",
  "current_phase": "design",
  "last_activity_at": "2026-04-29T07:55:00Z",
  "phases": {
    "prd":     { "status": "completed",   "started_at": "...", "completed_at": "..." },
    "design":  { "status": "in_progress", "started_at": "...", "completed_at": null  },
    ...
  }
}
```

由 hook 全自动维护：
- **SessionStart**：根据 `docs/*` 文件存在性 infer 状态
- **UserPromptSubmit**：检测到岗位 phase 命令时标 `in_progress`
- **Stop**：每个 turn 结束 infer，artifact 出现则标 `completed`

**两种续作机制**：

| 命令 | 用途 | 输出 |
|------|------|------|
| `/resume` | 同会话/同设备恢复 | 屏幕（briefing） |
| `/relay` | **跨会话/跨设备/跨 AI 接力** | 13 段式 prompt（用户复制） |

`/relay` 自动注入项目背景：项目 ID / 当前 phase / 已完成 phase / 技术栈摘要 / 关键产物路径 / git log / 未提交改动 + 等 LLM 补充 9 段（What WORKED / What Did NOT Work / Decisions / Next Step ...）。

---

## 退出码约定

| Code | 含义 | 来源 |
|------|------|------|
| 0 | 成功 | 所有命令 |
| 1 | 前置条件未满足（必读文件缺失 / `DDT_PLUGIN_ROOT` 未解析 / 参数错误） | 各命令 Phase 1 |
| 2 | 存在未解决 blocker（`docs/blockers.md` 中 `resolved_at: null`） | `bin/check-blockers.sh` |
| 3 | 契约对齐失败（`/design-execute` 摄取的代码或 main thread 改写引入禁用模式） | `bin/check-contract-alignment.mjs` |
| 4 | OpenAPI lint 失败（schema 错误 / security 未声明等） | `/design`、`/impl`、`/kickoff` |
| 5 | OpenAPI lint 工具缺失（`npx` 不可用 / `@redocly/cli` 未装） | 同上 |

OpenAPI 契约 lint 是**硬门禁**：lint 不通过禁止推进到 `/build-web`、`/build-api` 或 `/ship`。

---

## 数据与隐私

- 所有度量数据落在本地 `~/.claude/delivery-metrics/`，**不上报任何外部服务**
- 项目本地数据落在 `.ddt/`：progress.json / tech-stack.json / decisions.jsonl / checkpoints.log / locks/ / relay-*.md
- Bash 命令仅记录前 80 字符；工具事件仅记录度量必需字段
- 度量数据库（`metrics.db`）为本地 SQLite，可随时删除
- 清空数据：`rm -rf ~/.claude/delivery-metrics/`

---

## 环境要求

| 项 | 要求 |
|----|------|
| Node.js | **≥ 22.0.0**（使用内置 `node:sqlite`，零 npm 依赖） |
| Claude Code | v2.1+（hook 自动加载 + AskUserQuestion 工具支持） |
| 操作系统 | macOS / Linux / Windows（建议 WSL2） |
| 可选工具 | `@redocly/cli`（OpenAPI lint，命令首次运行时 `npx` 自动拉取） |

### 可选环境变量

| 变量 | 默认 | 说明 |
|------|------|------|
| `DDT_METRICS_DIR` | `~/.claude/delivery-metrics/` | 度量数据目录 |
| `DDT_PROJECT_ID` | 自动从 `.ddt/project-id` 读取 | 当前项目 ID |
| `DDT_HOOK_PROFILE` | `standard` | Hook 档位：`minimal` / `standard` / `strict` |
| `DDT_DISABLED_HOOKS` | 空 | 禁用指定 hook id（CSV，例：`ddt:pre-tool-use`） |

> 度量脚本与 hook 开关都使用独立 `DDT_*` 命名空间，不读取其他插件命名空间的环境变量，也不依赖 MCP server 或远程上报。

---

## 故障排查

**优先做这一步**：

```text
/digital-delivery-team:doctor
```

11 项检查覆盖：Node 版本 / 插件 root / SessionStart marker / hooks.json 8 个事件注册 / events.jsonl 可写 / metrics.db 完整 / `@redocly/cli` 可用 / `check-blockers.sh` 权限 / M3-M6 脚本完整 / 技术栈预设与 ai-native-design skill / progress.json 写入路径。

**常见问题**：

| 现象 | 处理 |
|------|------|
| `Node ≥ 22 ❌` | `nvm install 22 && nvm use 22` |
| `SessionStart marker ❌` | 重启 Claude Code 会话（marker 由 SessionStart hook 自动写入） |
| `@redocly/cli ❌` | 确认网络可达；首次执行命令时 `npx --yes @redocly/cli` 会自动安装 |
| `progress.json 状态错误` | 手动校正：`node "$DDT_PLUGIN_ROOT/bin/progress.mjs" --update <phase> <status>` |
| 跨会话忘记进度 | `/resume`（同会话）或 `/relay`（跨会话） |
| `efficiency-report 工时膨胀` | v0.5.x bug，升级到 v0.6.0+ 后跑 `node bin/aggregate.mjs --project <id> --rebuild` |

---

## Testing

```bash
cd plugins/digital-delivery-team
npm test                  # 全量（122 个测试用例 / 22 个文件）
npm run test:unit         # 仅 unit
npm run test:integration  # 仅 integration
```

| 测试套（22 个文件 / 122 用例） | 覆盖 |
|-----|------|
| `tests/unit/frontmatter.test.mjs` | agents/skills/commands frontmatter 必填 |
| `tests/unit/hooks-registration.test.mjs` | hooks.json 合法性 + entry id 唯一 |
| `tests/unit/plugin-manifest.test.mjs` | manifest --check 通过 |
| `tests/unit/v3-semantics.test.mjs` | metrics-integrity / contract-integrity / refresh 增量语义 |
| `tests/unit/phase-detection.test.mjs` | UserPromptSubmit slash command 识别 |
| `tests/unit/commands-slim.test.mjs` | 防 commands 退化 |
| `tests/unit/find-plugin-root.test.mjs` | plugin-root 5 级解析链 |
| `tests/unit/m3-agents.test.mjs` | architect/backend/frontend 必读 tech-stack.json + skill 替代 agent |
| `tests/unit/advisory-lock.test.mjs` | 白名单 / 冲突 / stale / 释放 |
| `tests/integration/metric-chain.test.mjs` | aggregate → baseline → report 全链路 |
| `tests/integration/blocker-gate.test.mjs` | blocker 门禁 |
| `tests/integration/lookback-join.test.mjs` | subagent_start lookback + phase_runs + FIFO |
| `tests/integration/end-to-end-phase-coverage.test.mjs` | 完整 6 阶段：raw report 各 stage 实际工时非空（P0 守门） |
| `tests/integration/tech-stack.test.mjs` | 5 级优先级链解析 |
| `tests/integration/progress-state-machine.test.mjs` | progress.mjs / resume.mjs |
| `tests/integration/concurrent-events.test.mjs` | 100 并发 appendEvent 不丢/不交错 |
| `tests/integration/session-start-context.test.mjs` | additionalContext 注入 |
| `tests/integration/marketplaces-path.test.mjs` | v2.1+ 安装路径解析 |
| `tests/integration/m6-watermark-emit-relay.test.mjs` | aggregate watermark + emit-phase + relay prompt |
| `tests/integration/m62-decision-gate.test.mjs` | decision-gate skill + emit-decision + 10 commands 决策门 + preview |
| `tests/integration/m63-tech-stack.test.mjs` | tech-stack-options.yaml + AskUserQuestion 4 步问卷 + tech-stack hard gate |
| `tests/integration/m64-build-phase.test.mjs` | 6-phase 结构 / 4 个新 skill / impl 串行 / agents 数量 |
| **合计** | **122 / 122 passing** |

---

## 相关文档

- [USAGE.md](./USAGE.md) — 场景化使用示例
- [CHANGELOG.md](./CHANGELOG.md) — 版本变更记录
- 设计原则：契约先行 + 数字员工分工 + 自动度量 + 决策门 + 6-phase 范式（EXPLORE/PLAN/APPROVE/IMPLEMENT/VERIFY/SUMMARY）
- 数据来源：Spring Initializr 22 分组 200+ 组件清单 + Claude Code AskUserQuestion 工具 schema

---

## 反馈与贡献

- 问题反馈：[GitHub Issues](https://github.com/dhslegen/digital-delivery-team/issues)
- 功能建议：欢迎提 PR 或在 Issues 讨论
- 安全问题：请直接邮件 dhslegle@gmail.com（不要在 Issues 公开）

---

> **版本**：v0.7.0 · **许可**：[MIT](./LICENSE) · **作者**：[@dhslegen](https://github.com/dhslegen)
