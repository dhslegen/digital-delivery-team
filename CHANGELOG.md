# Changelog · digital-delivery-team

所有显著变更按 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/) 格式记录，版本遵循 [Semantic Versioning](https://semver.org/)。

---

## [0.5.1] - 2026-04-28

修复 v0.5.0 在 Claude Code v2.1+ 真实安装路径下 SessionStart hook 解析失败的问题。

### Fixed — 修复

- 🔴 P0：hook 解析路径列表只覆盖 `plugins/marketplace/`（**单数**）和 `plugins/cache/`，但 Claude Code v2.1+ 实际安装到 `plugins/marketplaces/`（**复数**），导致 SessionStart hook 找不到插件根目录 → marker 文件未写入 → commands 全部 fallback 失败 → `/digital-delivery-team:doctor` 报 `❌ DDT plugin root 未解析`
- 🔴 P0：用户 shell 中残留无效 `DDT_PLUGIN_ROOT` 环境变量时，`SessionStart::persistPluginRoot` 会把这个无效路径写到 marker，反向污染 `~/.claude/delivery-metrics/.ddt-plugin-root`
- 🟠 commands 的 `${VAR:=fallback}` 仅在 unset/empty 时赋值，无法自动 fallback 用户 shell 残留的无效 env 变量

### Changed — 改动

- `hooks/hooks.json`（6 处 inline）：路径列表新增 `['marketplaces','digital-delivery-team']`；新增 `marketplaces/` 通配扫描；解析失败时返回 `null` 而非 `path.resolve('.')`，避免污染 `process.env`
- `hooks/plugin-hook-bootstrap.js`：candidates 数组同步加 marketplaces 路径 + Priority 3 通配扫描
- `hooks/handlers/session-start.js::persistPluginRoot`：写 marker 前验证 `bin/aggregate.mjs` 存在
- 9 个 commands（wbs/prd/design/package/report/fix/doctor/import-design/resume）：fallback 行从 `${VAR:=...}` 改为显式 `[ -f "$ROOT/bin/aggregate.mjs" ] || ROOT=...` 三级链（env → marker → 硬编码 `~/.claude/plugins/marketplaces/digital-delivery-team` 兜底）
- `bin/find-plugin-root.mjs::tryStandardPaths`：加 marketplaces 路径；新增 `tryMarketplacesDir()` 通配扫描

### Added — 新增

- `tests/integration/marketplaces-path.test.mjs`（7 用例）：构造伪 `~/.claude` 目录验证 4 种路径布局解析正确

### Migration — 升级指引

如果你从 v0.5.0 升级到 v0.5.1：

1. 运行 `/plugin marketplace update digital-delivery-team` + `/reload-plugins`
2. 检查并清理 shell rc 文件中的旧 `DDT_PLUGIN_ROOT` 设置：`grep DDT_PLUGIN_ROOT ~/.zshrc ~/.bashrc ~/.bash_profile`
3. 删除可能被污染的 marker：`rm ~/.claude/delivery-metrics/.ddt-plugin-root`
4. 重启 Claude Code 会话（让 SessionStart hook 重新写 marker）
5. `/digital-delivery-team:doctor` 应见 11/11 通过

---

## [0.5.0] - 2026-04-28

完整修复 v0.4.x e2e 测试中发现的 P0 数据采集断链 + ECC 体验对齐 + 技术栈灵活性 + 可重入状态机。

### Added — 新增

**核心数据链路（M1）**
- `hooks/handlers/user-prompt-submit.js` — 抓 slash command 作 phase 标签
- `hooks/handlers/stop.js` — 关闭未闭合 phase + 后台触发 metrics 聚合
- `bin/lib/schema.sql::phase_runs` 表 — 精确阶段工时
- `subagent_runs` 占位行机制 — `subagent_start`/`subagent_stop` lookback join 计算真实 duration

**用户体验对齐 ECC（M2）**
- `bin/find-plugin-root.mjs` / `bin/check-blockers.sh` / `bin/doctor.mjs` + `commands/doctor.md`（11 项安装自检）
- `agents/fix-agent.md` + `commands/fix.md` — 评审 → 修复闭环（dry-run 默认）
- SessionStart 自动 bootstrap project_id + 持久化 `~/.claude/delivery-metrics/.ddt-plugin-root` marker

**技术栈灵活性（M3）**
- `templates/tech-stack-presets.yaml` — 5 套主流栈（默认 java-modern）+ 4 套 AI-native UI 通道（claude-design / figma / v0 / lovable）
- `bin/resolve-tech-stack.mjs` — 5 级优先级链（CLI > brief > existing > manifest > default）
- `bin/check-contract-alignment.mjs` — UI 代码契约对齐轻量检查
- `skills/ai-native-design/SKILL.md` — 4 通道 AI 设计稿工作流
- `commands/import-design.md` — `/import-design --from figma|v0|lovable|claude-design`
- `--preset` / `--ai-design` CLI 参数支持（kickoff / design）

**可重入与跨会话恢复（M4）**
- `bin/progress.mjs` — `.delivery/progress.json` 状态机（10 phase，5 子命令）
- `bin/resume.mjs` + `commands/resume.md` — `/resume` 跨会话恢复
- `hooks/handlers/lib/advisory-lock.js` — `.delivery/locks/` advisory lock（warn-only）

**测试覆盖**
- 39 个新测试（10 unit + 16 integration），含 P0 端到端断言"6 个 stage 实际工时全非空"

### Changed — 改动

- `hooks/handlers/pre-tool-use.js` — Task/Agent 触发时写 subagent_start + advisory lock 触发
- `hooks/handlers/subagent-stop.js` — payload 缺字段时反查 events.jsonl
- `hooks/handlers/post-tool-use.js` — 路径鲁棒性（realpath + endsWith）
- `hooks/handlers/session-start.js` — Node 22 检查 + plugin root marker + auto bootstrap + progress infer
- `hooks/handlers/session-end.js` — 释放本会话 advisory lock
- `bin/lib/store.mjs` — FIFO 关联（`MIN(id)`）+ `INSERT OR REPLACE`
- `bin/report.mjs` — phase 维度优先 → subagent fallback；新增"阶段与编排原始工时"段
- `agents/architect-agent.md` / `frontend-agent.md` / `backend-agent.md` — 必读 `tech-stack.json` + Hard Requirement 6 技术栈刚性约束
- `agents/metrics-agent.md` — Hard Requirement 6 工时不可证明刚性约束
- `commands/prd.md` / `wbs.md` / `design.md` / `package.md` / `report.md` — 移除 80 行 inline node-e
- `commands/verify.md` — 阻塞级评审项时建议 `/fix --severity blocker --apply`
- `templates/project-brief.template.md` — 新增 "技术栈预设" + "AI-native UI" 字段

### Fixed — 修复

- 🔴 P0: efficiency-report.raw.md 阶段对比表 6 个 stage 全部为 `—`
  - 根因：SubagentStop hook payload 不携带 `subagent_name` / `duration_ms`
  - 修复：`subagent_start` lookback join + UserPromptSubmit/Stop 维护 `phase_runs`
- 🟠 并行 tool_calls UPDATE 错配（`MAX(id)` 在 `/impl` 双 Task 错配）→ FIFO `MIN(id)`
- 🟠 quality_metrics 同毫秒事件被 INSERT OR IGNORE 静默丢弃 → INSERT OR REPLACE
- 🟠 commands 内嵌 80 行 inline node-e（每次需用户批准 Bash）→ marker fallback 1 行
- 🟡 metrics-agent 工时缺失时仍输出"约 -51%"伪结论 → Hard Requirement 6 严格禁止
- 🟡 `captureQualityIfNeeded` 路径过严漏采 → realpath 鲁棒匹配

### Removed — 移除

- `commands/report.md` 的 `aggregate.mjs --capture-quality` 兜底（PostToolUse 已自动捕获）

---

## [0.4.1] - 2026-04-27

### Fixed
- **Marketplace 兼容性 — cache 路径顺序 bug**：修复 `hooks/hooks.json`（6处）、`commands/prd.md`、`commands/wbs.md`、`commands/report.md` 中内联自定位脚本的 marketplace 缓存路径。
  - 旧（错误）：`~/.claude/plugins/cache/digital-delivery-team/<publisher>/<version>/`
  - 新（正确）：`~/.claude/plugins/cache/<publisher>/digital-delivery-team/<version>/`
- **`hooks/plugin-hook-bootstrap.js` 自定位优先级**：将 `__dirname` 路径提升为 Priority 0（最高优先级），确保通过 `--plugin-dir` 或 marketplace 安装时无需任何环境变量即可正确定位插件根目录。
- **结论**：`hooks/hooks.json` 按约定自动加载（无需 plugin.json 声明），安装后零配置启用。

---

## [0.4.0] - 2026-04-25

### Added
- Skill `origin` field（T-R01）
- Component inventory via `bin/manifest.mjs`; plugin.json follows ECC convention and does not declare agents/hooks（T-R07）
- `quality_metrics` hook 捕获 coverage / blocker count（T-R04）
- `contexts/delivery.md` + `rules/delivery/{agent-invariants,contract-integrity,metrics-integrity}.md`（T-R05）
- `templates/blockers.template.md` + 命令层阻塞门禁（T-R03）
- 最小测试套件（`tests/`，`node --test` 驱动）（T-R06）

### Changed
- 抽取 hooks.json 启动样板到 `hooks/plugin-hook-bootstrap.js`，每条 entry 的 command ≤ 200 字符（T-R02）
- `_templates/agent-base.md` 简化，Global Invariants 权威版本迁至 `rules/delivery/`

### Internal
- 所有改动均在 `plugins/digital-delivery-team/` 内完成，继续保持 DDT 与 ECC 完全隔离

---

## [0.3.1] · Unreleased

### Changed

- Hooks 入口改为 Claude Code v2.1+ 标准 `hooks/hooks.json`，移除旧 `.claude/hooks.json` 主入口。
- Hook runtime 独立为 DDT 命名空间：`DDT_HOOK_PROFILE` / `DDT_DISABLED_HOOKS`，不读取 ECC 开关。
- 度量脚本读取 `DDT_METRICS_DIR` / `DDT_PROJECT_ID`，hook 开关只读取独立 `DDT_*` 命名空间。
- Hook handler 改为 CommonJS + `run(raw)` 风格，修复 `package.json` 中 `"type": "module"` 导致 handler 无法运行的问题。
- `post-tool-use` / `session-end` / `subagent-stop` 补齐输出、token、耗时字段，和 `aggregate.mjs` 的事件结构对齐。
- baseline 封盘改为项目目录语义，`baseline.mjs` 支持 `--hist` / `--expert` / `--out`，并按 v3 canonical stage 输出历史、专家、合并三组口径。
- `quality_metrics` 事件入库与 `--capture-quality` 路径补齐，raw report 会在质量缺失或劣化时首屏告警。
- OpenAPI lint 恢复硬门禁：契约 lint 失败返回 4，lint 工具缺失返回 5，不再作为 warning 放行。
- 架构主产物统一为 `docs/arch.md`，`/impl` 改为 fail-fast 校验并要求 `--web-only` / `--api-only` 显式裁剪范围。

---

## [0.3.0] · 2026-04-23

### 新增

**9 个数字员工子代理**
- `product-agent` — 需求分析 + PRD 生成，基于验收标准 skill
- `pm-agent` — WBS 拆解 + 风险清单
- `architect-agent` — 架构草案 + OpenAPI 契约 + 数据模型
- `frontend-agent` — 前端实现（React/Vue）+ happy-path 测试
- `backend-agent` — 后端实现（REST API）+ 集成测试
- `test-agent` — 从验收标准生成测试 + 覆盖率报告
- `review-agent` — 三级代码评审（阻塞/警告/建议）
- `docs-agent` — README + 部署指南 + 演示脚本
- `metrics-agent` — 效率报告自然语言解读

**13 个 slash 命令**
- 岗位命令：`/prd` `/wbs` `/design` `/build-web` `/build-api` `/test` `/review` `/package` `/report`
- 编排命令：`/kickoff`（串行 prd→wbs→design）、`/impl`（并行 frontend+backend）、`/verify`（并行 test+review）、`/ship`（串行 package→report）

**4 个领域知识 Skill**
- `api-contract-first` — API 优先设计规范
- `acceptance-criteria` — Given/When/Then 验收标准写法
- `delivery-package` — 交付包结构规范
- `efficiency-metrics` — 效率指标采集与解读方法

**5 个自动度量 Hook**
- `session-start` / `session-end` — 会话级 token 统计
- `pre-tool-use` / `post-tool-use` — 工具调用耗时追踪
- `subagent-stop` — 子代理运行时长与 token 消耗

**度量脚本（`bin/`）**
- `aggregate.mjs` — 将 events.jsonl 聚合写入 SQLite（Node 22+ 使用内置 node:sqlite，零 npm 依赖）
- `baseline.mjs` — 从历史 CSV + 专家规则生成锁定基线
- `report.mjs` — 产出阶段对比表 + 质量守门表 + 原始数据链接

**11 个项目模板（`templates/`）**
- project-brief / prd / wbs / risks / api-contract / data-model / review-checklist / test-plan / deploy / demo-script / efficiency-report

### 技术说明

- **运行时要求**：Node.js ≥ 22.0.0（使用内置 `node:sqlite`，零 npm 依赖）
- **度量数据目录**：`$DDT_METRICS_DIR`（默认 `~/.claude/delivery-metrics/`）
- **端到端验证**：Smoke Test（25 项 100% PASS）+ 真数据链路验证通过

---

## [0.1.0] · 2026-04-22

### 新增

- 插件目录骨架（`agents/` `commands/` `skills/` `templates/` `hooks/` `bin/` `baseline/`）
- `plugin.json` 元数据
- `_templates/agent-base.md` 内部基础模板
- `progress.json` 进度追踪机制（62 个任务 / 10 个阶段）

---

_本文件由 T-P03 自动生成_
