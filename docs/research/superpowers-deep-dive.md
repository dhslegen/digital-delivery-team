# Superpowers 深度调研报告

> 调研对象：[obra/superpowers](https://github.com/obra/superpowers) v5.1.0
> 调研对标：DDT v0.9.20（ROADMAP M1 实战闭环阶段）
> 报告日期：2026-05-13
> 调研目的：对标标杆级竞品，提炼可借鉴的设计思想与机制，回应 B 级评价后的下一步演进

---

## TL;DR

Superpowers 与 DDT 是**两个截然不同的技术哲学**：

| 维度 | DDT | Superpowers |
|------|-----|-------------|
| **形态** | 命令编排平台（21 commands × 9 agents × 36 bin） | 纯能力库（14 skills × 1 hook） |
| **触发** | 用户显式 `/design`、`/build-api` | LLM 自治触发（Skill 工具 + SessionStart 注入） |
| **目标域** | 数字化交付（行业特化） | 通用软件工程（行业中立） |
| **多 harness** | 仅 Claude Code | Claude / Codex / Gemini / OpenCode / Cursor / Copilot 全覆盖 |
| **依赖** | better-sqlite3、openapi-typescript、yaml 等 | **零运行时依赖**（设计原则） |
| **价值主张** | 三通道 SSoT + 6-phase 范式 + 度量闭环 | TDD + 系统化调试 + Subagent 编排 |

**核心结论**：Superpowers 不是 DDT 的"上位替代"，而是 DDT 的**互补型参考标杆**——它解决"工程纪律"层（Discipline Layer），DDT 解决"交付流程"层（Delivery Layer）。**最值得借鉴的不是它的 skill 内容，而是它锻造 skill 内容的方法论**：CSO、Rationalization 表、Iron Law、Subagent 三角架构、TDD-for-Skills。

> Insight：Superpowers 的精髓在 `writing-skills/SKILL.md`——它把"如何写 skill"本身当成 TDD 测试对象：先用 subagent 跑出 RED 基线（agent 不遵守某规则的真实理由），再写 skill 把每个理由"堵死"。这是把 prompt 工程升级为 **prompt-as-tested-code** 的工程范式。
>
> DDT 当前的 13 个 skill 全是经验性沉淀，未经过 superpowers 这种"对抗性压力测试"。这是 B 级评价里"演示导向"的一个隐藏成因——skill 文本对 LLM 实际行为的约束力未被测过。

---

## 一、项目全貌（量化体检）

```
superpowers/
├── skills/                  # 14 个 skill（核心资产）
│   ├── using-superpowers/   # 元-skill：教 LLM 如何用 skill
│   ├── writing-skills/      # 元-skill：教 LLM 如何写 skill（含 TDD 方法论）
│   ├── brainstorming/       # 流程：原始需求 → spec
│   ├── writing-plans/       # 流程：spec → bite-sized plan
│   ├── subagent-driven-development/  # 编排：implementer + 双段 reviewer
│   ├── executing-plans/     # 编排（无 subagent fallback）
│   ├── dispatching-parallel-agents/  # 编排：并行独立任务
│   ├── test-driven-development/      # 纪律：RED-GREEN-REFACTOR
│   ├── systematic-debugging/         # 纪律：4 阶段 + 架构质疑
│   ├── verification-before-completion/  # 纪律：声明前必须有证据
│   ├── using-git-worktrees/          # 工具：隔离工作空间
│   ├── finishing-a-development-branch/  # 工具：合并/PR/丢弃决策
│   ├── requesting-code-review/       # 工具：dispatching review subagent
│   └── receiving-code-review/        # 工具：回应 review
├── hooks/
│   ├── hooks.json           # 仅 1 个 hook：SessionStart
│   └── session-start        # bash 脚本：注入 using-superpowers 全文
├── scripts/
│   ├── bump-version.sh
│   └── sync-to-codex-plugin.sh  # 多 harness 同步逻辑（15KB）
└── docs/
    ├── superpowers/
    │   ├── specs/           # 5 份历史 spec（118-342 行）
    │   └── plans/           # 5 份历史 plan（301-879 行）
    └── testing.md           # 整体测试方法论
```

**对比 DDT**：

| 资产 | DDT | Superpowers | 备注 |
|------|-----|-------------|------|
| Skills | 13 | 14 | 接近 |
| Commands | 21 | **0** | DDT 独有 |
| Agents | 9 | **0**（用 subagent prompt template 替代） | 范式差异 |
| Hooks | 多种（含度量埋点） | 仅 SessionStart | DDT 重 |
| Bin 脚本 | 36 | 2（都是 meta） | DDT 重 |
| Tests | 548 | 7 个 test dir（多为 shell 集成测试） | DDT 重 |
| 设计 docs | brief / OpenAPI / facts | spec + plan 双层 | 范式差异 |

---

## 二、设计思想（5 条核心信条）

### 2.1 信条一：Skill 优先于一切

`using-superpowers/SKILL.md` 是整个系统的"宪法"。它通过 SessionStart hook **无条件注入到每个会话首条 system prompt 里**，规定了三条铁律：

```
1. 若有 1% 可能某 skill 适用 → 必须先调 Skill 工具
2. Skill 优先级覆盖默认 system prompt（但低于用户 CLAUDE.md）
3. 启动任何回应前先 announce: "Using [skill] to [purpose]"
```

**机制要点**：description 字段**严禁包含工作流摘要**，只能写"Use when..." 触发条件。原因：作者团队测试发现，description 写工作流后，Claude 会用 description 当"快捷答案"，跳过 skill 主体。这是从对抗性测试中提炼的**反捷径设计**。

> 真实证据：`writing-skills/SKILL.md` 直接给出反例——`description: dispatches subagent per task with code review` 让 Claude 只做一次 review，但 skill 本体明明写了两次 review。

### 2.2 信条二：TDD 是元规则，连 skill 自己也要 TDD

```
NO PRODUCTION CODE WITHOUT A FAILING TEST FIRST  ← 适用于代码
NO SKILL WITHOUT A FAILING TEST FIRST            ← 同样适用于 skill 自己
```

`writing-skills` 把 TDD 直接映射到 skill 创作：

| TDD 概念 | Skill 创作映射 |
|----------|---------------|
| 测试用例 | Subagent 压力场景（多压力组合） |
| RED（失败） | Subagent 无 skill 时违反规则的实录 |
| 生产代码 | SKILL.md 文档 |
| GREEN | Subagent 有 skill 时遵守规则 |
| REFACTOR | 发现新合理化借口 → 加反驳条目 → 再测 |

**Iron Law 是 superpowers 的标志性表达**：

```
NO PRODUCTION CODE WITHOUT A FAILING TEST FIRST
NO FIXES WITHOUT ROOT CAUSE INVESTIGATION FIRST
NO COMPLETION CLAIMS WITHOUT FRESH VERIFICATION EVIDENCE
NO SKILL WITHOUT A FAILING TEST FIRST
```

每条 Iron Law 都有专门的"Common Rationalizations 表"和"Red Flags 列表"——LLM 内心 OS 的每种"自我开脱话术"都被预先反驳。

### 2.3 信条三：纯能力库 + 自治触发 ≠ 编排平台

**Superpowers 没有 commands，没有 agents**。它认为：
- 命令是"用户教会 LLM 怎么做"的产物——增加 UX 摩擦
- Agent 是 commands 的封装态——同样的摩擦
- 真正的能力是 **LLM 看到合适场景能自动 reach for the right tool**

DDT 是反向选择：因为交付场景需要**显式审批节点**（如 `/approve` 切阶段），命令是 SSoT 治理的一部分。两种选择都对，**但 superpowers 比 DDT 更靠近 LLM 自治极限**。

### 2.4 信条四：Subagent 是 first-class primitive

`subagent-driven-development` 把传统"agent = 工具"提升为"agent = 一次性专业工人"：

```
Controller（你）：
  ├── 读 plan，提取所有任务全文
  ├── for each task:
  │   ├── dispatch Implementer subagent（不让它读 plan，喂全文）
  │   ├── dispatch Spec Reviewer subagent（独立校 spec 一致性）
  │   ├── dispatch Code Quality Reviewer subagent（独立校代码质量）
  │   └── 任何 reviewer 不过 → 让 Implementer 修 → 再 review
  └── dispatch Final Code Reviewer subagent（review 全部 commit）
```

**核心洞察**：subagent 应该**从不继承 Controller 的会话上下文**——Controller 精确构造它需要的全部信息。这与 DDT agents 当前作为"专精角色"的用法本质不同：superpowers 的 agent 不是"专家"，而是"一次性、可丢弃、完全替换"的执行单元。

### 2.5 信条五：Evidence > Confidence > Convention

`verification-before-completion`：

```
BEFORE 声明完成：
  1. IDENTIFY 哪条命令能证明这个声明
  2. RUN 完整命令（fresh，不是回忆）
  3. READ 完整输出 + 退出码 + 失败数
  4. VERIFY 输出是否真的支撑声明
  5. ONLY THEN 做声明
```

把"我以为它过了"列为**说谎，不是高效**——这条对 DDT 的"演示导向"反模式（B 级评价根因）正面针对。

---

## 三、核心机制详解（5 个机制）

### 3.1 机制一：SessionStart Hook 的"魔法"

`hooks/session-start`（57 行 bash）做了一件极简单又极聪明的事：

```bash
# 1. 读取 using-superpowers/SKILL.md 全文
# 2. 用 JSON escape（手写 bash 参数替换，无 jq 依赖）
# 3. 包成 <EXTREMELY_IMPORTANT>...</EXTREMELY_IMPORTANT>
# 4. 根据环境变量分别输出三种 JSON 格式：
#    - Cursor: additional_context（snake_case）
#    - Claude Code: hookSpecificOutput.additionalContext（嵌套）
#    - Copilot: additionalContext（SDK 标准）
```

**为什么这是核心机制**：所有 14 个 skill 之所以能自动触发，靠的就是这段 hook 在会话首条 message 注入"宪法"。**离开这个 hook，superpowers 就是一堆死在磁盘上的 markdown**。

AGENTS.md 明确写："如果不知道你的集成有没有在 SessionStart 加载 bootstrap，那就是没有。"——这是 superpowers 接收新 harness PR 的**唯一硬验收点**。

> DDT 启示：DDT 当前的 SessionStart hook 主要做度量（D34），但**没有把核心 skill 像 superpowers 这样作为"宪法"注入**。如果 DDT 想让 13 个 skill 真正影响 LLM 行为，可以借鉴此模式注入一份"DDT-Charter"。

### 3.2 机制二：CSO（Claude Search Optimization）

`writing-skills/SKILL.md` 系统化了一套"让 LLM 能找到 skill"的元规则：

1. **Description ≠ Summary**：只写触发条件，不写工作流（防止 LLM 跳过 body）
2. **Keyword 覆盖**：错误信息、症状、同义词、工具名都要塞进 body（用 Claude 真实搜索词）
3. **命名用动词起首**：`condition-based-waiting` > `async-test-helpers`；`creating-skills` > `skill-creation`
4. **Token 经济**：getting-started 类 < 150 词；常加载类 < 200 词；其他 < 500 词
5. **跨引用用 `[[name]]` 不用 `@`**：`@` 会立即加载消耗 200k+ context

这套规约可以**直接套用到 DDT 13 个 skill**——目测多数 skill description 当前是"做什么"而非"何时用"。

### 3.3 机制三：Subagent 三角架构

```
                Controller (主 LLM)
                       │
            ┌──────────┼──────────┐
            ▼          ▼          ▼
        Implementer  Spec        Code Quality
        Subagent     Reviewer    Reviewer
                     Subagent    Subagent
                     (校 spec)   (校质量)
```

三个 subagent **从不互相对话**，只通过 Controller 间接传递。`subagent-driven-development` 还配套 3 份 prompt template：
- `implementer-prompt.md`
- `spec-reviewer-prompt.md`
- `code-quality-reviewer-prompt.md`

实施者有 4 种可声明状态（DONE / DONE_WITH_CONCERNS / NEEDS_CONTEXT / BLOCKED），Controller 各有处理策略。

**模型分级建议**：
- 机械实施（1-2 文件，规格清晰）→ 快/便宜模型
- 集成判断（多文件协同）→ 标准模型
- 架构/设计/审查 → 最强模型

> DDT 启示：当前 9 个 agent（product / pm / architect / design-brief / docs / test / review / fix / metrics）实质是"专精角色"，但它们继承 Controller 上下文，本质上是"扩展提示"。如果改造为 subagent-prompt-template + 三角审查模式，IMPLEMENT 阶段的产物质量会显著提升。

### 3.4 机制四：Rationalization Tables + Red Flags

每个纪律性 skill 都有**两张配套表**：

**Rationalization Table（合理化借口反驳表）**：

| 借口 | 反驳 |
|------|------|
| "太简单不需要测" | 简单代码也会坏，测试 30 秒 |
| "测后再写也一样" | 测后 = 测"它做了什么"；测前 = 测"它应该做什么" |
| "都手测过了" | Ad-hoc ≠ 系统化；改了之后还得再测一遍 |
| "已花 X 小时，删了浪费" | 沉没成本谬误，留着无法信任的代码是技术债 |

**Red Flags（自查清单）**：
```
- "Code before test"
- "Test passes immediately"
- "Tests added later"
- "Just this once"
- "It's about spirit not ritual"

→ 全部意味着：删代码，重新 TDD 开始
```

**核心机制**：这两张表是**对抗性测试**的副产品——从真实 subagent 在压力场景下吐出的借口里凝结而来。新 skill 测试时如果发现新借口，必须加进表里。

> DDT 启示：DDT 的反模式（"温柔的乐观"、"演示前救火"）目前只在 CHANGELOG 里有零散记录，没有沉淀成"Rationalization 表"。这是 D34/D35/D36 留下的金矿，可以反哺成 DDT 自己的 skill 强化语料。

### 3.5 机制五：Spec + Plan 双层分离

```
brainstorming → docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md
               ↓
writing-plans → docs/superpowers/plans/YYYY-MM-DD-<feature>.md
               ↓
subagent-driven-development（执行）
```

**Spec 层**（118-342 行）：设计文档，"是什么"+"为什么"
**Plan 层**（301-879 行）：实施计划，"怎么做"+"每个 2-5 分钟的 step"

Plan 模板的关键约束：

```
× "TBD" / "TODO" / "implement later"
× "Add appropriate error handling" / "handle edge cases"（笼统占位）
× "Write tests for the above"（没给测试代码）
× "Similar to Task N"（必须重复代码，因 engineer 可能跳读）
× 引用未定义的类型/函数/方法
× 描述"做什么"但没给"怎么做"
```

**Plan = 把"零品味、零项目背景、不爱写测试"的 junior 当读者**——每一步都要有完整代码、明确路径、可执行命令。

> DDT 启示：DDT 的 `wbs.md` 和 PRD 大致对应这两层，但 plan 粒度对照 superpowers 还不够"bite-sized"——典型 DDT plan 可能是"做 X 模块"，superpowers 会拆成"写 X 模块的失败测试 / 运行确认失败 / 写最小实现 / 运行确认通过 / commit"5 步。M2 SLO 99% 阶段需要这种粒度。

---

## 四、可借鉴的通用能力（按 ROI 排序）

### P0（即刻可注入 DDT，几乎无副作用）

**1. CSO 元规约 → 写进 DDT skills/skill-writer（如果有）或新增**

DDT 13 个 skill 的 description 大概率有"动作描述"成分。把 superpowers CSO 规约（"Use when..." 起首、禁 workflow summary、关键词覆盖）抄到 DDT 自己的 skill-writer skill 里，再回头校准所有 13 个 skill。**预期收益**：skill 触发率上升，LLM 跳过几率下降。

**2. Iron Law 模式 → 用在 6-phase 关键节点**

DDT 已经有 hard requirement 机制（如 docs-agent 的 5 条），但缺 superpowers 那种**"绝对化 + 反驳表 + Red Flags"三件套**。建议给三个最易被 LLM 跳过的节点加 Iron Law：

```
EXPLORE → APPROVE：NO IMPLEMENTATION WITHOUT USER APPROVAL
PLAN：NO TASK STARTING WITHOUT bite-sized DECOMPOSITION
VERIFY：NO COMPLETION CLAIMS WITHOUT FRESH EVIDENCE
```

**3. Rationalization 表 → 把 CHANGELOG 反模式语料结构化**

D34/D35/D36 各暴露了一组 LLM 反模式（"hook 单源够了"、"默认值能跑就行"、"actuator 应该自带"）。把这些做成表格写入 DDT 的 backend-development / delivery-package skill。

### P1（中期改造，需评估）

**4. Subagent 三角架构 → 重构 DDT 9 agents**

把当前 docs-agent / review-agent / test-agent / fix-agent 等改造为 **subagent prompt template**，让 controller LLM 在 `/package`、`/review`、`/test` 命令里 dispatch 它们而不是直接套用。**关键收益**：context 隔离、可并行、可三角审查。但需要重写 9 个 agent。

**5. Brainstorming → 作为 /design 的可选前置 Phase 0**

DDT 的 /design-brief 已经是结构化产物，但缺一个 **socratic dialog 阶段**（"用户说想做 X，先一问一答把模糊点都问清楚再落 spec"）。这正是 superpowers brainstorming 的核心价值。可以作为 `/design --interactive` 模式提供。

**6. Plan 模板"bite-sized"约束 → 注入 pm-agent**

把 superpowers `writing-plans/SKILL.md` 的 "No Placeholders" 段抄成 DDT 自己的 plan 规约，强制 pm-agent 输出每个 task 都有完整代码 + 明确路径 + 可执行命令。

### P2（长期演进，与 DDT 战略相关）

**7. 多 harness 适配 → 学 sync-to-codex-plugin.sh + AGENTS.md / GEMINI.md / .opencode/ / .cursor-plugin/ 同构布局**

如果 DDT M3/M4 想拓展到 Codex / Gemini 用户，superpowers 的"一套 skill 多 harness 加载"范式是现成的。**前置条件**：把 DDT 命令分成"行业流程"（仍用 slash command）和"通用能力"（迁移到 skill 形态）。

**8. TDD-for-Skills → 给 DDT skill 加压力测试**

`writing-skills/testing-skills-with-subagents.md` 是 superpowers 最有趣的元能力——用 subagent 在"无压力 / 时间压 / 沉没成本压 / 权威压 / 疲劳压"5 种压力下跑同一场景，记录 LLM 真实反应，再针对反应迭代 skill 文本。这条路径对 DDT 的 13 个 skill 是**真正的质量提升手段**，但实施成本高（每个 skill 至少 3 个压力场景 × 多次 subagent 运行）。

---

## 五、对 DDT 愿景与目标的帮助

### 5.1 直击 B 级评价根因

| B 级评价潜台词 | Superpowers 对应解药 |
|---------------|---------------------|
| "演示导向，未真正闭环" | `verification-before-completion` Iron Law |
| "LLM 跳过命令" | CSO + SessionStart 宪法注入 |
| "skill 写完没人验证" | TDD-for-Skills 方法论 |
| "alv-ops 36 次救火" | Rationalization 表 + Red Flags 沉淀 |
| "没跑出高可用" | Subagent 三角架构（双段审查） |

### 5.2 与 DDT ROADMAP 的契合度

- **M1 实战闭环**（当前）：可立即引入 P0 三项（CSO / Iron Law / Rationalization 表）
- **M2 生产就绪**：可引入 P1 三项（Subagent 三角 / Brainstorming / Plan bite-sized）
- **M3 团队协作**：考虑多 harness 同步范式
- **M4 行业落地**：考虑 DDT Core vs DDT Industry 分层（Core 向 superpowers 看齐）

### 5.3 哲学共振与分歧

**共振**：

| 维度 | DDT | Superpowers |
|------|-----|-------------|
| 反 LLM 脆弱 | D34 hook 双源 / 部署 facts 采集 | Rationalization 表 / Iron Law |
| Hook 兜底 | SessionStart 度量 | SessionStart 宪法注入 |
| 事实驱动 | 三件套 SSoT | "Evidence before claims" |
| 反"温柔乐观" | D35 显式校验 + 友好降级 | 反"This should work" |

**分歧（不是优劣，是定位差异）**：

| 维度 | DDT | Superpowers |
|------|-----|-------------|
| 编排粒度 | slash command 显式审批节点 | skill 自治触发 |
| 行业绑定 | 数字化交付特化（OpenAPI / 部署 facts） | 行业中立 |
| 复杂度策略 | 重型工具堆叠（36 bin + better-sqlite3） | zero-dependency 极简 |
| 维护守门 | 单人主导，按需迭代 | 94% PR 拒绝率，强守门 |

---

## 六、风险提示

### 6.1 不要照搬

Superpowers 的零依赖、纯能力库形态**不适合 DDT 的目标客户**。数字化交付需要"流程治理 + 度量 + SSoT"，这些都需要 bin 脚本和 commands。**借鉴 superpowers 的方法论（怎么写 skill / 怎么编排 subagent），而非它的形态**。

### 6.2 守门成本要算清

Superpowers 94% PR 拒绝率背后是 Jesse Vincent 一人维护 + 强大社区压力测试。DDT 如果引入 TDD-for-Skills，每个 skill 改动都要跑压力测试——这意味着 v0.9.x 那种"快速迭代发版"节奏要慢下来。**建议在 M2 SLO 99% 阶段才开始引入此严格度**。

### 6.3 不要把 DDT 9 agents 一次性废弃

P1 建议的"agents → subagent prompt template"是大改。如果一次性做，会破坏所有现存命令的工作流。建议**先在一个 agent 上试点**（推荐 review-agent，因 superpowers 双段审查正好覆盖此场景），跑通后再扩展。

### 6.4 中文翻译陷阱

Superpowers 大量使用"your human partner"这种**精心调过的称谓**（AGENTS.md 明确说不可换成"user"）。如果直接翻译进 DDT 中文 skill，可能丢掉行为塑造效果。**保留原文术语，或本土化时配套做对抗性测试**。

---

## 七、推荐的下一步动作（4 选 1）

按"对 ROADMAP M1 帮助 × 实施成本"评分：

| 动作 | 帮助 | 成本 | 推荐度 |
|------|------|------|--------|
| **(A)** 把 CSO + Iron Law + Rationalization 表抄进 DDT skill-writer，回头校准 13 个 skill | ★★★★ | ★★ | **首选** |
| (B) 给 docs-agent + review-agent 加 Iron Law + Rationalization 表 | ★★★ | ★ | 短平快 |
| (C) 在 alv-ops M1 W1 D1 启动后，把首个 IMPLEMENT 阶段改用 subagent 三角架构试跑 | ★★★★★ | ★★★★ | 高风险高回报 |
| (D) 起草一份"DDT Skill 写作元规约"docs/SKILL-AUTHORING.md，作为 v1.0 前的质量门槛 | ★★★ | ★★ | 长期价值 |

---

## 附录：原始引用索引

- `superpowers/CLAUDE.md` / `AGENTS.md`（贡献者守则 + 反 AI slop 防线）
- `superpowers/skills/using-superpowers/SKILL.md`（宪法）
- `superpowers/skills/writing-skills/SKILL.md`（CSO / TDD-for-Skills / Bulletproofing）
- `superpowers/skills/test-driven-development/SKILL.md`（Iron Law + Rationalization 表样板）
- `superpowers/skills/systematic-debugging/SKILL.md`（4 阶段 + 3 次失败 = 架构问题）
- `superpowers/skills/verification-before-completion/SKILL.md`（声明前 5 步证据门）
- `superpowers/skills/subagent-driven-development/SKILL.md`（三角架构 + 4 种状态处理）
- `superpowers/skills/writing-plans/SKILL.md`（bite-sized + No Placeholders）
- `superpowers/skills/brainstorming/SKILL.md`（HARD-GATE 设计批准前不实施）
- `superpowers/hooks/session-start`（57 行 bash，多 harness JSON 输出）
- `superpowers/docs/superpowers/specs/2026-04-06-worktree-rototill-design.md`（最新 spec 样本）
- `superpowers/docs/superpowers/plans/2026-04-06-worktree-rototill.md`（879 行真实 plan 样本）

---

## 元洞察

- **Superpowers 的真正护城河不是 14 个 skill 内容，而是"如何持续改进这 14 个 skill"的元方法论**——SessionStart 注入 + CSO + TDD-for-Skills + Rationalization 表四件套，构成一个自我增强的飞轮。DDT 想从 B 级走向 A 级，最稀缺的不是更多 bin/ 脚本，而是这套"对 LLM 行为做压力测试"的元能力。
- **DDT 与 superpowers 是补，不是替**。DDT 解决"数字化交付场景的流程治理"，superpowers 解决"任何 coding agent 的工程纪律"。最佳形态可能是：DDT 借 superpowers 加固自己的 skill 层（纪律层），同时保留命令/agent/bin 层（流程层）。
- **从领导 B 级评价回看**：评价不是说 DDT 工具不行，而是说"在真实生产场景里没跑出高可用闭环"。superpowers 的 Iron Law + Verification + Subagent 三角恰恰是把"声明 → 证据"链条压短的工具。M1 阶段先在一个 alv-ops 任务上试跑 subagent 三角（C 选项），可能比改 36 个 bin 脚本对评价的反转更大。
