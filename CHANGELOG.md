# Changelog · digital-delivery-team

所有显著变更按 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/) 格式记录，版本遵循 [Semantic Versioning](https://semver.org/)。

---

## [0.8.0] - 2026-04-30 — 前端实现流程重构：Brief 编译器 + 3 通道分发器

把"前端 UI 实现"重新定位为：**"PRD / OpenAPI 契约 → 结构化设计 Brief"的编译器 + 3 通道分发器**。

新工作流：

```text
docs/prd.md + docs/api-contract.yaml + .ddt/tech-stack.json
   ↓ /design-brief
docs/design-brief.md（10 字段 SSoT）
   ↓ /design-execute --channel
.ddt/design/<channel>/upload-package/   （用户拖到外部工具 claude.ai/design / Figma / v0）
   ↓ /design-execute --channel <X> --bundle <path>  或  --url <share>
.ddt/design/<channel>/raw/   （staging）
   ↓ main thread 按 ai-native-design SKILL §7 改写
web/components/ + web/styles/tokens.css
   ↓ 10 维客观评分决策门
```

### 🔴 Breaking Changes — 不兼容变更

- **`/import-design` 命令直接删除**——不做 alias 链（密集开发期，无历史用户）
- **`lovable` AI 设计通道删除**——强 Supabase 集成与 DDT 后端契约冲突；`bin/resolve-tech-stack.mjs::AI_DESIGN_STRING_MAP` 不再识别 `lovable`，CLI flag / 字符串输入 exit 2；旧 `.ddt/tech-stack.json` 含 `ai_design.type=lovable` 需手动改 `claude-design` / `figma` / `v0`
- `templates/tech-stack-presets.yaml`：`python-fastapi` preset 默认 `ai_design` 从 `lovable` 改 `claude-design`
- `argument-hint` 调整：`/kickoff` 与 `/design` 的 `--ai-design` 选项 `claude-design|figma|v0|lovable` → `claude-design|figma|v0`
- v0.8 W3 起，`commands/*.md` 内调 `emit-phase --phase design-brief` / `--phase design-execute` 必须用 v0.8.0+ 的 `bin/emit-phase.mjs`（旧版会 exit 1）

### Added — 新增

🟣 **W1 — Brief 编译器**（`bin/compile-design-brief.mjs`）
- 从 PRD / OpenAPI / tech-stack / 用户参考图编译 10 字段 SSoT
- 复用 + 扫描已有 `web/components/` 写入 inventory
- 9 种 visual_direction（industrial / luxury / playful / ...）+ 11 条 anti-patterns

🟣 **W2 — 3 通道分发器**（`bin/derive-channel-package.mjs`）
- `--channel claude-design`：upload-package 7 文件 + prompt.md（中文）
- `--channel figma`：upload-package 7 文件 + prompt.md（TC-EBC 5 段）
- `--channel v0`：v0-sources/ + project-instructions.md（含 OpenAPI types）
- 11 anti-patterns 逐字注入 prompt（不省略）

🟣 **W3 — slash 命令**
- `/design-brief` — 编译 brief（W1）
- `/design-execute --channel <X>` — 派发通道附件包（W2）+ 摄取（W4）+ 决策门

🟣 **W4 — 3 通道摄取脚本**
- `bin/ingest-claude-design.mjs` — zip 解压 + 红线检测（fetch/axios/lovable supabase 残留）
- `bin/ingest-figma-context.mjs` — 写 MCP 引导清单（Figma MCP 只能在 Claude Code 会话内调）
- `bin/ingest-v0-share.mjs` — 包装 `npx shadcn add` 解析 v0 share URL

🟣 **W5 — `skills/ai-native-design/SKILL.md` 完整重写**
- 131 → 490 行，3 通道完整章节
- main thread 改写 7 步流程（红线 → tokens → 改写 → 状态 → 测试 → 评分 → commit）
- 11 anti-patterns 详细矩阵 + 9 visual_direction 决策树

🟣 **W6 — 增强工具**
- `agents/design-brief-agent.md` — 智能化补全 brief 字段（与 compile.mjs 分工：机器扫描 + 智能填充）
- `bin/render-tokens-preview.mjs` — design-tokens.json → 视觉化 HTML（246 行，含色卡 / 间距 / 字体 / shadow / motion）
- `bin/score-design-output.mjs` — 10 维客观评分（色彩 / 排版 / 间距 / 复用 / 响应式 / 暗色 / 动画 / a11y / 密度 / 打磨度，过门阈值 70）

🟣 **W7 — 端到端 + 边界测试**
- `tests/integration/v08-e2e-flow.test.mjs` — brief → derive → ingest → score 全链路
- `tests/integration/v08-edge-cases.test.mjs` — 13 用例边界
- 修 2 个 bug：threshold 0 fallback / v0 URL regex 含 shell 元字符

### Fixed — W7.5 12 个 P0 修复（4 个 audit agent 在 W7 review 一致发现）

🔴 **R1 度量链**（commit ddad4c6）
- `bin/emit-phase.mjs` / `bin/emit-decision.mjs` 的 `VALID_PHASES` 加 `design-brief` / `design-execute`；之前 W3-W7 5 周内度量事件**全部静默 exit 1**

🟠 **R2 v0.7 残留**（commit 9428891，11 文件）
- 清理 commands/build-web.md / kickoff.md / design.md / design-execute.md / hooks/handlers/session-start.js / skills/frontend-development/SKILL.md / templates/* / bin/resolve-tech-stack.mjs / USAGE.md / README.md 的 `/import-design` 与 `lovable` 死引用
- 加行级 `isAllowedLine` 白名单回归测试，未来引入再次回归会立刻被发现

🟠 **R3+R4+R8 模板真实性**（commit 506291c）
- R3: `compile-design-brief.mjs::renderInventory` 把 `scanComponents` 结果真写入 inventory 表格（之前永远是模板硬编码 5 行假数据）
- R4: `derive-channel-package.mjs::deriveV0` 加 `npx openapi-typescript` 生成 `openapi-types.ts`（之前 v0 模板里 import 它但从不生成）
- R8: `parseBriefMeta` 加 `isPlaceholder` / `cleanField` 过滤 `<persona>` / `<待填>` 占位符（之前会作为字面字符串塞进 prompt）

🔴 **R5+R6+R10 安全防御**（commit fa2a59d）
- R5: `parseFigmaUrl` 解码 node-id 后白名单 `[A-Za-z0-9:_-]`，拒绝 `?node-id=A%27%29%3B` 等注入向量
- R6: `render-tokens-preview` 加 `isValidCssValue` / `safeFont` 白名单 + spacing `Number()` 校验 + HTML head CSP meta（防 inline style CSS 注入逃逸）
- R10: `ingest-claude-design` 加 `listZipEntries` 解压前拒 `..` / 绝对路径 / null byte + `realpathSync` 解压后查 symlink 逃逸 + 5MB 文件大小阈值（防恶意 minified bundle OOM）

🟢 **R7+R9+R11 用户体验**（commit 7d3f42f）
- R7: `derive-channel-package.mjs` 加 `fillTemplate` 函数式替换，30 处 `.replace` 不再把用户输入的 `$10 起步` 当 backreference 吞为 `0 起步`
- R9: 新增 `bin/parse-cli-flag.mjs` 支持含空格路径 + 单/双引号；`design-execute.md::Phase 2` 改用，替代脆的 `grep [^ ]+ | awk`
- R11: `design-execute.md::Phase 4` 按 lockfile 检测包管理器（yarn → pnpm → npm）

🟢 **R12 评分准确度**（commit 7f8cfbc）
- R12.1: `score-design-output.mjs` 拆出 `parseInventoryComponents`——split by line + 状态机，跳过 markdown 表头分隔行 / placeholder 行
- R12.2: `scorePolish` 补齐 11 条 anti-patterns（之前只 5 条，与 `derive-channel-package.mjs::ANTI_PATTERNS_DETAILS` 对齐）

### 测试

- 总用例：158 → **304**（+146；其中 W1-W7 +83 / W7.5 +63）
- audit-smoke：8/8 持平
- 测试增量：W1 +13 → W2 +11 → W3 +8 → W4 +13 → W5 持平 → W6 +18 → W7 +20 → W7.5 6 Block +63

### 设计

- v0.8 完整方案：`design/前端实现流程重构方案_v0.8_final.md`（1244 行）
- W7 pre-release audit：`docs/static-review-20260429-050116.md`（4 个 audit agent 独立产物）
- 关键决策：claude-design 设为 first-class default（用户已订阅 Claude，零成本零网络外发）；摄取脚本只 staging 不直接改 web/（main thread 在 Claude Code 会话内按 SKILL 改写）

### 迁移指南（从 v0.7.x → v0.8.0）

```bash
# 1. 旧 .ddt/tech-stack.json 含 lovable 的项目
sed -i '' 's/"type": "lovable"/"type": "claude-design"/' .ddt/tech-stack.json

# 2. 旧 project-brief.md 含 "**AI-native UI**: lovable"
# 手动改为 claude-design / figma / v0 之一

# 3. 旧脚本 / 文档 / CI 中如有 /import-design 引用
# 改为：/design-brief && /design-execute --channel <X>
```

---

## [0.7.3] - 2026-04-30 — AI 执行 vs 用户审查时间拆分（PR-F）

v0.7.2 真实测试 v2 数据揭示一个反直觉真相：当前 metric 系统给出的"-95% / -97% 提效率"
**仅是端到端时间口径**，但 AI 单边执行（subagent_runs）的占比往往远低于此。

实测 v2 ddt-real-audit-v2 数据：

| Phase | 总工时(h) | AI 执行(h) | 用户审查 + 间隙(h) | AI 占比 |
|-------|----------|-----------|------------------|--------|
| design | 0.239 | 0.088 | 0.151 | 36.9% |
| kickoff | 0.627 | 0.138 | 0.489 | 22.0% |
| **prd** | **0.248** | **0.023** | **0.225** | **9.1%** |
| report | 0.074 | 0.026 | 0.048 | 34.8% |
| wbs | 0.072 | 0.027 | 0.044 | 38.2% |
| **合计** | **1.260** | **0.302** | **0.958** | **24.0%** |

整体仅 **24% 时间在跑 AI**，prd 阶段甚至只占 **9.1%**——这意味着真正的优化机会
在用户审查与决策门，不在 AI 模型/prompt。

### Added — 新增

🟠 **PR-F AI 执行 vs 用户审查时间拆分**
- `bin/lib/store.mjs::splitAiVsReviewByPhase(projectId)` 新增：
  - 按时间窗 overlap（`Math.min(se,pe) - Math.max(ss,ps)`）把每个 phase 的 subagent_runs 累加成 AI 执行时长
  - 鲁棒处理 subagent 跨 phase 边界、同 phase 多次执行
  - 输出：`{ phase: { totalH, aiH, userH, ratio }, ... }`
- `bin/report.mjs` 输出新增第 5 段"AI 执行 vs 用户审查时间拆分"：
  - 5 列表格：Phase / 总工时 / AI 执行 / 用户审查 + 间隙 / AI 占比
  - 含合计行 + 解读条款（< 30% / > 70% 两档建议）
- `agents/metrics-agent.md` Hard Requirement 第 9 条：
  - 必须在 final 报告 Q1/Q2 区分"AI 单边提效" vs "端到端提效"
  - AI 占比 < 30% 时必须在 Q3 优化建议中指出"瓶颈在用户/决策门"
- raw 报告章节顺序调整：原"## 5. 数据快照"重编号为"## 6. 数据快照"（PR-F 第 5 段插入）

### 测试

- `tests/integration/metric-chain.test.mjs` +2 用例：
  - PR-F: splitAiVsReviewByPhase 按时间窗 overlap 拆分（构造 600s phase + 60s subagent → 验证 10% 占比）
  - PR-F: report.mjs 输出 PR-F 段（端到端验证 5 列表格 + 50% 比率）
- 总用例：156 → **158**（+2）；audit-smoke 8/8

### 设计

参考：`design/真实测试Audit_v2.md`「🟠 P1-3 AI 执行 vs 用户审查」章节实测数据。

---

## [0.7.2] - 2026-04-30 — frontend.type 三态语义（PR-E）

v0.7.1 真实测试 v2 发现的新 P0：用户选 Spring Boot + Thymeleaf 后，
`.ddt/tech-stack.json::frontend` 仍残留 React 全家桶字段
（`bundler: vite`, `state: zustand`, `router: react-router`, `scaffold_cmd: npm create vite...`），
与服务端渲染语义直接矛盾。下游 `/build-web` 若死板执行会建出错的项目结构。

**根因**：preset 用 spread merge `{ ...preset.frontend, ...userComponents.frontend }`，
仅覆盖同名字段，preset 默认的 React 配套字段全部保留。

### Fixed — 修复

🔴 **P0-4 frontend.type 三态语义**
- 引入 `frontend.type` 三态：
  - `spa`：前后端分离 SPA（React/Vue/Angular/Svelte/Solid + bundler）→ 创建 web/ 工程
  - `server-side`：服务端渲染（Thymeleaf/JSP/FreeMarker/Jinja2/ERB/Razor/...）→ 模板内嵌 backend 项目
  - `none`：纯 API / CLI / 静态 HTML 直出 → 无前端工程
- `bin/resolve-tech-stack.mjs::FRONTEND_STRING_MAP` 重构：
  - 9 SPA 字符串（react-vite / vue-vite / svelte-kit / ...）映射为 `{type: "spa", framework, bundler}`
  - 9 server-side 字符串（thymeleaf/jsp/freemarker/velocity/razor/erb/jinja2/django-template/go-html）映射为 `{type: "server-side", template_engine}`
  - 4 none 字符串（none/html-css/cli/api-only）映射为 `{type: "none"}`
- 当用户选 server-side / none 时，**整段替换** `stack.frontend`，不与 preset spread merge，避免污染。
- `frontend.type === "none"` 时自动删除 `ai_design` 字段（无 UI = 无设计稿可言）。
- `commands/build-web.md` Phase 1 增加前置检查：`frontend.type !== "spa"` 时提前 noop 退出，
  emit-phase end 后 exit 0，明示"模板由 /build-api 在 backend 项目内处理"。
- 抽出 `bin/get-frontend-type.mjs` 独立辅助脚本（输出 frontend.type 到 stdout），
  保持 commands/build-web.md 不引入 inline `node -e` 违反 M2-9 瘦身契约。

### Tooling — 工具链

- `bin/get-frontend-type.mjs`（新增）：读 `.ddt/tech-stack.json::frontend.type`，
  fallback `spa`（向后兼容旧 tech-stack.json）。
- `skills/frontend-development/SKILL.md` Triggers 段：标注仅 `type === "spa"` 触发。
- `skills/backend-development/SKILL.md` Triggers 段：标注 `type === "server-side"` 时
  模板由 backend 承载，需额外覆盖。

### 测试

- `tests/integration/m63-tech-stack.test.mjs` +5 用例：
  - PR-E: thymeleaf → server-side（验证无 React 残留）
  - PR-E: none → type=none + ai_design 删除
  - PR-E: react-vite → type=spa + preset 完整保留
  - PR-E: 显式嵌套对象 `{type, template_engine}` 也被尊重
  - PR-E: build-web.md 含 frontend.type 提前退出逻辑
- 旧 PR-A "html-css → react=none" 用例更新为新语义（type=none 而非 framework=none）
- 总用例：151 → **156**（+5）；audit-smoke 8/8 不受影响

### Migration — 升级指引

从 v0.7.1 升级到 v0.7.2：

1. `/plugin marketplace update digital-delivery-team` + `/reload-plugins`
2. **已有项目重建 tech-stack.json（推荐）**：
   - 删除现有 `.ddt/tech-stack.json`
   - 跑 `/design --refresh`，重新走 AskUserQuestion 问卷
   - 选 server-side / none 类型时，新版 tech-stack.json 不再含 React 残留
3. 若坚持保留旧 tech-stack.json：缺失 `frontend.type` 字段会被 `get-frontend-type.mjs`
   fallback 为 `spa`，旧行为不变（向后兼容）。

### 设计

参考：`design/真实测试Audit_v2.md` "🔴 P0-4 frontend preset 残留污染"章节。

---

## [0.7.1] - 2026-04-29 — 真实测试驱动的 P0/P1/P2 修复批

基于 v0.7.0 真实跑通 `/kickoff + /report` 后发现的 5 个度量准确性问题，5 个 PR 合并发布：

### Fixed — 修复（按优先级）

🔴 **P0-1 修 `tech-stack.json` 字符串展开污染（PR-A）**
- 根因：LLM 在 AskUserQuestion 后写 `backend: "java-spring-boot"` 扁平字符串，
  resolve-tech-stack.mjs 的 spread 把字符串展开成 `{0:'j',1:'a',...}` 字符索引对象，
  preset 默认值被保留，用户偏好（无数据库 / 纯 HTML/CSS）静默丢失。
- 修法：三层防御
  1. `readComponentsJson` 入口 schema 校验 + 17/8/5 条扁平字符串映射表
  2. `assertCleanStack` 写入前最终关卡（拒绝纯数字索引 key）
  3. `commands/kickoff.md` Step 0 显式标注嵌套对象 schema + "严禁扁平字符串"
- 测试：m63-tech-stack +4 用例（扁平映射 / 拒绝未识别 / 嵌套兼容 / 数组拦截）

🔴 **P0-2 修 phase_runs 表行数膨胀 2.17×（PR-B）**
- 根因：emit-phase.mjs 每次新进程生成 `cli-${ts}` 不同 session_id，
  store.mjs phase_end UPDATE 严格 session_id 匹配失败 → fallback INSERT 孤儿行。
- 修法：bin/lib/store.mjs 三级匹配：严格 session → 降级 phase → fallback INSERT。
  飘移情况下 phase_runs 行数 = 实际执行次数。
- 测试：audit-smoke.mjs +1 用例（不设 DDT_SESSION_ID 仍 phase_runs=2 行）

🔴 **P0-3 修 hook + emit-phase 双源时间窗叠加（PR-B）**
- 根因：用户直接 `/report` 时 user-prompt-submit hook 抓 phase_start，
  commands/report.md 又调 emit-phase 抓一次，两个时间窗 SUM 累加，工时虚增 30-50%。
- 修法：hooks/handlers/user-prompt-submit.js 单源化——业务级（prd/wbs/...）不发 phase_start，
  由 commands/X.md 内 emit-phase 唯一发起；编排级（kickoff/impl/...）保持 hook 抓。
- 测试：phase-detection +1 hook 单源化契约用例；audit-smoke +1 双源去重用例

🟠 **P1-1 修 `progress.json::project_id = "unknown"` 飘移（PR-C）**
- 根因：SessionStart hook 时序差让 --init 时 .ddt/project-id 还未就绪，
  写 unknown 后 --infer 不重读，永远停留 unknown 与实际数据脱节。
- 修法：bin/progress.mjs::infer() 增加自愈逻辑：每次 --infer 读 .ddt/project-id 校验，
  不一致则覆盖。幂等且无副作用——已正确的 ID 不被改。
- 测试：progress-state-machine +2 用例（自愈 + 不覆盖正确值）

🟠 **P1-2 临时文件路径迁移到项目本地（PR-C）**
- 根因：commands/kickoff.md / design.md 把用户技术栈选择写到 /tmp/ddt-user-components.json，
  多项目并行 /kickoff 互相覆盖。
- 修法：路径迁移到 `.ddt/components.json.tmp`，跑完即删。
- 测试：m63-tech-stack +1 路径校验用例

🟡 **P2-1 raw 报告时点声明（PR-D）**
- bin/report.mjs 输出新增"## 5. 数据快照说明"段，明确"本次 /report 自身工时
  尚未计入快照（phase_end 在 raw 写完后才发射），下次 /report 跑时才完整捕获"。
- agents/metrics-agent.md Hard Requirement 第 8 条：必须保留此说明在 final 报告。
- 测试：metric-chain +2 行断言（数据快照说明 + 时点声明文字）

🟡 **P2-2 编排开销显式拆解（PR-D）**
- 根因：之前 raw 只输出"编排合计 0.32h，已计入对应阶段，不重复计算"，
  误导用户认为这 0.32h 是重复数据。实际 0.32h 含 prd+wbs+design 子 phase + 用户交互间隙。
- 修法：bin/report.mjs 引入 ORCHESTRATOR_TO_CHILDREN 映射，按 kickoff/impl/ship 逐个拆解：
  ```
  | 编排命令 | 总工时 | 子阶段合计 | 编排开销 | 子 phase |
  | kickoff | 0.320  | 0.251      | 0.069    | prd + wbs + design |
  ```
  编排开销 = 用户交互 + 决策门暂停 + 阶段切换间隙（可独立优化的协调成本）。
- agents/metrics-agent.md Hard Requirement 第 7 条：必须在 final 引用此数字。
- 测试：metric-chain +1 用例（验证 1200ms - (300+400+400)ms = 0.028h）

### Tooling — 工具链增强

- `bin/audit-smoke.mjs`（新增）：6+2 用例的审计链路冒烟测试，npm run audit:smoke。
- `bin/sync-about.mjs`（新增）：plugin.json description → GitHub About 单一真相源同步。
- `tests/unit/about-counts.test.mjs`（新增）：3 用例锁定 manifest 数字一致性。
- `bin/manifest.mjs`：日志输出去掉外部插件名，统一 DDT 自有描述。

### 测试

- 总用例：v0.7.0 142 → v0.7.1 **151**（+9）
- audit-smoke：6 → **8** 用例（+2 PR-B 红线测试）

### Migration — 升级指引

从 v0.7.0 升级到 v0.7.1：

1. `/plugin marketplace update digital-delivery-team` + `/reload-plugins`
2. `/digital-delivery-team:doctor` 自检
3. **真实数据修复（推荐）**：跑过 v0.7.0 的项目，建议在项目目录跑：
   ```
   node "$DDT_PLUGIN_ROOT/bin/aggregate.mjs" --project <id> --rebuild
   node "$DDT_PLUGIN_ROOT/bin/progress.mjs" --infer
   ```
   让 phase_runs 按新降级匹配重建，progress.json 自愈 project_id。
4. 升级后再跑 `/report` 看效果：
   - phase_runs 行数：膨胀 2× → 实际次数（-50%）
   - report SUM 工时：双源累加 → 单源（-30~50%）
   - 多项目并行 /kickoff：临时文件冲突 → 各自 .ddt/ 隔离
   - raw 报告：含"编排开销拆解"段（kickoff_overhead = total - sum 子 phase）

### 设计

参考：`design/真实测试Audit.md`（实测案例 + 5 大问题根因 + 优化方案）

---

## [0.7.0] - 2026-04-29 — M6 路线图收官

M6.4 开发阶段精细化 — **去 subagent 黑盒** + 6-phase 范式 + validation loop + checkpoint commit。

### Breaking Changes — 破坏性变更

- ❗ **删除 backend-agent / frontend-agent**：从 v0.7.0 起改为 main thread 模式，知识迁到 `skills/backend-development` / `skills/frontend-development`，由 main thread auto-load
- ❗ **`/impl` 从并行黑盒改为串行透明**：`/build-api` → 决策门 → `/build-web` → 决策门，彻底解决并发错配
- ❗ **`/build-api` `/build-web` 重写为 6-phase**：EXPLORE → PLAN → APPROVE → IMPLEMENT → VERIFY → SUMMARY，每步流式可见，每文件 validation，每 step git checkpoint commit

### Added — 新增

**4 个新 skill（替代 2 个旧 agent + 抽取 6-phase 范式）**
- `skills/backend-development/SKILL.md` — 后端实现知识包
- `skills/frontend-development/SKILL.md` — 前端实现知识包（含 4 套 AI 设计源工作流）
- `skills/validation-loop/SKILL.md` — 每文件验证（DDT Golden Rule "fix before moving on"）
  - Quick / Standard / Strict 三档
  - 自动检测包管理器（npm/pnpm/yarn/maven/gradle/poetry/cargo/go）
  - 失败 AskUserQuestion 4 选项（修复 / 跳过 / 回滚 / 重新规划）
- `skills/checkpoint-commit/SKILL.md` — 步骤级 git commit（DDT checkpoint 范式）
  - Checkpoint-Phase / Step / Validation 元信息
  - `.ddt/checkpoints.log` 行格式
  - 与 /relay 协同（注入 What WORKED 段）

**`--module` 分块实现**
- 复杂需求多轮独立 6-phase 跑齐前后端

**测试**
- `tests/integration/m64-build-phase.test.mjs` — 10 个用例
- 总计 122 / 122（v0.6.2 111 + 11 新增）

### Fixed — 修复

- 🔴 用户失语（盲盒）：v0.5.x/v0.6.x impl agent 黑盒，用户全程是观察者 → 6-phase 让用户每节点都能介入
- 🔴 工时不可证明根因之一：subagent 并发 lookback join 错配 → 改串行后并发场景从根上消失
- 🟠 复杂需求一次写不完丢上下文 → --module 分块 + /relay 跨会话续作

### Migration — 升级指引

从 v0.6.2 升级到 v0.7.0：

1. `/plugin marketplace update digital-delivery-team` + `/reload-plugins`
2. `/digital-delivery-team:doctor` 自检
3. **行为变更最大的命令是 /impl 与 /build-api、/build-web**：
   - 不再"同消息派发并行"
   - 每 phase 暂停决策门（除非 --auto）
   - 复杂需求建议 `/build-api --module <name>` 多轮跑
4. 想要 v0.6.x 快速体验：`/impl --auto`

### M6 路线图全部完成 🎉

- ✅ M6.1 数据采集稳定（v0.6.0）
- ✅ M6.5 接力 skill（v0.6.0）
- ✅ M6.3 技术栈交互（v0.6.1）
- ✅ M6.2 决策门（v0.6.2）
- ✅ M6.4 开发阶段精细化（v0.7.0）

v0.7.0 是 M6 整改全部 5 个里程碑落地后的"**生产就绪首版**"。

详见 `design/分析报告_v3.md`。

---

## [0.6.2] - 2026-04-29

M6.2 用户决策门——解决"盲盒严重"痛点，让 DDT 从"包办式"转向"协作式"。

### Added — 新增

**决策门 skill 与执行体**
- `skills/decision-gate/SKILL.md` — 标准 4 选项决策门模板（接受 / 修改 / 新增 / 重新生成 + 自动 Other）+ 处理逻辑表 + Don't/Do 清单
- `bin/emit-decision.mjs` — 决策事件发射器（point/resolved 配对），同时写全局 events.jsonl + 项目本地 `.ddt/decisions.jsonl`
- `bin/lib/schema.sql::decisions` 表 — 持久化决策记录（用于 metrics-agent 分析"哪个 phase 改最多次"）
- `bin/lib/store.mjs` — 处理 decision_point/resolved 事件，FIFO 关联 point→resolved

**10 个 phase command 注入决策门段落**
- prd / wbs / design / build-api / build-web / test / review / fix / package / report
- 每个命令在"Phase 末"标记完成之前必须走决策门（除非 `--auto`）
- 决策门 5 步流程：检查 --auto → emit point → AskUserQuestion 4 选项 → emit resolved → 按选择分支处理

**/kickoff 改 interactive 默认**
- 默认每个内部 phase（prd/wbs/design）跑完都暂停决策门
- `--auto` flag 跳过所有决策门走旧串行 chain（兼容老用户）

**/preview 命令 + bin/preview.mjs**
- `/preview <prd|wbs|design|impl|test|review|fix|package|report|all>`
- 输出指定 phase 产物的关键指标摘要（用户故事数 / ADR 数 / 覆盖率 / 阻塞条目 ...）
- 含 vs HEAD 的 diff stat
- 决策门前的辅助工具：让用户不用打开多文件就能扫一眼

### Fixed — 修复

- 🟠 v0.5.x "盲盒严重"：agent 包办所有 phase 决策，用户全程是观察者
  - 修复：每个 phase 落盘后强制走决策门（除非 --auto），让用户参与关键节点

### Tests

- `tests/integration/m62-decision-gate.test.mjs` — 9 个用例：skill 加载 / emit-decision / decisions 表 / 10 commands 注入 / kickoff interactive / preview 输出 / manifest
- `tests/unit/commands-slim.test.mjs` 基线从 90 调整到 140（决策门段落约 50 行/个，平均 117 行）
- 总计 111 / 111 通过（v0.6.1 102 + 9 新增）

### Migration — 升级指引

从 v0.6.1 升级到 v0.6.2：

1. `/plugin marketplace update digital-delivery-team` + `/reload-plugins`
2. **行为变更**：默认 `/kickoff` 与各 phase 命令在产物落盘后会暂停问你。如果你想要 v0.6.1 的"一键自动"体验：
   ```
   /kickoff --auto
   /prd --auto
   /design --auto
   ...
   ```
3. 试用 `/preview all` 查看项目所有 phase 摘要

### 后续计划（M6.4）

- M6.4 开发阶段精细化（去 subagent 黑盒 + 6-phase 范式：EXPLORE→PLAN→APPROVE→IMPLEMENT→VERIFY→SUMMARY）

详见 `design/分析报告_v3.md`。

---

## [0.6.1] - 2026-04-29

M6.3 技术栈交互式选型 — Spring Initializr 等价 4 步问卷 + tech-stack.json 硬锁死。

### Added — 新增

**Spring Initializr 等价 22 分组组件清单**
- `templates/tech-stack-options.yaml` — 新增（与 v0.6.0 的 tech-stack-presets.yaml 共存）
  - 后端：Java/Node/Python/Go × 多框架 × 22 分组组件（Web/Security/SQL/NoSQL/Messaging/I-O/Ops/Observability/Testing/Cloud/AI ...）
  - 前端：React/Vue/Angular/Svelte/Solid × 多 UI 库 × 多状态管理 × 多数据获取
  - AI-native UI：claude-design / figma / v0 / lovable
  - `askuserquestion_flow` 段：4 步问卷模板（语言 → 数据库 → 前端 → UI）+ 推荐选项 + preview 字段

**AskUserQuestion 交互式问卷**
- `commands/kickoff.md` Step 0：检测 brief 中 "技术栈预设" 字段，若为 `interactive` 或缺失 → LLM 主动调用 AskUserQuestion 4 步问卷
- `commands/design.md` Phase 2b：详细 4 步问卷模板 + components-json 写入流程

**tech-stack.json 硬锁死（双层防御）**
- `hooks/handlers/pre-tool-use.js` 增加硬拦截：检测到 Write/Edit/MultiEdit 目标是 `.ddt/tech-stack.json` 时返回 `permissionDecision: deny`（Claude Code v2.1+ PreToolUse hook 决策 API）
- `architect-agent.md` / `frontend-agent.md` / `backend-agent.md` 三个 agent 的 Hard Requirements 增加"M6.3 SSoT 锁死"条款：禁止 Write/Edit/MultiEdit `.ddt/tech-stack.json`，仅 `bin/resolve-tech-stack.mjs` 唯一允许写入

**resolve-tech-stack.mjs 扩展**
- 新增 `--components-json <path>` 参数：合并 AskUserQuestion 收集的具体组件到 preset
- 新增 `user_customized: true` / `components: [...]` 字段标记自定义
- 新增 `interactive` 字段值：brief 写 interactive 时不取 brief.preset，等待 components-json

**project-brief 模板结构化**
- 新增 8 个具体字段（后端语言/框架/构建/DB/缓存/ORM/认证/测试 + 前端 6 个 + 自由说明）
- 保留 `技术栈预设` 快捷字段；推荐 3 条路径（最快 preset / 推荐 interactive 问卷 / 专家自定义）

### Fixed — 修复

- 🟠 实测 v0.5.x 中 LLM 多次直接 Edit `.ddt/tech-stack.json` 把 nestjs 改 express，违反 SSoT 原则
  - 修复：双层防御（PreToolUse hook hard gate + agent invariant）

### Tests

- `tests/integration/m63-tech-stack.test.mjs` — 9 个用例：options.yaml 结构 / components-json 合并 / interactive 字段处理 / hook 硬拦截 / agent invariant / commands 引导
- 总计 102 / 102 通过（v0.6.0 93 + 9 新增）

### Migration — 升级指引

从 v0.6.0 升级到 v0.6.1：

1. `/plugin marketplace update digital-delivery-team` + `/reload-plugins`
2. 现有项目无需改动（preset 路径完全兼容）
3. 试用交互式问卷：在 brief 中把"技术栈预设"改为 `interactive`，跑 `/kickoff` → AI 会主动 AskUserQuestion 4 步问卷
4. 注意：v0.6.1 起 agent 不能直接 Edit `.ddt/tech-stack.json`；如已存在 LLM 改过的 tech-stack.json，建议 `rm` 后重跑 `/design --refresh`

### 后续计划（M6.2/M6.4）

- M6.2 决策门（每个 phase 落盘后用 AskUserQuestion 询问"接受/修改/重生成"）
- M6.4 开发阶段精细化（去 subagent 黑盒 + 6-phase 范式）

详见 `design/分析报告_v3.md`。

---

## [0.6.0] - 2026-04-29

M6 路线图前两个里程碑：核心数据采集真正稳定（M6.1） + 跨会话接力 skill（M6.5）。

### Fixed — 修复

- 🔴 P0：`aggregate.mjs` 无 watermark 导致 events.jsonl 反复全量 ingest，phase_runs 行数膨胀 4-5×（v0.5.1 实测 kickoff 4 行重复，工时数字膨胀 5×）
  - 根因：每次 Stop hook 后台触发 + `/report` 显式触发，没有去重机制
  - 修复：新增 `ingest_watermark` 表 + 增量 ingest（仅 ts > watermark 才入库）+ `--rebuild` 强制全量
- 🔴 P0：业务阶段（PRD/WBS/Design 等）无独立 phase 工时事件
  - 根因：`/kickoff` 内部 chain 调用不触发 UserPromptSubmit hook，phase_runs 只有粗粒度 kickoff/impl 数据
  - 修复：新增 `bin/emit-phase.mjs` + 10 个 phase command 在 Phase 1 起、命令末尾各调一次

### Added — 新增

**M6.1 数据采集真正稳定**
- `bin/lib/schema.sql::ingest_watermark` 表 — per-project last_ts 水位线
- `bin/lib/store.mjs` 新增 `getWatermark` / `setWatermark` / `resetWatermark` / `rebuildProject`
- `bin/aggregate.mjs --rebuild` — 清空 4 张表后重 ingest
- `bin/aggregate.mjs` 输出新增 `skipped` 与 `watermark` 字段
- `bin/emit-phase.mjs` — 业务阶段事件发射器（独立脚本，commands bash 直接调用，不依赖 hook）
- 10 个 phase command 内嵌 emit-phase start/end 调用
- 4 个 commands（build-web/build-api/test/review）补齐 marker fallback 三连

**M6.5 跨会话接力 skill**
- `skills/relay/SKILL.md` — 13 段式接力 prompt 范式 + DDT 项目特色注入
- `commands/relay.md` — `/relay [--out <path>] [--quiet]` 命令
- `bin/build-relay-prompt.mjs` — 自动收集 progress.json / tech-stack.json / git log / 关键产物路径，输出可一键复制的 prompt

**测试**
- `tests/integration/m6-watermark-emit-relay.test.mjs` — 6 个用例
- 总计 93 / 93 通过（v0.5.1 87 + 6 新增）

### Changed — 改动

- `bin/manifest.mjs::KNOWN_AUXILIARY` 增加 `relay`

### Migration — 升级指引

从 v0.5.1 升级到 v0.6.0：

1. `/plugin marketplace update digital-delivery-team` + `/reload-plugins`
2. 旧 metrics.db 建议清空避免 v0.5.1 phase_runs 重复行残留：
   ```bash
   node "$DDT_PLUGIN_ROOT/bin/aggregate.mjs" --project <id> --rebuild
   ```
   或 `rm ~/.claude/delivery-metrics/metrics.db` 重建
3. 老项目不需要改（emit-phase 是新事件类型，向后兼容）
4. 试用接力：`/digital-delivery-team:relay`

### 后续计划（M6.2/M6.3/M6.4）

- M6.2 决策门（AskUserQuestion 集成）
- M6.3 Spring Initializr 等价技术栈问卷（22 分组 200+ 组件）
- M6.4 开发阶段精细化（去 subagent 黑盒 + 6-phase 范式）

详见 [`design/分析报告_v3.md`](../design/分析报告_v3.md)。

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

完整修复 v0.4.x e2e 测试中发现的 P0 数据采集断链 + 端到端体验对齐 + 技术栈灵活性 + 可重入状态机。

### Added — 新增

**核心数据链路（M1）**
- `hooks/handlers/user-prompt-submit.js` — 抓 slash command 作 phase 标签
- `hooks/handlers/stop.js` — 关闭未闭合 phase + 后台触发 metrics 聚合
- `bin/lib/schema.sql::phase_runs` 表 — 精确阶段工时
- `subagent_runs` 占位行机制 — `subagent_start`/`subagent_stop` lookback join 计算真实 duration

**用户体验体验对齐（M2）**
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
- `bin/progress.mjs` — `.ddt/progress.json` 状态机（10 phase，5 子命令）
- `bin/resume.mjs` + `commands/resume.md` — `/resume` 跨会话恢复
- `hooks/handlers/lib/advisory-lock.js` — `.ddt/locks/` advisory lock（warn-only）

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
- Component inventory via `bin/manifest.mjs`; plugin.json follows DDT convention and does not declare agents/hooks（T-R07）
- `quality_metrics` hook 捕获 coverage / blocker count（T-R04）
- `contexts/delivery.md` + `rules/delivery/{agent-invariants,contract-integrity,metrics-integrity}.md`（T-R05）
- `templates/blockers.template.md` + 命令层阻塞门禁（T-R03）
- 最小测试套件（`tests/`，`node --test` 驱动）（T-R06）

### Changed
- 抽取 hooks.json 启动样板到 `hooks/plugin-hook-bootstrap.js`，每条 entry 的 command ≤ 200 字符（T-R02）
- `_templates/agent-base.md` 简化，Global Invariants 权威版本迁至 `rules/delivery/`

### Internal
- 所有改动均在 `plugins/digital-delivery-team/` 内完成，继续保持 DDT 与其他插件命名空间完全隔离

---

## [0.3.1] · Unreleased

### Changed

- Hooks 入口改为 Claude Code v2.1+ 标准 `hooks/hooks.json`，移除旧 `.claude/hooks.json` 主入口。
- Hook runtime 独立为 DDT 命名空间：`DDT_HOOK_PROFILE` / `DDT_DISABLED_HOOKS`，不读取其他插件的开关变量。
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
