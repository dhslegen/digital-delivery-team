# DDT v0.8.0 实战回归评审报告

> **载体**：`true-test/ddt-team-admin-v0.8/`（团队成员管理后台）
> **会话档案**：`design/ddt-team-admin-v0.8.md`
> **报告日期**：2026-05-06
> **评审版本**：v0.8.0（commit `9c64a3b`）
> **基线测试**：304/304 全过
> **触发原因**：用户在新版插件实战跑 `/prd` → `/wbs` → `/design` → `/design-brief` → `/design-execute` → `/build-web` 全流程时遭遇多处缺陷

---

## 摘要

v0.8.0 的核心能力（Brief 编译器 + 3 通道分发器 + W7.5 12 个 P0 安全/UX 加固）在端到端实战中**功能正确**，但暴露出 **12 项缺陷**，集中在三个层面：

1. **状态机层与度量层不一致**（D2/D3/D9 同根）— W7.5 R1 让 design-brief / design-execute 在 emit-phase 度量层"被看见"，但 `bin/progress.mjs::PHASE_ARTIFACTS` 状态机层依然只认 10 个传统 phase。结果：事件能落盘，但状态机不承认这两个 phase 存在；SessionStart 推断"继续"永远跳到 build-web。
2. **隐式契约链断裂**（D1/D4）— `/design` 命令尾部"建议下一步"早于 v0.8 流程升级写定，没跟着 design-brief / design-execute 一起更新；upload-package 文件名沿用源扩展，撞上 Claude.ai/design 平台白名单。
3. **解析器与外部数据格式脱节**（D5/D6/D12）— 编译器对实际 PRD 与 brief 的格式假设过窄，遇到中文表格或多行 yaml 直接静默返回 0 抽取；agent 失败 main thread 静默 fallback。

总计 6 项 P0/P1 与 6 项 P2/P3，建议合并为 v0.8.1 hotfix 一次性发出。

---

## 缺陷一览

| ID | 严重度 | 类型 | 简述 | 用户已知 | 修复负责文件 |
|---|---|---|---|---|---|
| **D1** | 🟠 P1 | UX | `/design` 完成后建议跳过 design-brief / design-execute | ✅ | `commands/design.md` |
| **D2** | 🔴 P0 | 体系 | design-brief / design-execute / build-web 边界模糊 | ✅ | （根因 D9） |
| **D3** | 🔴 P0 | 状态机 | 新会话"继续"推断 next phase 跳过 design-brief / design-execute | ✅ | `bin/progress.mjs` |
| **D4** | 🟠 P1 | 兼容 | upload-package 含 .yaml/.json，Claude.ai/design 拒收 | ✅ | `bin/derive-channel-package.mjs` |
| **D5** | 🟠 P1 | 解析 | extractUserStories 仅识别 EARS 英文，中文表格抽取为 0 | | `bin/compile-design-brief.mjs` |
| **D6** | 🟠 P1 | 解析 | visual_direction 解析对多行 rationale 失效 | | `bin/derive-channel-package.mjs` |
| **D7** | 🟠 P1 | 守门 | `/build-web` 不前置校验 docs/design-brief.md | | `commands/build-web.md` |
| **D8** | 🟡 P2 | 数据 | progress.mjs 跳到 completed 时 started_at 落 null | | `bin/progress.mjs` |
| **D9** | 🔴 P0 | 体系 | PHASE_ARTIFACTS 缺 design-brief / design-execute | | `bin/progress.mjs` |
| **D10** | 🟡 P2 | 文档 | frontend.type sentinel 位置不透明 | | `commands/design.md` |
| **D11** | 🟢 P3 | 卫生 | 项目根遗留 Untitled 空文件，无 .gitignore 兜底 | | `templates/.gitignore.template` |
| **D12** | 🟠 P1 | 容错 | product-agent 网络失败后 main thread 静默 fallback | | `commands/prd.md`, `wbs.md`, `design.md` |

---

## 详细缺陷分析

### D1 — `/design` 不引导到 brief / execute

**根因**：`commands/design.md::Phase 5` 写死下一步建议为 `/impl 或 /build-web / /build-api`，未引用 v0.8 新增的 design-brief / design-execute 流程。

**实测**：会话记录第 237 行 — "✅ 建议下一步：/impl 或 /build-web / /build-api"，缺 design-brief。

**修复方案**：根据 `.ddt/tech-stack.json::frontend.type` 给出差异化建议：
- `spa` → `/design-brief` → `/design-execute`
- `server-side` / `none` → `/impl`（无 UI 渲染需求）
- 其他 → 两者并列

---

### D2 + D3 + D9 — 状态机层与度量层不一致（同根）

**共同根因**：`bin/progress.mjs::PHASE_ARTIFACTS` 仅定义 10 个 phase，缺 design-brief / design-execute；但 `bin/emit-phase.mjs::VALID_PHASES`（W7.5 R1 修复）已包含这两个 phase。

**连锁后果**：
1. progress.json 永远不会出现 `phases["design-brief"]` 字段
2. `PHASE_ORDER.find(p => p.status !== 'completed')` 必然跳过这两个 phase
3. SessionStart hook 取 `progress.current_phase` 作"下一步建议"——永远跳到 build-web（D3）
4. design-brief / design-execute 在用户视角变成"游离的辅助命令"（D2）

**实测**（progress.json）：
```json
{
  "current_phase": "build-api",   // 应为 design-brief
  "phases": {
    "design": { "status": "completed" },
    "build-web": { "status": "completed" }
    // ↑ 中间没有 design-brief / design-execute 字段
  }
}
```

**修复方案**：
1. `PHASE_ARTIFACTS` 加 `design-brief` / `design-execute`
2. 引入 `'skipped'` 状态语义（与 completed 等价但表达"按规则跳过"）
3. infer 推断时根据 `frontend.type` 决定 design-brief/execute 是 pending 还是 skipped

---

### D4 — Claude.ai/design 不接受 .yaml / .json 扩展

**根因**：`bin/derive-channel-package.mjs::createClaudeDesignPackage` 把源文件原扩展名复制：
```js
['docs/api-contract.yaml',     '03-api-contract.yaml'],   // 平台拒收
['.ddt/tech-stack.json',       '04-tech-stack.json'],     // 平台拒收
['.ddt/design/tokens.json',    '05-design-tokens.json'],  // 平台拒收
```

**实测**：用户手动给 `03-api-contract.yaml` 加 `.md` 后缀绕过（产物里看到 `03-api-contract.yaml.md`）。

**修复方案**：claude-design 与 figma 通道把非 markdown 文件**包装为 markdown 代码块**：
```js
function wrapAsMarkdown(srcPath, language, title) {
  return `# ${title}\n\n> 源：\`${srcPath}\`\n\n\`\`\`${language}\n${readFileSync(srcPath, 'utf8')}\n\`\`\`\n`;
}
```
v0 通道不受影响（程序化导入不受平台白名单限制）。

---

### D5 — extractUserStories 解析器与中文 PRD 脱节

**根因**：`bin/compile-design-brief.mjs:98` 仅匹配 EARS 英文格式：
```js
/\*\*用户故事\*\*\s*[：:]?\s*As a\s+(.+?)\s*[，,]\s*I want\s+(.+?)\s*[，,]\s*so that\s+(.+?)\s*[。.\n]/gi
```

**实测**：product-agent 实际产出中文 markdown 表格 `| ID | 角色 | 我想 | 以便 | 优先级 |`，抽取为 0；LLM 在会话中 fallback 手工填充。

**修复方案**：多策略匹配链（EARS 英文 / 中文叙述 / markdown 表格），首个产出 stories 的策略获胜；全部失败时写 blockers 而非默默继续。

---

### D6 — visual_direction 解析对多行 rationale 失效

**根因**：`bin/derive-channel-package.mjs:138` 单行正则：
```js
/visual_direction:\s*\n\s*selected:\s*([^\s\n]+)\s*\n\s*rationale:\s*([^\n]+)/
```

要求 selected 后**紧跟** rationale 且单行。但实战 brief 含 `tags: [professional, dense]` 中间行 + `rationale: >` block scalar。

**实测**：prompt.md 显示 `**风格方向**：<未填写，请先编辑 brief §8.1>`，用户手动 Edit 修复。

**修复方案**：用结构化解析替代正则——支持 tags 中间字段、`>` / `|` / 缩进续行多种 yaml block scalar 形式。

---

### D7 — `/build-web` 不前置校验 brief

**根因**：`commands/build-web.md::Phase 1` 仅校验 prd + api-contract，不要求 design-brief.md。

**与 D2 协同**：用户跳过 design-brief 直接 build-web 不会被拦截，brief 缺失但 web/ 已实现，verify 时再发现已迟。

**修复方案**：`frontend.type === 'spa'` 时强校验 `docs/design-brief.md`；缺失时给出明确引导（去走 /design-brief 或加 `--skip-brief` 显式逃生口）。

---

### D8 — started_at 落 null 数据完整性

**根因**：`bin/progress.mjs::update` 直接跳 completed 时不回填 started_at：
```js
progress.phases[phase] = { status: 'completed', started_at: null, completed_at: now };
```

**实测**：本次 build-web `started_at = null` + `completed_at = "2026-05-06T03:13:01"`。

**后果**：efficiency-report 算 phase 耗时 `completed_at - started_at` 时此条记录直接 NaN，污染基线统计。

**修复方案**：跳到 completed 时回填同一时刻为 started_at + 加 `duration_estimated: true` 标记，aggregate 时单独处理。

---

### D10 — frontend.type sentinel 位置不透明

**症状**：`/design` 输出无 frontend.type 来源说明；测试方案误以为存在 `docs/frontend.json`，实际 sentinel 在 `.ddt/tech-stack.json::frontend.type`。

**修复方案**：design.md Phase 5 总结段显式输出 `frontend.type: spa (来源 .ddt/tech-stack.json)`。

---

### D11 — 项目根遗留 Untitled 空文件

**症状**：`true-test/ddt-team-admin-v0.8/Untitled` 是只含一行项目名的孤儿文件，疑似 `> Untitled` 重定向手滑产物。

**修复方案**：新增 `templates/.gitignore.template`，由 kickoff / bootstrap 自动复制到新项目，含 `Untitled` / `.DS_Store` / `.ddt/locks/` / `upload-package/` 等忽略项。

---

### D12 — product-agent 静默 fallback

**会话证据**（第 25 行）：
> "product-agent 遇到网络错误，我直接生成 PRD"

main thread 在 subagent 失败后无重试无上报直接 fallback，违反 DDT agent 边界——product-agent 携带专门 prompt 与历史校准，main thread 直接接管会丢失这些约束。

**修复方案**：派发后检查产出（>50 行视为正常），异常则重试 1 次；连续 2 次失败写 docs/blockers.md 让用户决策（重试 / 手动 fallback / 暂停），不静默接管。同步在 wbs.md / design.md 加同模式。

---

## 修复优先级与工时

| 优先级 | 修复 | 工时 |
|---|---|---|
| 🔴 P0 | D9（PHASE_ARTIFACTS）→ 自动解决 D2 D3 | 1.5h |
| 🔴 P0 | D4（upload-package 包装为 .md） | 1.0h |
| 🟠 P1 | D1（design.md 下一步分支） | 0.3h |
| 🟠 P1 | D5+D6（解析器健壮性） | 2.0h |
| 🟠 P1 | D7（build-web 前置 brief 校验） | 0.3h |
| 🟠 P1 | D12（agent 失败重试 + blocker） | 1.0h |
| 🟡 P2 | D8（started_at 回填） | 0.3h |
| 🟡 P2 | D10（design 输出 frontend.type） | 0.2h |
| 🟢 P3 | D11（.gitignore 模板） | 0.5h |

**P0 + P1 合计：≈6 小时**
**P2 + P3 合计：≈1 小时**

建议作为 v0.8.1 hotfix 一次性发出。

---

## 体系级反思

### 1. 度量层与状态机层的对齐契约

W7.5 R1 修复了一个 BUG，但只覆盖了"事件能落盘"。这次实战暴露：**emit-phase 白名单 + progress 状态机 + 命令尾部建议链**这三处在新增 phase 时必须同步修改。

**改进**：在 `skills/decision-gate/SKILL.md` 增加 checklist：
- [ ] `bin/emit-phase.mjs::VALID_PHASES` 含本 phase
- [ ] `bin/emit-decision.mjs::VALID_PHASES` 含本 phase
- [ ] `bin/progress.mjs::PHASE_ARTIFACTS` 含本 phase + sentinel 文件
- [ ] 上一 phase 的"建议下一步"指向本 phase
- [ ] 本 phase 的"建议下一步"指向后续 phase

### 2. 隐式契约链的可见性

12 项缺陷里 5 项（D1/D2/D3/D7/D12）都是"命令之间的隐式契约"——用户必须靠经验拼出流程图。建议未来引入：

- **flowchart.md**：命令依赖图作为正式产物，每次新增命令必须更新
- **--dry-run**：每个命令支持 `--dry-run` 输出"如果跑会读什么、写什么、建议下一步是什么"，让用户预览整条链路

### 3. 解析器健壮性的边界假设

D5/D6 都是因为解析器的格式假设过窄。教训：

- 解析器应有"软 fallback"：第一策略失败自动尝试备选策略
- 全部解析失败时**必须显式上报**，不能默默返回 0/null
- 单元测试应覆盖**真实 agent 产出的 PRD/brief**作为 fixture，而非合成测试数据

---

## 下一步

1. **现在**：本报告归档（已落盘）
2. **进行中**：v0.8.1 hotfix 分支已建立（基于 v0.8.0 tag），按 P0 → P1 → P2/P3 顺序实现
3. **发版**：所有修复 + 回归测试通过后 bump 0.8.1 + CHANGELOG + tag + push

预计 v0.8.1 实现总工时 **≈7 小时**，包含 6 项 P0/P1 + 3 项 P2/P3 + 测试 + 发版流程。
