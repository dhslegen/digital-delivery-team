# digital-delivery-team

一人一队：全栈工程师 + 数字员工交付插件化方案。

9 个数字员工子代理 · 13 个岗位/编排命令 · 4 个领域知识 skill · 5 个自动度量 hook · Node 22+ 零 npm 依赖

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

**查看报告**：

```bash
export DDT_PLUGIN_ROOT="${DDT_PLUGIN_ROOT:-$CLAUDE_PLUGIN_ROOT}"
test -n "$DDT_PLUGIN_ROOT" || { echo "Set DDT_PLUGIN_ROOT to the installed plugin path"; exit 1; }
mkdir -p baseline
test -f baseline/historical-projects.csv || cp "$DDT_PLUGIN_ROOT/baseline/historical-projects.csv" baseline/historical-projects.csv
test -f baseline/estimation-rules.md || cp "$DDT_PLUGIN_ROOT/baseline/estimation-rules.md" baseline/estimation-rules.md
if [ ! -f baseline/baseline.locked.json ]; then
  node "$DDT_PLUGIN_ROOT/bin/baseline.mjs" --lock \
    --hist baseline/historical-projects.csv \
    --expert baseline/estimation-rules.md \
    --out baseline/baseline.locked.json
fi
node "$DDT_PLUGIN_ROOT/bin/aggregate.mjs" --project "$DDT_PROJECT_ID"
node "$DDT_PLUGIN_ROOT/bin/aggregate.mjs" --project "$DDT_PROJECT_ID" --capture-quality
node "$DDT_PLUGIN_ROOT/bin/report.mjs" \
  --project "$DDT_PROJECT_ID" \
  --baseline baseline/baseline.locked.json \
  --out docs/efficiency-report.raw.md
```

Baseline 文件属于被交付项目目录，不属于插件源码目录。`report.mjs` 默认要求 `baseline/baseline.locked.json` 存在；缺失时会失败，除非显式传 `--allow-missing-baseline` 输出不可证明报告。

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
- 设计文档：`fork-design/岗位技能提效与数字员工团队方案_v3.md`

---

> **版本**：0.4.0 · **许可**：Proprietary
