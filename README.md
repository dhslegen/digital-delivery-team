# digital-delivery-team

一人一队：全栈工程师 + 数字员工交付插件化方案。

10 个数字员工子代理 · 16 个岗位/编排/辅助命令 · 5 个领域知识 skill · 7 类自动度量 hook · 5 套技术栈预设 · 4 套 AI-native UI 通道 · 进度状态机与跨会话恢复 · Node 22+ 零 npm 依赖

> v0.5.0 修复了 v0.4.x 的 P0 数据采集断链（efficiency-report 实际工时全空）；与 ECC 体验对齐（commands 内嵌 inline node-e 清零）；新增技术栈预设、AI-native UI、进度状态机。详见 [CHANGELOG.md](./CHANGELOG.md)。

---

## 5 分钟上手

1. **安装插件**

   ```bash
   # 将插件目录加入 Claude Code 插件路径
   git clone <repo> ~/plugins/digital-delivery-team
   # 在 ~/.claude/settings.json 中添加插件路径
   ```

2. **初始化项目**

   ```bash
   cd your-project/
   echo "我要做一个任务清单 Web App，支持看板视图和标签管理" > project-brief.md
   ```

3. **一键启动完整流程**

   ```
   /kickoff      → 产出 PRD + WBS + 架构契约（串行，约 3 步）
   /impl         → 前后端并行实现（并行，1 步双产物）
   /verify       → 测试 + 评审（并行，1 步双产物）
   /ship         → 交付包 + 效率报告（串行，约 2 步）
   ```

4. **查看效率报告**

   ```bash
   export DDT_PLUGIN_ROOT="${DDT_PLUGIN_ROOT:-$CLAUDE_PLUGIN_ROOT}"
   node "$DDT_PLUGIN_ROOT/bin/report.mjs" \
     --project "$(cat .delivery/project-id)" \
     --baseline baseline/baseline.locked.json
   # 产出 docs/efficiency-report.raw.md
   ```

---

## 岗位速查

| 岗位 | 命令 | 主要产物 | 调用的子代理 |
|------|------|---------|------------|
| 产品 | `/prd` | `docs/prd.md` | product-agent |
| PM | `/wbs` | `docs/wbs.md` | pm-agent |
| 架构 | `/design` | `docs/arch.md` + `docs/api-contract.yaml` + `docs/data-model.md` | architect-agent |
| 前端 | `/build-web` | `web/`（含测试） | frontend-agent |
| 后端 | `/build-api` | `server/`（含集成测试） | backend-agent |
| 测试 | `/test` | `tests/test-report.md`（含覆盖率）| test-agent |
| 评审 | `/review` | `docs/review-report.md`（三级分类） | review-agent |
| 交付 | `/package` | `README + deploy.md + demo-script.md` | docs-agent |
| 度量 | `/report` | `docs/efficiency-report.raw.md` | metrics-agent |

**编排命令（一键组合）**：

| 命令 | 等价于 | 适用场景 |
|------|--------|---------|
| `/kickoff` | `/prd` → `/wbs` → `/design` | 新项目起手 |
| `/impl` | `/build-web` ‖ `/build-api` | 有设计文档后并行开发 |
| `/verify` | `/test` ‖ `/review` | 开发完成后并行验收 |
| `/ship` | `/package` → `/report` | 准备交付 |

**辅助命令**（v0.5.0 新增）：

| 命令 | 用途 |
|------|------|
| `/fix [--severity blocker\|warning\|all] [--apply]` | 按 review-report 条目修复（默认 dry-run） |
| `/import-design --from figma\|v0\|lovable\|claude-design --url <url>` | 从外部 AI 设计源生成符合契约的 UI |
| `/resume` | 显示当前进度与下一步建议（跨会话恢复） |
| `/digital-delivery-team:doctor` | 11 项安装自检 |

---

## 技术栈预设（v0.5.0 新增）

5 套主流栈，默认 `java-modern`。在 `project-brief.md` 中通过 `**技术栈预设**: <name>` 切换，或 CLI `/kickoff --preset <name>`：

| 预设 | 后端 | 前端 | 默认 AI 设计 |
|------|------|------|------------|
| `java-modern` | Spring Boot 3.2 + MySQL 8 + Redis 7 + Maven | React 18 + Vite + Tailwind + shadcn-ui | claude-design |
| `java-traditional` | Spring Boot 2.7 + MySQL 5.7 + Maven | Vue 3 + Element Plus | claude-design |
| `node-modern` | Nest.js 10 + Postgres + Prisma | Next.js 14 (App Router) + Tailwind + shadcn-ui | v0 |
| `go-modern` | Gin + Postgres + GORM | React 18 + Tailwind + shadcn-ui | claude-design |
| `python-fastapi` | FastAPI + Postgres + SQLAlchemy + Alembic | React 18 + Tailwind + shadcn-ui | lovable |

技术栈优先级（从高到低）：CLI flag > project-brief > 已有 `.delivery/tech-stack.json` > manifest 自动检测 > 默认。

## AI-native UI 通道（v0.5.0 新增）

`/import-design --from <type>` 支持 4 套通道，由 `skills/ai-native-design/SKILL.md` 详述工作流：

| 通道 | 适用场景 | 流程要点 |
|------|---------|---------|
| `claude-design` | 默认零依赖 | Claude artifact / web-artifacts-builder 直接生成 React + Tailwind + shadcn |
| `figma` | 设计稿驱动开发 | 通过 Figma MCP 拉 design context → 转 React+Tailwind |
| `v0` | Next.js 现代化 UI | 解析 v0 share URL → `npx shadcn add` → 接 OpenAPI client |
| `lovable` | UI 重的 ToC | 从 Lovable 导出/clone → 移除 supabase 替换为 OpenAPI client |

---

## 架构概览

```
project-brief.md
    └─ /kickoff ─── product-agent  ──► docs/prd.md
                ├── pm-agent       ──► docs/wbs.md
                └── architect-agent──► docs/arch.md
                                       docs/api-contract.yaml
                                       docs/data-model.md
    └─ /impl ────── frontend-agent ──► web/
              └─── backend-agent   ──► server/
    └─ /verify ─── test-agent      ──► tests/
               └── review-agent    ──► docs/review-report.md
    └─ /ship ────── docs-agent     ──► README.md + docs/deploy.md + docs/demo-script.md
               └── metrics-agent   ──► docs/efficiency-report.raw.md
```

**插件目录说明（Landscape）**

| 目录 | 说明 |
|------|------|
| `agents/` | 9 个数字员工子代理定义 |
| `commands/` | 13 个岗位/编排命令 |
| `skills/` | 4 个领域知识 skill |
| `hooks/` | 5 个自动度量 hook + handlers |
| `contexts/delivery.md` | 交付上下文：项目目标、当前阶段、质量门槛（v0.4.0 新增） |
| `rules/delivery/` | agent 全局不变量、合同完整性规则、度量完整性规则（v0.4.0 新增） |
| `bin/` | 度量聚合/基线/报告脚本 + manifest 工具 |
| `tests/` | 最小回归测试套件（unit + integration，node --test）（v0.4.0 新增） |
| `_templates/` | agent 基础模板 |
| `templates/` | 交付物模板（WBS、风险、blockers 等） |
| `baseline/` | 历史项目基准数据 |

---

## 度量与效率追踪

插件通过 5 个 hook 自动采集交付事件（零侵入，无需手动触发）：

| Hook | 触发时机 | 采集内容 |
|------|---------|---------|
| `session-start` | 会话开始 | session_id、时间戳 |
| `session-end` | 会话结束 | token 消耗（input/output）|
| `pre-tool-use` | 工具调用前 | 工具名、文件路径 |
| `post-tool-use` | 工具调用后 | 成功/失败 |
| `subagent-stop` | 子代理完成 | 运行时长、token 消耗 |

`PostToolUseFailure` 复用 `post-tool-use` handler，失败工具调用会以 `success: false` 写入同一条度量链路。

Hook 入口遵循 Claude Code v2.1+ 插件约定：`hooks/hooks.json` 自动加载；不要在 `.claude-plugin/plugin.json` 中显式声明 hooks，也不要维护 `.claude/hooks.json` 作为主入口。

**查看报告**：直接 `/report` 命令即可，commands 内部已自动调用 aggregate + report。也可手动：

```bash
: "${DDT_PLUGIN_ROOT:=$(cat "${HOME}/.claude/delivery-metrics/.ddt-plugin-root" 2>/dev/null)}"
node "$DDT_PLUGIN_ROOT/bin/report.mjs" --project "$DDT_PROJECT_ID" \
  --baseline baseline/baseline.locked.json --out docs/efficiency-report.raw.md
```

> v0.5.0：`captureQualityIfNeeded` 已由 PostToolUse hook 自动捕获，commands 不再需要 `--capture-quality` 兜底。

Baseline 文件属于被交付项目目录，不属于插件源码目录。`report.mjs` 默认要求 `baseline/baseline.locked.json` 存在；缺失时会失败，除非显式传 `--allow-missing-baseline` 输出不可证明报告。

---

## 退出码约定

| Code | 含义 | 来源 |
|------|------|------|
| 0 | 成功 | 所有命令 |
| 1 | 前置条件未满足（必读文件缺失、DDT_PLUGIN_ROOT 未解析、参数错误等） | 大多数命令 Phase 1 |
| 2 | 存在未解决 blocker（`docs/blockers.md` 中 `resolved_at: null`） | `bin/check-blockers.sh` |
| 3 | 契约对齐失败（`/import-design` 生成代码引入禁用模式如 lovable supabase） | `bin/check-contract-alignment.mjs` |
| 4 | OpenAPI lint 失败（schema 错误、security 未声明等） | `/design`、`/impl`、`/kickoff` |
| 5 | OpenAPI lint 工具缺失（npx 不可用 / @redocly/cli 未装） | `/design`、`/impl`、`/kickoff` |

OpenAPI 契约 lint 是硬门禁：`/design`、`/build-web`、`/build-api` 和 `/kickoff` 中 lint 失败返回 4，lint 工具缺失返回 5。

---

## 数据与隐私

- 所有度量数据落在本地 `~/.claude/delivery-metrics/`，**不上报任何外部服务**
- Bash 命令仅记录前 80 个字符，工具事件仅记录度量所需字段
- 度量数据库（`metrics.db`）为本地 SQLite 文件，可随时删除
- 清空数据：`rm ~/.claude/delivery-metrics/events.jsonl ~/.claude/delivery-metrics/metrics.db`

---

## 环境要求

| 项目 | 要求 |
|------|------|
| Node.js | ≥ 22.0.0（使用内置 `node:sqlite`，零 npm 依赖） |
| Claude Code | 最新版 |
| 操作系统 | macOS / Linux / Windows（WSL2）|

**可选环境变量**：

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `DDT_METRICS_DIR` | `~/.claude/delivery-metrics/` | 度量数据目录 |
| `DDT_PROJECT_ID` | `.delivery/project-id` | 当前项目 ID |
| `DDT_HOOK_PROFILE` | `standard` | Hook 档位：`minimal` / `standard` / `strict` |
| `DDT_DISABLED_HOOKS` | 空 | 禁用指定 DDT hook id，例如 `ddt:pre-tool-use` |

度量脚本与 hook 开关都使用独立 `DDT_*` 命名空间，不读取 ECC 变量，也不依赖 MCP server 或远程上报。

---

## Testing

需要 Node.js 22+（内置 `node:test` 与 `node:sqlite`）。

```bash
cd plugins/digital-delivery-team

npm test                 # 全量（unit + integration）
npm run test:unit        # 仅单元测试
npm run test:integration # 仅集成测试
```

| 测试文件 | 覆盖内容 |
|----------|---------|
| `tests/unit/frontmatter.test.mjs` | agents/skills/commands frontmatter 必填字段；agents 引用 `rules/delivery/agent-invariants.md` |
| `tests/unit/hooks-registration.test.mjs` | hooks.json 可解析；entry id 唯一；command ≤ 256 字符；handler 文件存在 |
| `tests/unit/plugin-manifest.test.mjs` | `bin/manifest.mjs --check` 退出码为 0；plugin.json 不声明 agents/hooks |
| `tests/integration/metric-chain.test.mjs` | aggregate → baseline → report 全链路；断言 metrics.db、baseline.locked.json 字段、报告三个章节标题 |
| `tests/integration/blocker-gate.test.mjs` | /wbs Phase 1 门禁：未解决 blocker → exit 2；全部解决 → exit 0 |

---

## 相关文档

- [USAGE.md](./USAGE.md) — 场景化使用示例
- [CHANGELOG.md](./CHANGELOG.md) — 版本变更记录
- 设计文档：`design/岗位技能提效与数字员工团队方案_v3.md`

---

> **版本**：0.5.0 · **许可**：MIT（见 marketplace.json）

## 故障排查

跑 `/digital-delivery-team:doctor` 一次完成 11 项自检：Node 版本 / 插件 root / SessionStart marker / hooks.json 7 个事件注册 / events.jsonl 可写 / metrics.db 完整 / @redocly/cli / check-blockers.sh 权限 / M3-M4 脚本齐全 / 技术栈预设与 ai-native-design skill / progress.json 写入路径。

跨会话恢复中断的项目：`/resume`。
