# digital-delivery-team

> 一人一队 · 全栈工程师的 AI 数字员工交付插件

为 Claude Code 提供契约先行（Contract-First）+ 数字员工分工（Agent-Owned）+ 自动度量（Hooks-Driven）的端到端交付工作流。**一句话**：从产品需求到上线交付，由 10 个数字员工接力完成，每个阶段自动度量，每条产物可追溯。

10 数字员工 · 17 命令 · 5 技能 · 8 类 Hook · 5 套技术栈预设 · 4 套 AI-native UI 通道 · 进度状态机 · 跨会话恢复 · Node 22+ 零 npm 依赖

[![Tests](https://img.shields.io/badge/tests-80%2F80%20passing-brightgreen)](#testing) [![Version](https://img.shields.io/badge/version-0.5.0-blue)](./CHANGELOG.md) [![License](https://img.shields.io/badge/license-MIT-blue)](./LICENSE)

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

应见 11 项全部 ✅。任一未通过按提示处理（最常见：升级 Node 到 22+ 或重启会话让 SessionStart hook 写入 plugin-root marker）。

---

## 5 分钟上手

```bash
cd your-project/
echo "我要做一个任务清单 Web App，支持看板视图和标签管理" > project-brief.md
```

回到 Claude Code 会话内：

```text
/kickoff --preset java-modern    # 默认即 java-modern，可省略
/impl
/verify
/ship
```

完成后产出全部位于项目目录：

```text
docs/prd.md  docs/wbs.md  docs/risks.md
docs/arch.md  docs/api-contract.yaml  docs/data-model.md
web/...  server/...  tests/test-report.md
docs/review-report.md  docs/efficiency-report.md
README.md  docs/deploy.md  docs/demo-script.md
delivery-<project-id>-<timestamp>.tar.gz   ← 一键交付包
```

> 中途可随时运行 `/resume` 查看进度，或 `/fix --severity blocker` 修复评审阻塞项。

---

## 命令矩阵

### 岗位命令（按角色）

| 岗位 | 命令 | 主要产物 | 子代理 |
|------|------|---------|--------|
| 产品 | `/prd` | `docs/prd.md`（含 Given/When/Then 验收标准） | product-agent |
| PM | `/wbs` | `docs/wbs.md` + `docs/risks.md` | pm-agent |
| 架构 | `/design` | `docs/arch.md` + `docs/api-contract.yaml` + `docs/data-model.md` | architect-agent |
| 前端 | `/build-web` | `web/`（含 happy-path 测试） | frontend-agent |
| 后端 | `/build-api` | `server/`（含集成测试 + migration） | backend-agent |
| 测试 | `/test` | `tests/test-report.md`（覆盖率 ≥ 70%） | test-agent |
| 评审 | `/review` | `docs/review-report.md`（阻塞/警告/建议三级） | review-agent |
| 修复 | `/fix` | review-report 条目逐条 patch（默认 dry-run） | fix-agent |
| 文档 | `/package` | `README.md` + `docs/deploy.md` + `docs/demo-script.md` | docs-agent |
| 度量 | `/report` | `docs/efficiency-report.md`（含洞察 + 优化建议） | metrics-agent |

### 编排命令（一键组合）

| 命令 | 等价于 | 适用场景 |
|------|--------|---------|
| `/kickoff [--preset <name>] [--ai-design <type>]` | `/prd` → `/wbs` → `/design` | 新项目起手 |
| `/impl [--web-only\|--api-only]` | `/build-web` ‖ `/build-api`（同消息内并行派发） | 设计冻结后并行实现 |
| `/verify` | `/test` ‖ `/review`（并行） | 实现完成后并行验收 |
| `/ship` | `/package` → `/report` + 打包 tar.gz | 交付出包 |

### 辅助命令

| 命令 | 用途 |
|------|------|
| `/fix [--severity blocker\|warning\|all] [--apply]` | 按 review-report 修复，默认 dry-run，阻塞级强制人工 review |
| `/import-design --from figma\|v0\|lovable\|claude-design --url <url>` | 从外部 AI 设计源生成符合契约的 React + Tailwind 组件 |
| `/resume` | 显示当前进度 + 下一步建议（跨会话恢复） |
| `/digital-delivery-team:doctor` | 11 项安装自检 |

---

## 技术栈预设

5 套主流栈，**默认 `java-modern`**。在 `project-brief.md` 中写 `**技术栈预设**: <name>`，或 CLI `/kickoff --preset <name>`：

| 预设 | 后端 | 前端 | 默认 AI 设计 |
|------|------|------|------------|
| `java-modern` ⭐ | Spring Boot 3.2 + MySQL 8 + Redis 7 + Maven + MyBatis-Plus | React 18 + Vite + Tailwind + shadcn-ui | claude-design |
| `java-traditional` | Spring Boot 2.7 + MySQL 5.7 + Maven + MyBatis | Vue 3 + Element Plus | claude-design |
| `node-modern` | Nest.js 10 + Postgres + Prisma | Next.js 14 (App Router) + Tailwind + shadcn-ui | v0 |
| `go-modern` | Gin + Postgres + GORM | React 18 + Tailwind + shadcn-ui | claude-design |
| `python-fastapi` | FastAPI + Postgres + SQLAlchemy + Alembic | React 18 + Tailwind + shadcn-ui | lovable |

**优先级链**（从高到低）：CLI flag → `project-brief.md`：技术栈预设字段 → 已存在的 `.ddt/tech-stack.json` → manifest 自动检测（`pom.xml`/`package.json`/`go.mod`/`pyproject.toml`）→ 默认 `java-modern`。

---

## AI-native UI 通道

`/import-design --from <type>` 把 4 种主流 AI 设计源转化为符合 `docs/api-contract.yaml` 的 React + Tailwind 组件：

| 通道 | 适用场景 | 工作流要点 |
|------|---------|----------|
| `claude-design` ⭐ | 默认零依赖 | Claude artifact / web-artifacts-builder 直接生成 React + Tailwind + shadcn |
| `figma` | 设计稿驱动 | Figma MCP `get_design_context` → 转 React + Tailwind |
| `v0` | Next.js 现代化 UI | 解析 v0 share URL → `npx shadcn add` → 接 OpenAPI client |
| `lovable` | UI 重的 ToC | Lovable 导出 → 移除 supabase 依赖 → 接 OpenAPI client |

详细工作流见 `skills/ai-native-design/SKILL.md`。

---

## 架构概览

```text
project-brief.md
    └─ /kickoff ────── product-agent   ──► docs/prd.md
                  ├─── pm-agent        ──► docs/wbs.md + docs/risks.md
                  └─── architect-agent ──► docs/arch.md + docs/api-contract.yaml + docs/data-model.md
                                            （契约 lint 通过才继续）
    └─ /impl ───────── frontend-agent  ──► web/        （并行）
                  └─── backend-agent   ──► server/     （并行）
    └─ /verify ─────── test-agent      ──► tests/test-report.md      （并行）
                  └─── review-agent    ──► docs/review-report.md     （并行）
    └─ /fix ────────── fix-agent       ──► 源码 patch + review-report.md 末尾 Fix Log
    └─ /ship ───────── docs-agent      ──► README.md + docs/deploy.md + docs/demo-script.md
                  └─── metrics-agent   ──► docs/efficiency-report.md
                                            + delivery-<id>-<ts>.tar.gz
```

### 插件目录

| 目录 | 内容 |
|------|------|
| `agents/` | 10 个数字员工子代理（含 fix-agent） |
| `commands/` | 17 个命令（10 岗位 + 4 编排 + 4 辅助 + 1 待用） |
| `skills/` | 5 个领域知识：api-contract-first / acceptance-criteria / efficiency-metrics / delivery-package / ai-native-design |
| `hooks/` | 8 类事件注册 + handlers + lib/ |
| `bin/` | 11 个脚本：aggregate / baseline / report / manifest / doctor / progress / resume / find-plugin-root / resolve-tech-stack / check-contract-alignment / check-blockers.sh |
| `templates/` | 12 个模板（PRD / WBS / 风险 / API 契约 / blockers / **tech-stack-presets.yaml** / ...） |
| `contexts/delivery.md` | 全局交付上下文（agent 必读） |
| `rules/delivery/` | 6 条 Global Invariants 权威定义 |
| `tests/` | 17 个测试文件（unit + integration，node --test） |
| `baseline/` | 历史项目基准数据 + 估算规则 |

---

## 度量与效率追踪

8 类自动 hook（零侵入，无需手动触发）：

| Hook 事件 | 触发时机 | 采集内容 |
|-----------|---------|---------|
| `SessionStart` | 会话开始 | session_id / Node 版本 / 持久化 plugin-root marker / 自动 bootstrap project_id / progress 推断 |
| `SessionEnd` | 会话结束 | token 消耗 + 释放本会话 advisory lock |
| `UserPromptSubmit` | 用户输入 | 抓 slash command 作 phase 标签 → 写 `phase_start` 事件 |
| `PreToolUse` | 工具调用前 | 工具名 / 文件路径 / Bash 头 / Task 时写 `subagent_start` + advisory lock |
| `PostToolUse` | 工具调用后 | 成功/失败 / 耗时 / 自动捕获 test-report.md 与 review-report.md 中的质量指标 |
| `PostToolUseFailure` | 工具调用失败 | 失败工具事件（与 PostToolUse 共享 handler，标 `success: false`） |
| `SubagentStop` | 子代理完成 | 通过 lookback join 反查 PreToolUse 记录的 `subagent_start`，重建真实 name + duration |
| `Stop` | 每个 turn 结束 | 关闭未闭合 phase + 后台触发 metrics 聚合 + progress.json infer |

数据链路：

```text
hooks → ~/.claude/delivery-metrics/<project-id>/events.jsonl
    └─→ bin/aggregate.mjs → metrics.db (sessions / tool_calls / subagent_runs / phase_runs / quality_metrics)
        └─→ bin/report.mjs → docs/efficiency-report.raw.md
            └─→ metrics-agent (自然语言解读 + 三问分析 + Top 3 优化建议)
                └─→ docs/efficiency-report.md
```

> Baseline 文件（`baseline/baseline.locked.json`）属于被交付项目目录，不属于插件源码目录；首次 `/report` 时根据 `historical-projects.csv` + `estimation-rules.md` 自动封盘，封盘后不可变。

---

## 进度状态机与跨会话恢复

每个 DDT 项目在 `.ddt/progress.json` 维护一份状态机：

```json
{
  "schema_version": 1,
  "project_id": "proj-...",
  "current_phase": "design",
  "last_activity_at": "2026-04-28T07:55:00Z",
  "phases": {
    "prd":         { "status": "completed",   "started_at": "...", "completed_at": "..." },
    "design":      { "status": "in_progress", "started_at": "...", "completed_at": null  },
    "build-web":   { "status": "pending",     ... }
  }
}
```

由 hook 全自动维护：

- **SessionStart**：根据 `docs/*` 文件存在性 infer 状态
- **UserPromptSubmit**：检测到岗位 phase 命令时标 `in_progress`
- **Stop**：每个 turn 结束 infer，artifact 出现则标 `completed`

中断后跨会话续作：`/resume` 输出阶段进度 + 下一步建议（含 stale 检测）。

---

## 退出码约定

| Code | 含义 | 来源 |
|------|------|------|
| 0 | 成功 | 所有命令 |
| 1 | 前置条件未满足（必读文件缺失 / `DDT_PLUGIN_ROOT` 未解析 / 参数错误） | 各命令 Phase 1 |
| 2 | 存在未解决 blocker（`docs/blockers.md` 中 `resolved_at: null`） | `bin/check-blockers.sh` |
| 3 | 契约对齐失败（`/import-design` 生成代码引入禁用模式） | `bin/check-contract-alignment.mjs` |
| 4 | OpenAPI lint 失败（schema 错误 / security 未声明等） | `/design`、`/impl`、`/kickoff` |
| 5 | OpenAPI lint 工具缺失（`npx` 不可用 / `@redocly/cli` 未装） | 同上 |

OpenAPI 契约 lint 是**硬门禁**：lint 不通过禁止推进到 `/build-web`、`/build-api` 或 `/ship`。

---

## 数据与隐私

- 所有度量数据落在本地 `~/.claude/delivery-metrics/`，**不上报任何外部服务**
- Bash 命令仅记录前 80 字符；工具事件仅记录度量必需字段
- 度量数据库（`metrics.db`）为本地 SQLite，可随时删除
- 清空数据：`rm -rf ~/.claude/delivery-metrics/`

---

## 环境要求

| 项 | 要求 |
|----|------|
| Node.js | **≥ 22.0.0**（使用内置 `node:sqlite`，零 npm 依赖） |
| Claude Code | v2.1+（hook 自动加载） |
| 操作系统 | macOS / Linux / Windows（建议 WSL2） |
| 可选工具 | `@redocly/cli`（OpenAPI lint，命令首次运行时 `npx` 自动拉取） |

### 可选环境变量

| 变量 | 默认 | 说明 |
|------|------|------|
| `DDT_METRICS_DIR` | `~/.claude/delivery-metrics/` | 度量数据目录 |
| `DDT_PROJECT_ID` | 自动从 `.ddt/project-id` 读取 | 当前项目 ID |
| `DDT_HOOK_PROFILE` | `standard` | Hook 档位：`minimal` / `standard` / `strict` |
| `DDT_DISABLED_HOOKS` | 空 | 禁用指定 hook id（CSV，例：`ddt:pre-tool-use`） |

> 度量脚本与 hook 开关都使用独立 `DDT_*` 命名空间，不读取 ECC 变量，也不依赖 MCP server 或远程上报。

---

## 故障排查

**优先做这一步**：

```text
/digital-delivery-team:doctor
```

11 项检查覆盖：Node 版本 / 插件 root / SessionStart marker / hooks.json 7 个事件注册 / events.jsonl 可写 / metrics.db 完整 / `@redocly/cli` 可用 / `check-blockers.sh` 权限 / M3-M4 脚本完整 / 技术栈预设与 ai-native-design skill / progress.json 写入路径。

**常见问题**：

| 现象 | 处理 |
|------|------|
| `Node ≥ 22 ❌` | `nvm install 22 && nvm use 22` |
| `SessionStart marker ❌` | 重启 Claude Code 会话（marker 由 SessionStart hook 自动写入） |
| `@redocly/cli ❌` | 确认网络可达；首次执行命令时 `npx --yes @redocly/cli` 会自动安装 |
| `progress.json 状态错误` | 手动校正：`node "$DDT_PLUGIN_ROOT/bin/progress.mjs" --update <phase> <status>` |
| 跨会话忘记进度 | `/resume` |

---

## Testing

```bash
cd plugins/digital-delivery-team
npm test                  # 全量（80 个测试）
npm run test:unit         # 仅 unit
npm run test:integration  # 仅 integration
```

| 测试套 | 数量 | 覆盖 |
|-------|------|------|
| `tests/unit/frontmatter.test.mjs` | 4 | agents/skills/commands frontmatter 必填；agent 必读 invariants |
| `tests/unit/hooks-registration.test.mjs` | 5 | hooks.json 合法性 + entry id 唯一 + handler 文件存在 |
| `tests/unit/plugin-manifest.test.mjs` | 1 | manifest --check 通过 |
| `tests/unit/v3-semantics.test.mjs` | 6 | metrics-integrity / contract-integrity / refresh 增量语义 |
| `tests/unit/phase-detection.test.mjs` | 8 | UserPromptSubmit slash command 识别 |
| `tests/unit/commands-slim.test.mjs` | 6 | 防 commands 退化回 80 行 inline |
| `tests/unit/find-plugin-root.test.mjs` | 4 | plugin-root 5 级解析链 |
| `tests/unit/m3-agents.test.mjs` | 9 | 三 agent 必读 tech-stack.json + ai-native-design skill |
| `tests/unit/advisory-lock.test.mjs` | 7 | 白名单 / 冲突 warn / stale / SessionEnd 释放 |
| `tests/integration/metric-chain.test.mjs` | 1 | aggregate → baseline → report 全链路 |
| `tests/integration/blocker-gate.test.mjs` | 3 | blocker 门禁 |
| `tests/integration/lookback-join.test.mjs` | 3 | subagent_start lookback join + phase_runs + FIFO |
| `tests/integration/end-to-end-phase-coverage.test.mjs` | 1 | 完整 6 阶段链路：raw report 各 stage 实际工时非空（P0 守门测试） |
| `tests/integration/tech-stack.test.mjs` | 9 | 5 级优先级链解析 |
| `tests/integration/progress-state-machine.test.mjs` | 6 | progress.mjs / resume.mjs 状态机 |
| `tests/integration/concurrent-events.test.mjs` | 4 | 100 并发 appendEvent 不丢/不交错（O_APPEND + advisory lock） |
| `tests/integration/session-start-context.test.mjs` | 4 | additionalContext 注入合法 JSON |
| **合计** | **80** | **100% pass** |

---

## 相关文档

- [USAGE.md](./USAGE.md) — 场景化使用示例
- [CHANGELOG.md](./CHANGELOG.md) — 版本变更记录
- 设计原则：契约先行（Contract-First）+ 数字员工分工（Single-Producer）+ 自动度量（Hooks-Driven）

---

## 反馈与贡献

- 问题反馈：[GitHub Issues](https://github.com/dhslegen/digital-delivery-team/issues)
- 功能建议：欢迎提 PR 或在 Issues 讨论
- 安全问题：请直接邮件 dhslegle@gmail.com（不要在 Issues 公开）

---

> **版本**：v0.5.0 · **许可**：[MIT](./LICENSE) · **作者**：[@dhslegen](https://github.com/dhslegen)
