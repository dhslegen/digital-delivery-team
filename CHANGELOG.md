# Changelog · digital-delivery-team

所有显著变更按 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/) 格式记录，版本遵循 [Semantic Versioning](https://semver.org/)。

---

## [0.9.9] - 2026-05-07 — 实战 hotfix D26：claude-design handoff 输入类型 K + preset/framework 交叉校验 + UI 库场景化推荐

源自实战：alv-ops 项目 brief 自动产出时，LLM 把 java-modern preset 的前端框架凭训练数据偏置写成 "Vue 3 + Element Plus"——违反 preset default（React 18 + Vite + Tailwind + shadcn-ui），同时与 D3=claude-design 通道（bundle 全 .jsx）冲突。用户已经在 https://claude.ai/design 跑过设计了，handoff bundle 含 React/JSX prototype + tokens.css + chat 决策追溯，但 brief 阶段没识别这种输入类型，下游 product-agent 看不见设计决策。

用户诉求："逆向优化 DDT 本身（不改 alv-ops 演示产物），保持通用性"。本次按 skill-creator 三层规范扩展。

### 🔴 D26 修复

**根因 1（输入识别盲区）**：ddt-brief-builder 10 类输入识别（A-J）无 "claude-design handoff bundle"，bundle 只能等到 /design-execute 阶段才被消费——brief / /prd 阶段无法引用。
**根因 2（LLM 自由发挥违反硬约束）**：`templates/tech-stack-presets.yaml::java-modern.frontend.framework=react` 是事实，但 brief §6 段被 LLM 凭训练偏置（国内 Java + Vue + Element Plus 模式）写成 Vue 3，没有交叉校验机制守门。
**根因 3（UI 库 preset default 不适合 B2B 中后台）**：5 个 preset 中 4 个 frontend 是 React + Tailwind + shadcn-ui——shadcn-ui 强项是 SaaS C 端，对中后台高密度数据表格/树/抽屉表现差，但 preset 没分场景默认。

### skill-creator 三层资源扩展

```
skills/ddt-brief-builder/
├── SKILL.md                                ← 输入类型 A-J → A-K；§6 加 ui_components 子字段；D26 反模式
├── scripts/
│   ├── dump-design-handoff.mjs             ← 【新】解析 claude.ai/design handoff bundle
│   ├── check-brief-quality.mjs             ← 加 D26 cross-validation：preset/framework/ai_design 一致性
│   └── ...（其他不变）
├── references/
│   ├── ui-library-by-scenario.md           ← 【新】UI 库场景化推荐（B2B → AntD 5 / SaaS → shadcn-ui）
│   ├── ai-design-quick-pick.md             ← claude-design 段加"框架强相关"（React 零迁移 / Vue 30% 改造）
│   ├── decision-gates.md                   ← D1 速查表加"前端框架"列 + 显式标 React/Thymeleaf
│   ├── field-rules.md                      ← §6 §7 加 D26 反模式 + ui_components 子字段
│   └── ...
├── examples/
│   └── from-design-handoff.md              ← 【新】实战：URL / .tar.gz / 解压目录三种形态
└── （其他不变）

templates/project-brief.template.md         ← §6 加 ui_components 子字段 + §11 加"设计契约"示例
tests/fixtures/real-agent-outputs/design-handoff/r_McQh94UXBuyrFdW2KynA.tar.gz
                                            ← 【新】1.1MB 真实 claude.ai/design bundle 作 D26 测试输入
tests/integration/d26-design-handoff-and-react-lock.test.mjs
                                            ← 【新】+19 测试用例
```

### 修复要点

- **输入类型 A-J → A-K**：新增 K = claude-design handoff bundle（URL / .tar.gz / 解压目录），dump-design-handoff.mjs 自动产出 §11 设计契约 markdown。
- **dump-design-handoff.mjs 核心能力**：
  - 解析 `untitled/README.md` → 项目名 + bundle 内容摘要 + instruction
  - 解析 `untitled/chats/*.md` → 用户原始诉求 + 关键设计决策（视觉/品牌/字体/数据/创新）+ AI 提及的技术栈
  - 解析 `untitled/project/tokens.css` → 品牌色 / 状态色 / 字体族 / total CSS variables
  - 列 `untitled/project/*.jsx` → 推断 React 框架
  - 输出 markdown 片段（注入 brief §11 设计契约）+ 结构化 JSON 摘要
- **不重复造 URL 下载轮子**：URL 形态请先用 `bin/ingest-claude-design.mjs --url` 落盘到 .ddt/design/，再传给 dump 脚本。安全检查（SSRF / 体积 / magic bytes）由专职 ingest 脚本完成。
- **check-brief-quality D26 cross-validation（核心防回归）**：
  - 抽 §6 preset / §7 framework / §8 ai_design_channel
  - 规则 1：4 React preset（java-modern / node-modern / go-modern / python-fastapi）+ 实际 framework=Vue/Svelte/Angular → 软警告（preset default mismatch）
  - 规则 2：ai_design=claude-design + framework≠react → 软警告（30% 改造成本）
  - 软警告不阻塞 pass，仅在 warnings 段提醒
- **UI 库场景化推荐（references/ui-library-by-scenario.md）**：
  - B2B 中后台 / 指挥中心 / 运营管理 → AntD 5（高密度表格/树/抽屉开箱即用）
  - SaaS C 端 / 营销页 → shadcn-ui + Tailwind（视觉现代 / Vercel 生态）
  - 移动 H5 → TDesign Mobile / Vant 4
  - 数据可视化大屏 → AntD 5 + ECharts 5 / AntV G2
  - 3D / 地图重型 → 加 Three.js + react-three-fiber + MapboxGL / 高德 JSAPI
  - 解耦原则：tokens.css 是 W3C Design Tokens，可映射到任何 UI 库主题系统，UI 库选择按场景，不按 claude-design 通道锁死
- **brief 模板 §6 加 ui_components 子字段**：候选值 `tailwind+shadcn-ui | antd-5 | mui-5 | chakra-ui-2 | mantine-7 | naive-ui | element-plus | none`；LLM 写 brief 时严格按场景填，不自由发挥。
- **decision-gates.md D1 速查显式标 React 18 + Vite + TS**：消除 LLM 解读空间。
- **field-rules.md §6 §7 D26 反模式**：明文禁 java-modern + Vue + Element Plus / claude-design + 非 React。

### D26 测试覆盖（+19 用例）

`tests/integration/d26-design-handoff-and-react-lock.test.mjs`：
1-7. dump-design-handoff 解析真实 r_McQh94UXBuyrFdW2KynA bundle：项目名 + 框架 + UI 库 + tokens（61 vars）+ chat 决策（5 条）+ AI 推荐技术栈（React/AntD/Zustand/ECharts/Three.js）+ markdown 输出
8-11. check-brief-quality D26 cross-validation：一致组合 0 issues / java-modern + Vue 警告 / claude-design + Vue 警告 / node-modern + Next.js 一致
12-19. 静态文档约束：SKILL.md 输入类型 K + 字段表 D26 反模式 / field-rules / decision-gates / ai-design-quick-pick / ui-library-by-scenario / examples / brief 模板

测试基数 457 → 476（+19）。`real-agent-fixtures.test.mjs::B1` 加二进制 bundle 例外（.tar.gz / .zip 上限放宽到 2MB）。

### 设计原则保留

- **保持通用性**：D26 不强制 React（README 明说 "recreate in whatever fits"），软警告 + 30% 改造成本说明，让用户自由选择
- **不动 alv-ops**：alv-ops 是演示产物，本次仅优化 DDT skill 通用层；alv-ops brief 后续重跑 ddt-brief-builder 时由 v0.9.9 优化版自动校准

---

## [0.9.8] - 2026-05-07 — 实战 hotfix D25：ddt-brief-builder 输入类型 J（第三方 API 文档）+ §11 集成依赖

源自实战：alv-ops 项目跑 `/prd` 时 product-agent 产生 BLK-001（高，"车企接口协议未确认，阻塞 P0"）+ BLK-003（低，"视频回放可行性未确认"）—— 但用户已经爬好了新石器开放平台 API 文档（14 Cloud + 4 Video endpoints + OAuth2 鉴权 + 错误码表），文档完全可以让两条 BLK 消失。**brief 阶段没识别为"集成依赖"**是 product-agent 看不见契约的根因。

用户诉求：逆向优化 ddt-brief-builder / /prd，按 skill-creator 三层规范彻底改造。

### 🔴 D25 修复

**根因 1（输入识别盲区）**：ddt-brief-builder 9 类输入识别（A-I）无"第三方 API 文档目录"这一类，第三方 API 文档被当成普通文件忽略。
**根因 2（字段语义混淆）**：brief §10 参考资料是"被动浏览的链接"（URL 列表），无字段表达"主动消费的契约"（endpoint × 鉴权 × 错误码）—— 用户即便手填路径，product-agent 也无法判断哪些是契约源。
**根因 3（agent 输入静态）**：product-agent Inputs 清单固定 6 项（brief / prd / baseline / acceptance-criteria / contexts / rules），不读项目内任何外部资料；同时不能违反 SSoT 原则主动扫盘。

### skill-creator 三层资源扩展

```
skills/ddt-brief-builder/
├── SKILL.md                                ← 输入类型 A-I → A-J；字段表 10 → 11
├── scripts/
│   ├── dump-xlsx.py                        ← 不变
│   ├── dump-api-docs.mjs                   ← 【新】markdown 目录树 + 零依赖 OpenAPI yaml/json + 单 md endpoint
│   ├── check-brief-quality.mjs             ← 加 §11 字段识别（optional，不阻塞 pass）
│   └── scaffold-brief.mjs                  ← 不变
├── references/
│   ├── field-rules.md                      ← 加 §11 集成依赖详细规则 + 脱敏要求
│   ├── integration-detection.md            ← 【新】类型 J 识别信号清单（关键词 / 目录结构 / 单文件 / 用户语言）
│   └── ...
└── examples/
    └── from-api-docs-folder.md             ← 【新】alv-ops 实战 + OpenAPI yaml 双例
```

### 修复要点

- **brief 输入类型 A-J**：新增类型 J「第三方 API 文档」，识别信号包括目录名关键词（API / 开放平台 / SDK / OpenAPI / swagger / 集成规约 / 对接文档）、单文件 OpenAPI yaml/json、单 markdown 含 `## GET /xxx` 章节、用户语言。
- **brief 字段 10 → 11**：新增 §11 集成依赖（可选字段），与 §10 参考资料明确划分 - §10 是被动浏览的链接，§11 是主动消费的契约（endpoint × 鉴权 × 错误码）。
- **零依赖 OpenAPI 解析**：`dump-api-docs.mjs` 手写解析 OpenAPI yaml（仅抽 info/servers/paths/securitySchemes），不引入 js-yaml 依赖；同时支持 OpenAPI JSON / 单 markdown / markdown 目录树四种形态。
- **强制脱敏**：dump 过程中 `client_secret` / `appSecret` / `api_key` / `secret_key` / `access_token` 示例值 / `password` / `Authorization: Bearer xxx` 全部 → `***`；`client_id` 不脱敏（公开标识）。
- **product-agent 增强**：Inputs 增加"brief §11 标注的契约文档（按需 Read，不主动扫盘）"；Hard Requirements 第 6 条强制要求"用户故事提到的外部接口必须引用 §11 endpoint 路径，禁止用'未确认'作 BLK"。
- **/prd 命令透传**：Phase 4 派发 product-agent 时把 brief §11 标注的契约文档路径作为额外 prompt 输入。

### D25 测试覆盖（+16 用例）

`tests/integration/d25-integration-source.test.mjs`：
1-5. dump-api-docs 解析 markdown 目录 / OpenAPI yaml / OpenAPI JSON / 单 markdown / 强制脱敏
6-8. check-brief-quality §11 独立标题 / inline 风格识别 + 缺失不阻塞 pass
9-16. 静态文档约束（防回归）：SKILL.md / field-rules.md / integration-detection.md / examples / product-agent.md / commands/prd.md

测试基数 441 → 457（+16）。D23 fixture 已同步更新加 §11，alv-ops fill_rate 仍 100%。

### 反向回测（v0.9.8 验证）

执行修复后，alv-ops 项目的 brief 加 §11 后，重跑 `/prd` 预期：
- BLK-001 消失（接口已对接，14 endpoints + OAuth2 全部已知）
- BLK-002 保留（业务字典仍需客户提供）
- BLK-003 部分消失（Video API 4 endpoints 已知 → 视频回放可行性确认；任务聚合仍待确认）

---

## [0.9.7] - 2026-05-07 — 实战 hotfix D24：ddt-baseline-sync 标准化（template/example 分离 + 重入幂等 + options ≤4）

源自实战：用户在 alv-ops 项目跑 `/ddt-baseline-sync` 时连撞两个隐性 bug——
1. 项目类型决策门写了 5 个 options（B2B/SaaS/API/Mobile/其他），AskUserQuestion 工具上限 4 项 → InputValidationError。
2. 首次跑 skill 时，从插件根 `baseline/historical-projects.csv` 复制 8 行教学示例（HIST-001~HIST-008）到用户项目根，再追加用户真实数据为 HIST-009 → 用户基线被插件示例污染，pm-agent 后续做工时同类对比时把"用户认证模块 48h"当真实历史。

用户诉求："baseline 这条线 标准化、稳定化、高可用化、可重入化"。本次按 skill-creator 三层资源规范彻底重构。

### 🔴 D24 修复

**根因 1（options 超限）**：SKILL.md 与 examples 决策门写 5 项，违反 Claude Code AskUserQuestion 单题 ≤4 项约束。
**根因 2（示例污染）**：`append-historical.mjs` 的 `ensureBaseline()` 把"插件分发的 schema 演示数据"当用户初始数据复制；commands/wbs.md 与 commands/report.md 也直接 cp 同一文件，三处污染源。
**根因 3（不可重入）**：append 仅以 HIST-NNN 自增为 key，不按 `project_name` 查重，同名项目重跑会无限叠加。
**根因 4（首次 /report 中断）**：`bin/baseline.mjs --lock` 要求 hist CSV ≥1 行数据，仅表头会抛错，挡住用户首次跑 /report。

### skill-creator 三层资源重构

```
skills/ddt-baseline-sync/
├── SKILL.md
├── scripts/
│   ├── parse-staffing.py
│   └── append-historical.mjs           ← 重写：模板初始化 + 查重 + 重入策略
├── assets/                              ← 新增：用作输出的资源
│   └── historical-projects.template.csv  ← 仅表头（用户初始化用）
└── examples/                            ← 学习示例
    ├── from-staffing-xlsx.md
    ├── historical-projects.example.csv  ← HIST-001~HIST-008（教学，不被代码引用为初始数据）
    └── historical-projects.example.md   ← schema 字段速查 + 映射效果
```

### 修复要点

- **决策门 options 5→4**：B2B-后台 / SaaS-C 端 / API-Mobile / 其他（自定义）；"其他"由工具自动提供 Other 输入框，不手写第 5 项。
- **ensureBaseline 改用 skill assets 模板**：默认从 `assets/historical-projects.template.csv`（仅表头）初始化；`--with-examples` 显式 opt-in 才用教学示例。
- **同名查重 + 重入决策**：新增 `findByName()` 按 `project_name` 查重；存在时按 `--on-duplicate skip|overwrite|append`（默认 skip）；新增 exit code 4 表示"幂等保护"。
- **三处 cp 统一**：`commands/wbs.md` / `commands/report.md` / `append-historical.mjs` 全部从 skill assets 模板初始化用户基线；插件根 baseline 仅作 plugin-default schema 兜底，不再被复制。
- **bin/baseline.mjs 容忍仅表头**：CSV 无数据行时 hist=null，merged 直接等于 expert（专家估算兜底），用户首次跑 /report 不再被中断。

### D24 测试覆盖（+12 用例）

`tests/integration/d24-baseline-init.test.mjs`：
1. assets/template 仅表头一行
2. examples/example.csv 含 8 行示例
3. 默认初始化用 template，不复制示例（HIST-001 是用户首条真实数据）
4. --with-examples 才复制示例
5. 同名重入 default skip（exit 4 + 幂等保护）
6. --on-duplicate overwrite 覆盖原行（project_id 不变）
7. --on-duplicate append 作新行
8. SKILL.md 项目类型 options ≤4（防止超限回归）
9. examples/from-staffing-xlsx.md options ≤4
10. bin/baseline.mjs 容忍仅表头 hist
11. commands/wbs.md cp 已切到 skill assets template
12. commands/report.md cp 已切到 skill assets template

测试基数 429 → 441（+12）。

---

## [0.9.6] - 2026-05-07 — 实战 hotfix D23：check-brief-quality 字段识别放宽 + 真实 fixture 防回归

源自实战：用户跑 v0.9.5 ddt-brief-builder 后跑 check-brief-quality 自检，结果
LLM 自动产出的 brief（用 §N 编号 + 独立 ## 技术栈预设 章节）**全部字段被误判为缺失**——
脚本与自己产出的 brief 风格不兼容，制造流程摩擦。

### 🔴 D23 修复

**根因 1**：脚本正则用 `^##\s+项目背景\s*$` 强匹配纯标题，不识别"## §1 项目背景"。
**根因 2**：技术栈/前端类型/AI 通道字段只识别 inline `**字段**: 值`，不识别"## 技术栈预设"独立章节。
**根因 3**：JS regex 的 `\b` word boundary 在中文字符前后不生效，让"放宽尝试"还是失败。

**修复**：
- 所有 10 字段正则放宽兼容 4 种合法风格：
  1. 纯标题：`## 项目背景`
  2. §N 编号：`## §1 项目背景`
  3. 独立章节：`## 技术栈预设`（字段名作章节标题）
  4. inline：`**技术栈预设**: java-modern`
- 移除中文不生效的 `\b`，改用"行首 ## + 可选 §N + 字段名"宽松匹配
- §6 技术栈兼容"## 技术栈预设" / "## 技术栈选型" 两种标题
- §7 §8 兼容独立章节标题

### D23 fixture 防回归

`tests/fixtures/real-agent-outputs/brief/`：
- `alv-ops-llm-generated.md`（LLM 自动产出，§N + 独立章节风格 → 100% pass）
- `team-admin-handwritten.md`（v0.9.2 手写版，## 技术栈选型 → inline → 90% pass）

`tests/integration/d23-brief-quality.test.mjs`：参数化跑两个 fixture + 反向防御
（§N 编号最小化 brief 必须识别 6/6 必填）

### 测试

- 423 → 429（+6 D23 测试）

### 设计反思

**"工具与产出风格脱节"是丝滑性的隐形敌人**：
- v0.9.4 抽出 check-brief-quality.mjs 时只用了一份手写 fixture 验证（design/比赛项目）
- 没用真实 LLM 产出 brief 验证 → 导致 v0.9.5 实战发现脚本与 LLM 自动产物不兼容
- 修法：把"真实 LLM 自动产物"作为 fixture 的金标准，**不再用合成测试代替**

这与 v0.8.1 D5 / v0.8.2 D15 的"测试 fixture 偏差"是同类问题，每次 LLM 自动化
产物的脚本都应用真实数据跑回归。

### Migration

完全向后兼容：
- 旧 brief 格式（手写 inline 风格）继续 pass
- 新 brief 格式（LLM 自动 §N + 独立章节）现在也 pass
- 用户无需手动改 brief 标题

```
/plugin marketplace update digital-delivery-team
/plugin install digital-delivery-team@0.9.6
```

---

## [0.9.5] - 2026-05-07 — 实战 hotfix D22：skill scripts/ 引用绝对路径化

源自实战：用户用 v0.9.4 跑 ddt-brief-builder skill，LLM 写出
`python3 .claude/plugins/cache/...` 错误路径——把 plugin cache 当成项目根相对路径。
根因：v0.9.4 SKILL.md 把 `scripts/dump-xlsx.py` 当 skill 内部相对路径写，但 LLM
跑 Bash 时 cwd 是用户项目根，不是 skill 根，找不到脚本。

### 🔴 D22 修复（commit hash 待定）

这是 v0.9.3 D19 的横向延伸——D19 修了 `templates/xxx`，但 v0.9.4 新增的
`scripts/xxx` / `references/xxx` 引用又掉进同一个坑。

修复：
- ddt-brief-builder/SKILL.md：3 处 scripts/ + 2 处 references/ 引用全部加
  `$DDT_PLUGIN_ROOT/skills/ddt-brief-builder/` 前缀
- 新增 § "如何调用本 skill 的 scripts/" 段，给 LLM 完整的 fallback chain：
  ```bash
  PR="${DDT_PLUGIN_ROOT:-$(cat ~/.claude/delivery-metrics/.ddt-plugin-root 2>/dev/null)}"
  PR="${PR:-${HOME}/.claude/plugins/marketplaces/digital-delivery-team}"
  python3 "$PR/skills/ddt-brief-builder/scripts/dump-xlsx.py" <path>
  ```
- ddt-baseline-sync/SKILL.md 同步加同款"如何调用 scripts/"段
- 显式写出反模式（`python3 scripts/xxx.py` 错；`.claude/plugins/...` 错）

### D22 契约测试（防回归）

`tests/unit/path-prefix-contract.test.mjs` 新增"D22"测试：
- 扫描 skills/*/SKILL.md 中 ```bash 代码块
- 命令执行模式（python3/node/exec/cp/mv 后接 scripts/xxx）必须含 `$DDT_PLUGIN_ROOT` 或 `$PR/skills/`
- 行内 `references/xxx.md` 引用（不在树状索引段）必须带绝对前缀

### 测试

- 422 → 423（+1 D22 契约）

### 设计反思

v0.9.3 D19 / v0.9.5 D22 揭示**隐式契约的横向传染**：
- D19 修了 templates/contexts/rules → 解决一类
- v0.9.4 新增 scripts/ → 又一类同源 BUG
- v0.9.5 D22 修 + 契约测试覆盖

未来新增 SKILL.md 内任何"plugin 内资源"引用类型时，必须**前向更新契约测试**，
让回归测试自动覆盖新类型。

### Migration — 升级指引

完全向后兼容：
- 旧 v0.9.4 用户 LLM 跑 skill 时仍可能错路径，但用户重启会话后 marker 会自愈到 v0.9.5
- v0.9.5 SKILL.md 内引用统一绝对路径，LLM 不会再写错

```
/plugin marketplace update digital-delivery-team
/plugin install digital-delivery-team@0.9.5
```

---

## [0.9.4] - 2026-05-07 — skill-creator 重构：scripts 下沉 + 抽离 ddt-baseline-sync

按 skill-creator 最佳实践（progressive disclosure / scripts/references/examples 三层结构）
重构 ddt-brief-builder，并抽离 baseline 增量同步为独立 skill。最高优先级 KPI：
**丝滑减少演示流程摩擦**——从一句话 → 可启动 DDT 全流程 ≤ 5 步互动 ≤ 90 秒。

### Added — 新增

🟣 **抽离 skills/ddt-baseline-sync/（13 skill = 12 + 1）**

把 v0.9.2 塞在 ddt-brief-builder 里的 baseline 增量协议（100+ 行）抽出来作独立 skill：

- 独立触发关键词：导入工时 / 录入人员表 / baseline 校准 / historical-projects 增量
- `scripts/parse-staffing.py`：xlsx 人员表 → JSON（角色 → phase 映射 / 复杂度判定 / 时间窗）
- `scripts/append-historical.mjs`：JSON → baseline/historical-projects.csv 一行（自动 HIST-NNN / 项目级优先 / fallback 插件根）
- 管道化设计：`parse-staffing.py | append-historical.mjs --json -` 一气呵成
- 含 example 实战演示（无人物流车 5.0 人月 / 7 角色 → HIST-009 入库）

### Changed — 重构

🟣 **ddt-brief-builder 三层结构化（progressive disclosure）**

scripts/ 下沉（v0.9.3 内联 bash 协议段全部抽出）：
- `scripts/dump-xlsx.py`：xlsx 全文 dump（自动 pip install openpyxl 兜底）
- `scripts/check-brief-quality.mjs`：brief 字段填充率自检（输出 JSON 让 LLM 直接读）
- `scripts/scaffold-brief.mjs`：项目目录一键脚手（mkdir + cp brief + cp .gitignore + git init + initial commit + 输出"下一步"引导）

references/ 精简（reference → references 目录名标准化）：
- `decision-gates.md` 新增（D1/D2/D3 完整 AskUserQuestion 模板从 SKILL.md 抽出）
- `field-rules.md`：338 → 273 行（移除 §11 baseline 协议 100+ 行，改指针引用 ddt-baseline-sync）

SKILL.md 精简：**357 → 201 行**（-44%）
- 移除内联 bash / 改为脚本引用
- "反模式 / 实践要点"等冗长段落合并为简短"边界（做/不做）"
- 决策门完整模板下沉到 references/decision-gates.md
- 末尾"资源索引"清晰列 scripts/references/examples 树状结构

### KPI 验证

**丝滑五步流程**（从一句话到可启动 DDT）：
1. 用户："启动 alv-ops，brief 内容如下：..."
2. AI 解析输入 + 跑 dump-xlsx.py / parse-staffing.py（如有）
3. AI 一次性发 D1+D2+D3 三个 AskUserQuestion + 可选 baseline 类型门
4. 用户点选
5. AI scaffold-brief.mjs 一键脚手 + 输出"下一步" → ✅ 完成

**预估时间**：≤ 90 秒（不含用户思考时间）

### 测试

- 422/422 全过（重构无破坏）
- manifest 描述更新：12 skill → 13 skill

### 设计

- 应用 skill-creator 的"Domain organization"原则：可独立触发的子能力（baseline 同步）抽出来作独立 skill
- 应用 progressive disclosure：metadata（描述）总在 context；SKILL.md ≤ 200 行；scripts/references 按需加载
- 应用"管道化"丝滑模式：scripts 之间用 stdin/stdout 串联，避免中间 /tmp 文件
- 应用"出错信息即修复指引"：每个脚本错误直接告诉用户下一步该跑什么命令

### Migration — 升级指引

完全向后兼容：
- 旧 brief 文件继续可用
- v0.9.3 用户跑 ddt-brief-builder 走旧路径仍能产出（但 skill 已升级到 v0.9.4 协议）
- baseline 信息源用户：从"塞 brief"模式过渡到"独立调用 ddt-baseline-sync"模式

```
/plugin marketplace update digital-delivery-team
/plugin install digital-delivery-team@0.9.4
# 重启 Claude Code 让 SessionStart hook 写最新 marker（v0.9.3 D20 已自愈）
```

## v0.9 系列累计

| 版本 | 主题 | 关键交付 |
|---|---|---|
| v0.9.0 | 流程可见性 + 解析器加固 | flowchart / dry-run / progress 可视化 / fixtures + D16-D18 |
| v0.9.1 | DDT 第零步入门丝滑 | ddt-brief-builder skill |
| v0.9.2 | brief-builder 实战反向优化 | B2B 多模块 + xlsx + baseline 增量 |
| v0.9.3 | 路径前缀 + marker 自愈 | D19 + D20 + D21 hotfix |
| **v0.9.4** | **skill-creator 重构 + 抽离 baseline-sync** | **scripts 下沉 + 13 skill + 丝滑 KPI 5 步流程** |

---

## [0.9.3] - 2026-05-07 — 实战 hotfix：路径前缀显式化 + marker 自愈

源自实战：用户用 v0.9.2 跑 /prd（项目 alv-ops），LLM 报"templates 目录不存在"。
排查发现两层 BUG：(1) commands 文档把 `templates/xxx` 当相对路径让 LLM 误读为
项目根；(2) `.ddt-plugin-root` marker 文件锁在旧版 0.8.1，让用户装的 v0.9.2
新功能全部用不上。

### 🔴 Fixed — P0 修复

🔴 **D19 commands/agents 模板引用显式 \$DDT_PLUGIN_ROOT/ 前缀**（commit b579e37）

21 处引用全部显式标 plugin 根：
- commands: prd / wbs / design / review / test / report / package / kickoff
  - prd.md：plugin root 解析提到 Phase 1 顶部，让 cp 模板时 \$DDT_PLUGIN_ROOT 已可用
  - wbs.md：baseline 引用标"项目根优先 / fallback 插件根"
- agents: product / pm / architect / docs / metrics / test / review / design-brief / fix
  - 所有 contexts/delivery.md + rules/delivery/*.md 全部加前缀
  - 所有 templates/blockers.template.md + templates/xxx.template.md 全部加前缀

skills/* 引用保持不变（Claude Code Skill tool 自动加载，无需路径）

🔴 **D20 marker 自愈到最新 cache 版本**（commit ba187fe）

- 新增 `pickLatestPluginRoot(homedir)`：扫描
  ~/.claude/plugins/cache/digital-delivery-team/digital-delivery-team/
  下所有 semver 版本目录，过滤含 bin/aggregate.mjs 的，按 semver 排序挑最新
- 新增 `semverCompare(a, b)`：完整 semver 比较（10.0 > 9.9 / pre-release < release）
- `persistPluginRoot` 优先级：cache 最新版 > env DDT_PLUGIN_ROOT > env CLAUDE_PLUGIN_ROOT
- 新装版本下次会话即激活（marker 自动覆盖旧值）

### 测试

- 409 → 422（+13 D21 契约测试）
- tests/unit/path-prefix-contract.test.mjs：commands + agents 中 templates/contexts/rules
  必须带 \$DDT_PLUGIN_ROOT/，项目资源不应误标
- tests/integration/marker-self-heal.test.mjs：pickLatestPluginRoot + semverCompare +
  persistPluginRoot 完整覆盖（cache 优先 / env fallback / degraded mode）

### 设计

- v0.5→v0.9 又一类隐式契约暴露——"路径前缀"。所有"plugin 内资源"必须显式标
  \$DDT_PLUGIN_ROOT/，区分于"项目内资源"（docs/.ddt/web 等）
- D20 让插件版本升级真正生效——marker 不再"锁死首次会话版本"

### Migration — 升级指引

完全向后兼容：
- 旧 commands 用户跑 /prd 仍能工作（DDT_PLUGIN_ROOT env 在 Phase 2 内已 fallback marker）
- D19 让文档对 LLM 更清晰，不改变运行时行为
- D20 让用户**不需要任何操作**就能用上最新版本——下次会话启动 hook 自动覆盖 marker

```
/plugin marketplace update digital-delivery-team
/plugin install digital-delivery-team@0.9.3
# 重启 Claude Code 让 SessionStart hook 写最新 marker
```

---

## [0.9.2] - 2026-05-07 — ddt-brief-builder 实战反向优化（B2B 多模块 + baseline 增量）

源自实战：用户用真实 B2B 项目（无人物流车运营服务平台 V1.0，万集科技）
跑 v0.9.1 ddt-brief-builder 时暴露的不足。该项目特征：
- 6 大模块 / 13 leaf 功能（多模块）
- 5 个外部车企接口待对接（强外部依赖）
- 7 角色 / 5.0 人月 / 2.5 月窗口（B2B 中型团队）
- 客户驱动（会议纪要含"客户代表"参与确认）
- 输入是会议纪要 + xlsx 功能清单 + xlsx 人员需求计划表（多源混合）

### Added — 新增（skill 能力扩展）

🟣 **输入识别新增 H/I/J 三类**：
- H 会议纪要 / 评审记录（"※" 标识 / "目标上线日" / "客户代表"）→ **客户驱动模式**
- I xlsx / csv 功能清单类 → **自动 dump**（用 Bash + python3 openpyxl，无需用户额外操作）
- J 人员/工时/进度表（baseline 信息源）→ **不塞 brief，追加到 baseline/historical-projects.csv**

🟣 **关键场景特化（5 类信号识别）**：
- B2B 项目 → D1 决策门首选 java-modern（不是默认 node-modern）
- 多模块项目（5+ 模块）→ §4 允许"按模块归类"，**不强制 3-7 条上限**
- 外部接口强依赖 → §5 加"外部接口依赖"子项 + 未确认接口写软 blocker
- 会议纪要 ※ / [必做] 标识 → 自动转 P0（其余 P1/P2）
- 工期不现实 → 触发 reasonability check 软 blocker
- 客户参与决策 → §2 用户分甲方/乙方两类

🟣 **xlsx / csv 自动解析协议**：
- skill 内部 spawn `python3 -c "import openpyxl..."` 完成 dump
- pip install openpyxl 自动检测与安装提示
- 全文 dump（不截断）

🟣 **baseline 增量协议（核心新能力）**：
- 解析人员表得"角色 × 进入/离开时间 × 人月"
- 按 phase 反向映射（项目经理→architecture / 产品→requirements / UI→design 等）
- 计算总工时 = 总人月 × 22 × 8，判定复杂度（≤60 简单 / 60-200 中等 / >200 复杂）
- AskUserQuestion 询问追加 baseline，让用户决策
- 团队规模/时间窗口同步写到 brief §5

🟣 **多模块项目 §4 markdown 结构**：
- 每模块独立 H3 标题 + 子功能列表 + P0/P1/P2 标识
- 优先级识别信号：※ / ★ / [必做] / [P0] / "v1.0 范围内" → P0

🟣 **D1 决策门智能默认（按输入信号）**：
- B2B 信号 → java-modern
- SaaS 信号 → node-modern
- AI/数据信号 → python-fastapi
- 高并发信号 → go-modern
- 完全无信号 → node-modern（默认）

### Added — 新例 example D

🟣 **examples/from-meeting-minutes.md**：基于真实"无人物流车运营平台 V1.0"实战
- 4 类输入混合（会议纪要 + 功能清单 xlsx + 人员表 xlsx + 用户描述）
- xlsx 自动 dump 演示
- 6 模块归类 + ※ P0 标识识别
- 5 个外部接口依赖处理
- 7 角色 / 5.0 人月 → baseline 增量决策门
- 工期 reasonability check（224 vs 880 工时通过）

### reference 速查更新

🟣 **tech-stack-quick-pick.md** 决策助手表加 B2B 信号行（物流/车队/工厂/医院/政府/运营 → java-modern）+ B2B vs SaaS 维度对比表

🟣 **field-rules.md**：
- §4 加多模块项目处理（模块化 markdown 结构）
- §5 加外部接口依赖子项 + 工期 reasonability check 算法
- 新增 §11 baseline 增量协议（解析规则 / 计算公式 / CSV 行模板 / 用户交互模板）

### 设计

- 实战驱动 skill 优化的"反向闭环"：v0.9.1 出 skill → v0.9.2 用真实 B2B 项目跑 → 5 项不足修正 → v0.9.2 发版
- 产物 skill 不再只产 brief，而是**产 3 件事**：
  1. project-brief.md（DDT 入口）
  2. baseline/historical-projects.csv 新行（增量校准基线）
  3. brief §5 的"团队 + 时间窗 + 外部依赖"实数据（vs v0.9.1 抽象描述）

### Migration — 升级指引

完全向后兼容：
- 简单项目走旧路径（自然语言 / 文件 / URL → brief）不变
- 多模块 / B2B / xlsx / 人员表场景自动启用新协议
- baseline 增量是 opt-in（AskUserQuestion 询问，默认追加）

```
/plugin marketplace update digital-delivery-team
/plugin install digital-delivery-team@0.9.2
```

---

## [0.9.1] - 2026-05-06 — DDT 工作流第零步：ddt-brief-builder skill

### Added — 新增

🟣 **skills/ddt-brief-builder：把任意输入转成专业 brief**

源自实战痛点：用户每次新项目都卡在"DDT 第一个文件 project-brief.md 该填什么"
的入门摩擦上。template 字段太多，用户的真实输入往往是杂乱的（一段中文描述 /
比赛官网链接 / 已有 PRD），不知道怎么映射。

新增 skill 自动覆盖所有入口：
- **输入识别**：自然语言 / 文件路径 / URL / 已有 PRD / 比赛官网 / 截图 / 多源混合，7 类自动识别
- **字段提取**：10 个 brief 字段按"必填 / 决策 / 可选"三档处理，每个有提取策略 + 缺失处理 + 反模式
- **3 个关键决策门**（必须用 AskUserQuestion，**不替用户决定**）：
  - D1 技术栈预设：5 preset + interactive 单选
  - D2 前端类型（PR-E 三态）：spa / server-side / none
  - D3 AI 设计通道（仅 spa）：claude-design / figma / v0
- **质量自检**：填充率 < 70% 加产物警告，强制 D1+D2+D3 通过才允许产出
- **产物落盘**：cwd/project-brief.md（DDT 项目根约定）+ 已有 brief 默认旁路 draft
- **下一步引导**：明确告知用户跑 /prd → /wbs → /design → /design-brief 完整链路

skill 结构：
```
skills/ddt-brief-builder/
├── SKILL.md                                ← 主指令（识别 + 提取 + 决策 + 自检）
├── reference/
│   ├── field-rules.md                      ← 10 字段决策准则
│   ├── tech-stack-quick-pick.md            ← D1 速查（输入暗示 → 推荐预设）
│   └── ai-design-quick-pick.md             ← D3 速查（3 通道差异 + 隐私 + 适合场景）
└── examples/
    ├── from-paragraph.md                   ← 用户粘贴一段文字 → brief
    ├── from-existing-prd.md                ← 已有 PRD 反向提炼 brief
    └── from-competition-url.md             ← 比赛官网 → brief（评分项作硬指标）
```

### 触发关键词

- "帮我写 project-brief"
- "DDT 第零步"
- "新项目设置" / "测试项目设置"
- "把需求转成 brief"
- "我想用 DDT 跑这个项目"
- "比赛项目想用 DDT"
- 任何粘贴需求/比赛说明/已有 PRD 让 LLM 转成 DDT 输入的场景

### 与 DDT 体系的对齐契约

skill 产出的 brief 满足下游约束：
- /prd Phase 1 文件存在性检查 → 路径 cwd/project-brief.md
- /design Phase 2b 技术栈预设字段 → 值在 7 个枚举内（5 preset + interactive + custom）
- /design-brief 引用 brief 的"目标用户"、"核心功能" → 必填非空
- /design-execute 读 ai_design.type → D3 决策门给清晰值

### Tests — 测试

- skill 添加不破任何既有测试（409/409 全过）
- manifest description 自动更新：11 skill → 12 skill

### 设计

- 解决 v0.5→v0.9 演进中"用户卡在 brief 入口"的痼疾
- 与 v0.9.0 流程可见性主线（A1 flowchart / A2 dry-run）协同：用户从"看不见全流程"到"看得见 + 能预览 + 能从任意输入入门"

### Migration — 升级指引

完全向后兼容：
- 不影响既有 project-brief.md（用户可继续手填）
- skill 是被动触发（用户说话含关键词时加载），不强制使用
- templates/project-brief.template.md 不变，skill 内部使用同样字段结构

```
/plugin marketplace update digital-delivery-team
/plugin install digital-delivery-team@0.9.1
```

新 skill 用法：在新项目里直接对 Claude 说"帮我写 project-brief，[你的需求]"，
skill 会自动加载并引导你完成 D1/D2/D3 决策，1 分钟内产出专业 brief。

---

## [0.9.0] - 2026-05-06 — 流程可见性主线 + 解析器加固 + 实战回归回炉

源自 v0.8.0 实战暴露的"功能正确但流程不可见"问题。v0.9 主题：从"能跑"
升级到"可见"——把命令之间的隐式契约图形化，让试错成本归零。

### Added — 新功能

🟣 **A1：bin/render-flowchart.mjs 命令依赖图渲染器**（commit 1ba5954）
- 从 commands/*.md 自动派生 mermaid 流程图
- 三种"建议下一步"抽取策略（简单引用 / 分支表 / dry-run --next 参数）
- 节点形状区分：phase（蓝矩形）/ 编排（橙圆角虚线）/ utility 不进图
- 三态分支可视化（spa / server-side / none 边带条件标签）
- 产物：docs/architecture/flowchart.md（含主链路 + 三态分支）

🟣 **A2：bin/print-dry-run.mjs + 13 命令 --dry-run 支持**（commits 0be6cac + 99010f1）
- 共用 helper：4 段固定结构（📥 读取 / 📤 写入 / 📊 emit / 👉 下一步）
- 13 个命令在 emit-phase --action start 之前加 4 行 dry-run 段：
  prd / wbs / design / design-brief / design-execute / build-web / build-api
  / test / review / fix / package / report / impl
- 不读不写实际文件 / 不发 emit-phase 事件
- 配套 dry-run-contract 测试（验证每命令 grep 检查 + exit 0 + 4 段输出）
- verify / ship / kickoff 编排级 dry-run 留 v0.9.x（语义需扩展）

🟣 **A3：bin/render-progress.mjs ASCII 进度条 + /resume 集成**（commit cc80448）
- 进度条字符：█ completed / ░ skipped|pending / ▓ in_progress
- 短名行 + 状态图标行 + 当前 phase 高亮（↑ 当前: /xxx）
- 全部完成 🎉 / skipped 显示"按规则跳过" / duration_estimated 显示 ⚠️估算
- /resume 命令改用此工具替代旧纯文本列表（保留"已完成: N"向后兼容）

🟣 **B1：tests/fixtures/real-agent-outputs/ 真实 agent 产出 fixture 库**（commit e0a47f9）
- 把 v0.8.1 实战 ddt-team-admin-v0.8.1 的 5 个 agent 产出作 golden 数据：
  prd / wbs / arch / design-brief / tech-stack
- 解析器测试参数化：每个真实 PRD 必须抽出 ≥ 1 条 user story
- 防止 D5 / D15 类合成测试 vs 真实 agent 输出脱节
- 体积上限 100KB / 来源标注 / 添加新 fixture 流程

### Fixed — 实战回归回炉（v0.8.1 暴露但未列 hotfix 的架构问题）

🟠 **D16+D17：emit-phase 同步更新 progress.json**（commit eac4e07）
- v0.8.1 实战 design-brief / design-execute 都被标 duration_estimated: true，
  根因是 emit-phase 写 events.jsonl 但不更新 progress.json，progress.json
  靠 infer 时 D8 fallback 兜底
- 修复：emit-phase 在 appendFileSync 后立即 spawnSync 调 progress.mjs --update
- PROGRESS_TRACKED_PHASES 集合：仅 12 phase 命令同步，编排命令保持原行为
- 项目无 .ddt/progress.json 时静默 skip（v0.7 兼容）
- 失败不阻塞 emit-phase（写 events 已成功）

🟠 **D18：blocker 软/硬区分**（commit 2b8de2b）
- v0.8.1 实战 design-brief-agent 写"软 blocker"（`- [BLOCK-XXX-NNN] <描述>`），
  但 check-blockers.sh 只识别硬 blocker（含 resolved_at: null）
- 修复：check-blockers.sh 加 --soft / --strict 模式
  - 默认仅查硬（向后兼容）
  - --soft 同时报告软（不阻塞）
  - --strict 软也阻塞
- templates/blockers.template.md 重写：两类 blocker 对比表 + 模板 + "何时用哪种"决策准则

### Tests — 测试

- 351 → 409（+58 用例覆盖 6 个新功能 + 7 项契约 + B1 fixture 参数化）
- 关键测试套件：
  - tests/integration/dry-run-contract.test.mjs（A2 17 用例）
  - tests/integration/flowchart-render.test.mjs（A1 8 用例）
  - tests/unit/render-progress.test.mjs（A3 10 用例）
  - tests/integration/real-agent-fixtures.test.mjs（B1 6 用例）
  - tests/integration/d16-d17-progress-sync.test.mjs（D16+D17 5 用例）
  - tests/integration/d18-blocker-soft-hard.test.mjs（D18 7 用例）
  - tests/unit/print-dry-run.test.mjs（A2-T1 6 单元）

### 设计

- v0.8 系列实战暴露 D1-D18 全部回炉处理（hotfix → 主线 → fixture），
  形成"实战 → 评审 → hotfix → 主线 → 回炉"完整循环
- v0.9-roadmap §A 流程可见性 + §B 解析器加固两条主线全部落地
- D16/D17 让 progress.json 与 events.jsonl 实时一致，未来 efficiency-report
  数据不再受 D8 fallback 污染

### Migration — 升级指引

完全向后兼容，无 breaking change：
- 旧的 docs/blockers.md（仅硬 blocker）继续按默认模式工作
- 旧的项目无 .ddt/progress.json 时 emit-phase 仍正常
- v0.8.x 老命令格式仍能跑（dry-run 是新增分支，不影响主流程）

升级方法：`/plugin marketplace update digital-delivery-team` →
`/plugin install digital-delivery-team@0.9.0`

新功能用法：
- 看流程图：`docs/architecture/flowchart.md`（mermaid 渲染）
- 预览命令：`/prd --dry-run` 等 13 个 phase 命令
- 进度可视化：`/resume` 自动用新版

---

## [0.8.2] - 2026-05-06 — 二轮实战回归 hotfix：D13-D15 体系级断裂

源自 v0.8.1 在 `ddt-team-admin-v0.8.1` 项目（reset 到 /design 之前）重跑后
暴露的 3 项缺陷，集中在 v0.5→v0.8 演进残留的双轨制冲突 + 解析器 fixture 偏差。
完整评审报告见会话讨论 + 代码评审。

### 🔴 P0 修复

🔴 **D15 EARS `As an` vowel-aware 兼容**（commit 1e9694d）
- v0.8.1 D5 修复了多策略匹配链但仍漏掉 `As an`（英语 vowel 前的正确语法）
- product-agent 实战按英语规范生成 `As an 运营经理`，让 D5 修复仍然 0 抽取
- 修复：单字符正则改动 `As a\s+` → `As an?\s+`
- 兼容 As a / As an 混用，不影响中文 EARS 与 markdown 表格策略

🔴 **D13 claude-design 通道语义统一**（commit 6f0c785）
- v0.5 留下的 tech-stack yaml 把 claude-design 描述为
  "Claude artifact / web-artifacts-builder 直接生成"（`requires_external: false`）
- 但 v0.8 引入的工作流（commands/design-execute.md + skills/ai-native-design）
  已将 claude-design 重新定位为 "外部 claude.ai/design 工具 → bundle/Handoff"
- 实战 ddt-team-admin-v0.8.1 暴露双轨制冲突：main thread 行为不一致
- 修复：tech-stack-presets.yaml + tech-stack-options.yaml 中
  `requires_external: false` → `claude.ai/design`，与 figma / v0 同语义

🔴 **D14 ingest-claude-design.mjs 加 --url 支持**（commit ef97506）
- v0.8 commands/design-execute.md 推荐 "Share → Handoff to Claude Code"
  作 claude-design (优选) 回贴方式，但 case 分支里 claude-design 不在 --url 列表
- 实战中 main thread 被迫手动 WebFetch + tar.gz 解压
- 修复：bin/ingest-claude-design.mjs 加 fetchBundleFromUrl
  - 仅 https:// 协议（拒 http / file / data）
  - SSRF 防御：localhost / 127.* / 10.* / 172.16-31.* / 192.168.* / 169.254.*
    （含 AWS metadata IP）/ IPv6 loopback / 私有 / 链接本地全部拒绝
  - 流式下载 100MB 体积上限 + Content-Length 预检（防压缩炸弹 / DoS）
  - magic bytes 校验：仅 1F8B (gzip) / 504B (zip)，其他扩展拒绝
  - 临时目录 mkdtempSync + 成功后清理（失败保留供调试）
- commands/design-execute.md::分支 C 加 claude-design 进 --url case

### 测试

- 339 → 351（+12 D14 测试 + 4 D15/D13 fixture）
- D14: 协议拒 http/file/非法 URL；SSRF 拒所有内部地址类型；spawn 集成测试
- D13: yaml claude-design::requires_external 必须 claude.ai；SKILL 一致性
- D15: As an + As a 混用 / 实战 PRD 完整格式（反引号 + 中文逗号）

### 设计

- v0.5→v0.8 演进留下的语义冲突这次集中清理（D13）
- W7.5 R10 的 zip slip 防御与本次 D14 的 SSRF 防御构成"摄取层完整安全栈"
- v0.8.1 测试 fixture 用 `As a` 让 D5 修复看似完整但实际有偏差（D15）——
  正是 v0.9-roadmap §B "fixtures 标准化基于真实 agent 产出" 要解决的根本问题

### 实战未触发但仍待处理（v0.9 候选）

ddt-team-admin-v0.8.1 实战还暴露了几个非紧急的架构层问题：
- **D16/D17**：progress.json::started_at 可靠性（事件溯源 vs 状态聚合的 sync 差）
- **D18**：blocker 格式分裂（硬 blocker 含 frontmatter / 软 blocker 仅列表）

这些不是 hotfix 范畴，作 v0.9-roadmap §A 流程可见性主线一并处理。

### 迁移指南（从 v0.8.1 → v0.8.2）

完全向后兼容，无 breaking change：
- 旧的 `As a` 格式 PRD 仍能解析
- 旧的 `--bundle <zip>` 摄取入口保留
- tech-stack.json 旧 ai_design 字段读取不变（仅 yaml 定义改语义）

升级方法：`/plugin marketplace update digital-delivery-team` →
`/plugin install digital-delivery-team@0.8.2`

---

## [0.8.1] - 2026-05-06 — 实战回归 hotfix：D1-D12 体系级断裂修复

源自 v0.8.0 在 `ddt-team-admin-v0.8` 项目（团队成员管理后台）跑端到端流程时
暴露的 12 项缺陷。完整评审报告见 `docs/v0.8-validation/review-report.md`。

集中在三个层面：状态机层与度量层不一致 / 隐式契约链断裂 / 解析器与外部数据格式脱节。

### 🔴 P0 体系修复

🔴 **D9 + D2 + D3 状态机层与度量层对齐**（commit 7126dae）
- `bin/progress.mjs::PHASE_ARTIFACTS` 加 `design-brief` / `design-execute`（与
  emit-phase VALID_PHASES 对齐，W7.5 R1 修复另一半）
- 引入 `'skipped'` 状态语义；`TERMINAL_STATUSES = {completed, skipped}` 统一
  current_phase 推进逻辑
- infer 时读取 `.ddt/tech-stack.json::frontend.type`：
  - `spa` → design-brief / design-execute 保持 pending
  - `server-side` / `none` → 自动 skipped，current_phase 跳到 build-web/build-api
- **连锁修复**：design-brief / design-execute 不再是"游离辅助命令"，新会话"继续"
  正确推到 design-brief 而非跳到 build-web

🔴 **D4 upload-package 兼容 claude.ai/design 上传白名单**（commit eba7388）
- 引入 `wrapAsMarkdown(srcPath, language, title)` 与 `copyOrWrapForUpload`
- claude-design / figma 通道把 `.yaml` / `.json` 源文件包装为 `.md`
  （内容仍是原始 yaml/json 但置于 ` ```yaml ` / ` ```json ` fenced block）
- v0 通道走 `v0-sources/` 程序化导入，保留原扩展不变
- **解决**：用户不再被迫手动给 `03-api-contract.yaml` 加 `.md` 后缀绕过平台限制

### 🟠 P1 修复

🟠 **D1 + D10 /design 按 frontend.type 分支建议下一步**（commit 167dad7）
- `commands/design.md::Phase 5` 不再硬编码 `/impl 或 /build-web`
- 按 `FRONT_TYPE` 分支：spa → /design-brief / server-side|none → /impl
- 显式标注 `frontend.type: <type>  来源 .ddt/tech-stack.json`（D10 透明化）

🟠 **D5 + D6 解析器健壮性**（commit cf23153）
- D5: `extractUserStories` 多策略匹配链——EARS 英文 / 中文 EARS / markdown 表格
  （通过表头识别列位置健壮于列顺序变化），首个产出 stories 的策略获胜
- D6: `parseVisualDirection` 结构化解析替代脆弱单行正则——支持 `tags` 中间字段
  + `>` / `|` block scalar 多行 rationale（逐行扫描遇缩进减少即停，符合 yaml
  block scalar 语义）
- isPlaceholder 在 strip `<>` 之前判定占位，兼容 W7.5 R8 的 `<选 1 个>` 案例

🟠 **D7 build-web 前置校验 brief**（commit a1989c6）
- `commands/build-web.md::Phase 1` 在 `frontend.type=spa` 时强校验
  `docs/design-brief.md` 存在
- 缺失时给出明确引导（`/design-brief → /design-execute`）
- 支持 `--skip-brief` 显式逃生口（少见场景：改回归既有项目）
- server-side / none 类型不强制（PR-E 三态语义对齐）

🟠 **D12 agent 失败重试 + blocker 上报**（commit 6e3283a）
- 新增 `bin/check-agent-output.mjs`：4 种产出异常 → 4 类退出码（缺失 / 截断 /
  含字面占位 `<persona>` `{{TOKEN}}` / 通过）
- `commands/{prd,wbs,design}.md` 在 Task 派发后必须调用此脚本，失败时写
  `docs/blockers.md` 让用户决策（重试 / 手动 fallback / 暂停）
- **不再 main thread 静默接管**——保留 agent 携带的专门 prompt 与历史校准

### 🟡🟢 P2/P3 修复

🟡 **D8 progress.json::started_at 落 null 修复**（与 D9 同 commit）
- `update --completed` 与 `infer` 跳到 terminal 状态时若 `started_at = null`
  自动回填同一时刻 + `duration_estimated: true` 标记
- aggregate 度量层可单独识别估算记录避免污染基线

🟡 **D10 frontend.type sentinel 来源透明**（与 D1 同 commit）
- design.md Phase 5 输出显式标注 `frontend.type` 来源 `.ddt/tech-stack.json`

🟢 **D11 项目根 .gitignore 兜底模板**（commit 26c44c1）
- 新增 `templates/.gitignore.template` 含 `Untitled` / `.DS_Store` /
  `.ddt/locks/` / `staging/` / `node_modules/` 等典型派生物
- `aggregate.mjs --bootstrap` 自动落入项目根：无 `.gitignore` 直接复制；
  已有则追加缺失行（不重复，不破坏用户自定义）

### 测试

- 304 → 335（+31 回归测试覆盖 D1-D12 全部修复点）
- D5: 中文 EARS / markdown 表格 / 列顺序变化 / 跳过 placeholder 行 / 三策略不重复
- D6: tags 中间字段 + `>` 多行 / `|` block scalar / 单行不退化
- D9: spa 保持 pending / server-side 自动 skipped / none 自动 skipped 三态覆盖
- D12: 6 种产出异常 → 4 类退出码 + commands 契约
- W7.5 R1-R12 全部 +63 回归用例不退化

### 设计

- 评审报告 `docs/v0.8-validation/review-report.md`：12 项缺陷的根因分析、
  修复方案与体系级反思（"度量层 vs 状态机层"裂缝 / 隐式契约链可见性 /
  解析器边界假设）

### 迁移指南（从 v0.8.0 → v0.8.1）

完全向后兼容，无 breaking change：
- progress.json 旧 schema 仍可读，--infer 会主动填充 design-brief / design-execute
  字段
- 已派生的 upload-package 会在下次 `/design-execute --refresh` 时改名（无需手动迁移）
- 旧 brief 的 visual_direction yaml 块仍可解析（单行 / 多行均兼容）

升级方法：`/plugin marketplace update digital-delivery-team` →
`/plugin install digital-delivery-team@0.8.1`，无需修改既有项目数据。

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
