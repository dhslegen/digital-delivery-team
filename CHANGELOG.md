# Changelog · digital-delivery-team

所有显著变更按 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/) 格式记录，版本遵循 [Semantic Versioning](https://semver.org/)。

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
