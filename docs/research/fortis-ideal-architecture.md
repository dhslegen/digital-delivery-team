# Fortis：行业特化 AI 编程插件的理想形态

> 视角：完全脱离 DDT 现状束缚 · 从第一性原理出发
> 借鉴对象：ECC（基础设施层）+ superpowers（工程纪律层）+ DDT（行业流程层）
> 立场：以三者各自的**致命缺陷**反推理想架构
> 日期：2026-05-15

---

## 一、先问对的问题

行业内大部分讨论问的是"AI 编程怎么改进 DDT/superpowers/ECC"。**这是错的问题**。

对的问题是：

> 企业把 LLM 用进交付流程，**根本困难有几层？每一层最合适的解法是什么？现有三大工具各自在哪一层失败了？**

回答清楚这个，才能定义理想形态。

---

## 二、三层根本困境

### 困境一：LLM 不可信任（行为层）

LLM 会**行为漂移**：

- 改写命令模板砍埋点（DDT D34 真实暴露）
- 把"温柔的乐观"当默认（DDT D35 真实暴露）
- 凭常识填密码/端口（DDT D36 真实暴露）
- 跳过 review、跳过测试（superpowers 整本 SKILL.md 在反复堵这个）

**这一层的本质是：LLM 不是被指令"控制"的，是被 prompt 文本"建议"的——而建议总能被合理化掉。**

### 困境二：交付是协作流程（流程层）

企业交付不是"一个工程师写代码"，是：

- 多角色（PM/架构/前端/后端/测试/部署/客户）
- 多阶段（需求/设计/实现/验证/部署/复盘）
- 多事实源（API 契约/技术栈/部署事实/客户验收）
- 多审批节点（设计批准/合规审查/上线放行）

**LLM 在这一层不是主角，是被编排的工人之一。**

### 困境三：行业 know-how 难以传承（知识层）

数字化交付、金融合规、医疗 EMR、车联网——每个行业有自己的 SOP，**这些 SOP 是非 LLM 训练数据能覆盖的稀缺知识**。

把这些 know-how 编码成"LLM 可执行的纪律"，是行业特化插件存在的**唯一正当性**。

---

## 三、三个观察对象在哪一层失败了

| 工具 | 占的层 | 占住的优势 | **致命缺陷** |
|------|--------|-----------|-------------|
| **superpowers** | 行为层 | TDD 元方法论、CSO、Iron Law | **明确拒绝行业特化**（章程硬规则），无法解决困境二、三 |
| **ECC** | 流程层（基础设施） | Rust 单二进制、三层架构、多 agent 编排、daemon 持久化 | **无工程纪律**，116 skill 堆砌失序；流程层只提供基建，没有业务流 |
| **DDT** | 流程层（业务流）+ 知识层 | 6-phase、SSoT、度量、行业特化 | **全靠 markdown + bash 编排**，约束力靠 LLM 自觉；困境一基本未解 |

**关键观察**：三者**各自占了一层、各自漏了别人占的层**——不是"功能差异"，是**架构层次差异**。

**这意味着理想形态不是三选一，也不是三个拼接，而是 "三层各自做对、彼此正交"**。

---

## 四、产品定义

- **名字**：暂称 **Fortis**（拉丁语：坚固、可靠 — 不绑定中文，留全球化空间）
- **完整定位**：**Industry Flow Platform for AI-Native Engineering**
- **Slogan**：**把行业 SOP 编译为 LLM 必须遵守的运行时约束。**

注意三个词：**编译**（不是写在 markdown 里）、**必须**（不是建议）、**运行时**（不是设计时）。这三个词是 Fortis 与 DDT/superpowers/ECC 的核心区别。

---

## 五、架构：三层四面

```
┌─────────────────────────────────────────────────────────────┐
│                     Application Layer                        │
│                                                              │
│   Industry Templates  ·  Slash Commands  ·  Approval Gates  │  ← 用户面
│   (用户看到的 / 调用的部分)                                  │
│                                                              │
├─────────────────────────────────────────────────────────────┤
│                     Discipline Layer                         │
│                                                              │
│   Skills · Iron Laws · Rationalization Tables · Subagents   │  ← LLM 面
│   SessionStart Charter Injection · CSO · TDD-for-Skills     │
│   (LLM 看到的 / 被约束的部分)                                │
│                                                              │
├─────────────────────────────────────────────────────────────┤
│                     Runtime Layer                            │
│                                                              │
│   SSoT Store · Phase Bus · Metric Aggregator · Audit Trail  │  ← 系统面
│   Per-Project Mutex · Lifecycle Hooks · Workspace Daemon    │
│   AgentShield (安全) · Industry Compiler                     │
│   (代码看到的 / 不可变的部分)                                │
│                                                              │
└─────────────────────────────────────────────────────────────┘
                              ┃
        ┏━━━━━━━━━━━━━━━━━━━━━╋━━━━━━━━━━━━━━━━━━━━━┓
        ▼                     ▼                     ▼

   Multi-Harness         Industry Packs        Observability   ← 四面
   一套核心多端跑        车联网/金融/医疗      Grafana/告警       横切
   Claude/Codex/         即插即用              度量看板
   Gemini/Cursor         (Industry Compiler)
```

**三层（垂直）+ 四面（横切，每层都贯通）**：

- **三层**清晰对应三个困境：行为层 / 流程层 / 知识层（行业模板编译进 Discipline + Runtime）
- **四面**是平台化能力：Multi-Harness 跨端 / Industry Pack 行业模板 / Observability 可观测 / Security 安全审计

---

## 六、十条关键架构决策

每条决策都要回答"为什么这样决，否则会犯什么错"。

### 决策 1｜Skill 是一等公民，命令只是 Skill 的视图

**怎么做**：

- 所有能力以 Skill 为基本单位
- Slash command 是 Skill 在特定 harness（如 Claude Code）下的"语法糖"
- LLM 自治触发（superpowers 模式）+ 用户显式触发（DDT 模式）**并存**

**不这样做会怎样**：DDT 现状——命令是一等公民，skill 是附属，导致 LLM 跳过 skill 直接执行命令，约束失效。

### 决策 2｜SSoT 是平台原语，不是某命令的副产物

**怎么做**：

- Runtime Layer 提供 `SSoT Store`（基于 SQLite 的事件溯源）
- 三类核心 SSoT：API Contract / Tech Stack / Deployment Facts（DDT 已识别）
- Industry Pack 可注册新的 SSoT 类型（金融加合规事实、医疗加 PHI 事实）
- 所有 agent/skill 通过 Store API 读写，**禁止直接读 yaml 文件**

**不这样做会怎样**：DDT 现状——SSoT 散落在 `docs/*.yaml`，每个 agent 自己 parse，发生过 D32 那种"contract-summary 字段不一致"事故。

> **架构师注**：这条决策是把"事实"从**文件系统**升级为**有 schema 的数据库**。后果：所有"读契约"操作必须过同一个 API，schema 演化可控，事件溯源天然支持"v0.9 → v1.0 之间契约变化了什么"这类审计 query。
>
> 这是 DDT 现状最大的隐藏债务——SSoT 概念是对的，但实现仍是裸 yaml，每次新增字段都引爆下游 agent。

### 决策 3｜Phase 是事件流，不是命令的副作用

**怎么做**：

- Runtime Layer 提供 `Phase Bus`（类 Kafka 的微缩版，本地 SQLite + 长轮询）
- 任何 actor（用户、agent、subagent、hook）emit 事件到 Bus
- 度量、审批、回滚都**订阅** Bus，不直接调命令

**不这样做会怎样**：DDT 现状——`phase_runs` 表靠 `emit-phase` 命令显式埋点，LLM 一改写就丢失（D34 真实事故）。

### 决策 4｜Subagent 是平台原语，分四类不重叠

**怎么做**：

- **Implementer 实施者**：写代码
- **Reviewer 审查者**：分三种子类（Spec / Quality / Security）
- **Observer 观察者**：纯只读，做度量与审计
- **Negotiator 协商者**：与用户对话（brainstorming 等场景）

四类**职责正交，从不混角色**。Subagent Registry 集中注册，模型分级自动选择。

**不这样做会怎样**：DDT 9 agent 当前角色边界模糊（docs-agent 既写文档又审查）；superpowers 三角架构已经识别 Spec/Quality 分离，Fortis 再加一层 Security 和 Observer。

### 决策 5｜Iron Law 进 Runtime，不再是文本约束

**怎么做**：

- Iron Law 在 Runtime Layer 实现为**拦截器**
- 例：`NO COMPLETION WITHOUT EVIDENCE` 拦截所有 `TaskComplete` 类工具调用，强制要求附 `verification_evidence_id`
- LLM 试图跳过？Runtime 返回错误，不执行

**不这样做会怎样**：superpowers Iron Law 写得很美，但本质还是 prompt 文本——LLM 在压力下仍会合理化。Fortis 把它升级为**不可绕过的拦截器**。

### 决策 6｜Rationalization 是运行时探测器，不是静态文档

**怎么做**：

- 每个反模式（"温柔的乐观"、"hook 单源够了"、"actuator 应该自带"）是 SQLite 表里一条记录
- Observer subagent 实时扫描 LLM 输出，命中模式 → emit warning event
- 命中阈值 → 强制 break + 要求人工介入

**不这样做会怎样**：superpowers Rationalization 表是静态文本（人去查表），Fortis 把它升级为**自动检测器**。

### 决策 7｜Industry Pack 热插拔、有显式 DSL

**怎么做**：

一个 Industry Pack 由领域专家维护，包含：

- `pack.yaml`（声明 pack 元数据）
- `phases/*.yaml`（行业特有 phase 定义，如金融"合规审查"phase）
- `ssot-schemas/*.yaml`（行业特有 SSoT schema）
- `audit-rules/*.yaml`（行业特有审计规则）
- `templates/`（PRD/WBS/部署清单模板）
- `skills/`（行业特有 skill）

用户 `fortis pack install automotive-iov` → 装一个"车联网行业 SOP DSL 解释器"。

**不这样做会怎样**：DDT 现状——行业 know-how 散在 21 命令里，无法增删行业。Fortis 让"行业"成为一等公民。

### 决策 8｜度量是被动收集，零埋点

**怎么做**：

- 所有 phase 事件、subagent 调用、工具调用**自动落 Audit Trail**
- 度量报告是事后 query（`SELECT ... FROM phase_runs WHERE ...`）
- **完全不依赖**任何 `emit-metric` 命令

**不这样做会怎样**：DDT D34 事故的根因消失——LLM 改写命令模板再多次，Runtime Layer 仍然完整记录。

### 决策 9｜自演进是设计目标，不是后期补丁

**怎么做**：

借鉴 ECC `continuous-learning-v2` + superpowers `writing-skills/testing-skills-with-subagents.md`。

平台**每日定时**跑 self-eval：

- 用 subagent 在标准压力场景下运行所有 skill
- 记录哪些 skill 触发率下降、哪些反模式新出现
- 自动建议 skill 改进 PR
- 新反模式自动写入 Rationalization Table

**不这样做会怎样**：现有三个工具的 skill 库都是手工维护，随时间退化。Fortis 让平台自己进化。

### 决策 10｜安全审计内建，AgentShield 标配

**怎么做**：

借鉴 ECC AgentShield：

- 所有写文件操作过 path-traversal sanitizer
- 所有外部依赖装包过 license + CVE 检查
- 所有外部 API 调用过 PII redaction
- 审计日志 append-only，密码学签名（防篡改）

**不这样做会怎样**：DDT 现状的安全是事后补丁（D34 之前的 PR-B 修了一批漏洞）；Fortis 把它当**架构层不可绕过**的能力。

---

## 七、五个关键抽象

### 1. Workspace Runtime（核心抽象，借鉴 ECC）

```rust
trait WorkspaceRuntime {
    fn id(&self) -> WorkspaceId;
    fn ssot(&self) -> &SSoTStore;
    fn phases(&self) -> &PhaseBus;
    fn subagents(&self) -> &SubagentRegistry;
    fn audit(&self) -> &AuditTrail;
    fn capabilities(&self) -> WorkspaceCapabilities;  // 哪些能力可用

    fn lifecycle_hooks(&self) -> &LifecycleHooks;
    // 'workspace_created' / 'phase_changed' / 'pre_merge' / 'post_merge' ...
}
```

一个项目 = 一个 Workspace。多 Workspace 可并行，互不干扰。

### 2. Skill Charter（核心抽象，借鉴 superpowers）

```yaml
---
name: building-api-contract
description: Use when starting a new API design phase, has spec but no implementation
priority: high  # 决定是否注入 SessionStart Charter
applies_to:
  - phase: DESIGN
  - industry_pack: ["automotive-iov", "fintech-payment"]
  - has_artifact: "prd.md"
iron_laws:  # 引用 Runtime 拦截器
  - NO_CONTRACT_WITHOUT_REVIEW
  - NO_BREAKING_CHANGE_WITHOUT_VERSION_BUMP
rationalization_patterns:  # 引用 Runtime 探测器
  - "温柔的乐观"
  - "命名仓促"
---

# Skill body...
```

Skill 的 frontmatter 是 **DSL，不是 markdown 装饰**——Runtime 读它来决定如何拦截、如何触发。

### 3. Phase Contract（核心抽象，借鉴 DDT）

```yaml
phase: IMPLEMENT
enters_from: [APPROVE]
exits_to: [VERIFY, ROLLBACK]
required_evidence:
  - all_tasks_have_commits
  - tests_pass
  - subagent_triangle_approved
slo:
  duration_p50: 4h
  duration_p99: 24h
  failure_rate_threshold: 0.05
```

**Phase 是协议层的硬性契约，不是 markdown 描述**。

### 4. Audit Trail（融合三家）

```sql
CREATE TABLE audit_events (
  id UUID PRIMARY KEY,
  workspace_id UUID,
  actor TEXT,  -- "user" / "agent:docs" / "subagent:reviewer" / "hook:session-start"
  action TEXT,
  args JSON,
  result JSON,
  evidence_refs TEXT[],
  parent_event_id UUID,  -- 因果链
  signature TEXT,  -- 防篡改
  ts TIMESTAMPTZ
);
```

任何"v0.9.x 到底发生了什么"的问题，都能从这张表查出来。

### 5. Industry Compiler（Fortis 新创）

```
Input:
  - 通用 PRD（用户用自然语言写的需求）
  - Industry Pack: automotive-iov

Output:
  - 行业适配的执行计划（自动注入"车联网功能安全"phase）
  - 行业特有的 SSoT 实例（DBC 通信矩阵、ASPICE 流程要件）
  - 行业特有的审计规则（注入 ISO 26262 检查）

Compiler 是纯函数：(PRD, Pack) → Plan
```

**Industry Pack 不是"模板套用"，是"DSL 编译"**——把通用需求**编译**成行业语境下的执行计划。这是 DDT/superpowers/ECC 都没有的概念。

---

## 八、端到端工作流（场景化）

用户在 Cursor 里说："我要做一个供应链管理系统的 v0.1"

```
[SessionStart Hook]
  → Runtime 注入 Fortis-Core-Charter
  → 用户已声明 industry: logistics-supply-chain
  → 再注入 Logistics-Pack-Charter

[LLM 自治触发 brainstorming Skill]
  → Negotiator subagent 苏格拉底式对话
  → 用户回答完毕

[brainstorming Skill 触发 design-brief Skill]
  → Skill Charter 声明 applies_to.phase=DESIGN
  → 自动调 Logistics Industry Compiler
  → 编译出"含供应链合规审查"的 design brief

[design-brief 触发 architect-subagent]
  → 写 SSoT Store：API contract + 数据模型 + supply-chain-compliance facts
  → 触发 phase_changed: DESIGN → PLAN

[Phase Bus 监听 DESIGN → PLAN]
  → 自动触发 writing-plans Skill
  → 产 bite-sized plan，写入 plans 表

[Iron Law 拦截：APPROVE 必须人工]
  → Runtime 拒绝执行 IMPLEMENT 工具调用
  → 等用户审批

用户审批 ✅

[subagent-driven-development 启动]
  → Per task:
    - Implementer subagent 写代码
    - Spec Reviewer subagent 校规约
    - Quality Reviewer subagent 校质量
    - Security Reviewer (AgentShield) 校 PII + CVE
    - Observer subagent 后台扫 Rationalization patterns
  → 四个 ✅ + 0 Observer warning，才允许 mark complete

[VERIFY phase 自动触发]
  → audit-deployment-config 跑
  → test-agent 跑
  → AgentShield 扫
  → 全部通过 emit phase: VERIFY → SUMMARY

[SUMMARY phase]
  → metrics-agent 从 audit_events 表 query 出效率报告
  → Audit Trail append 客户验收记录

整个过程：
  - 用户不需要记任何命令
  - LLM 不可能跳过任何 Iron Law
  - 度量自动累积
  - 反模式自动检测
  - 行业 SOP 编译进每个 phase
```

---

## 九、不做的事（YAGNI 边界）

| 不做 | 为什么不做 |
|------|-----------|
| ❌ 不做 AGI 通用助手 | 专注"行业特化 + LLM 编排"窄门，比的是深度不是广度 |
| ❌ 不做"自动写所有代码" | vibe coding 的活，违背 Fortis 定位 |
| ❌ 不做低代码可视化拖拽 | 与 LLM 原生范式相悖，是逆向工程 |
| ❌ 不做"通用行业模板大杂烩" | 每个 Industry Pack 必须由领域专家维护，平台不替代专家 |
| ❌ 不做"取代 Claude Code/Cursor" | Fortis 是 plugin 形态，跨 harness 跑，不做 IDE |
| ❌ 不做"私有 LLM 训练" | LLM 用第三方模型，Fortis 只做编排层 |

---

## 十、给现有 DDT 团队的迁移路径建议

这份方案**不要求**推倒重来。如果要走到这个目标形态，**渐进路径**：

| 阶段 | 动作 | 现状 → 目标 |
|------|------|------------|
| **M1（实战闭环）** | 完成 alv-ops 试点，验证流程层价值 | 把行业层先跑通 |
| **M2（纪律内化）** | 把 Iron Law + Rationalization 从文本升级为 Runtime 拦截器 | 困境一开始有架构解 |
| **M3（Runtime 抽出）** | SSoT Store / Phase Bus / Audit Trail 重构为独立 Runtime 包 | 从 markdown + bash 升级到有 schema 的数据库 |
| **M4（Subagent 平台化）** | 9 agents 重构为 Subagent Registry，引入 Security + Observer 两个新角色 | 流程层补全 |
| **M5（Industry Compiler）** | 抽出"通用 DDT-Core"与"行业 Pack"，发布第一个 Pack | 知识层显式化 |
| **M6（自演进）** | 平台每日 self-eval，自动建议 skill 改进 | 平台开始自我进化 |
| **M7（多 Harness）** | 同步发布 Codex / Gemini / Cursor 版本 | 形态扩展完成 |

---

## 收尾：架构师的两句话

**第一句**：DDT/superpowers/ECC 三者**不是竞品，是不同层次的对标对象**。Fortis 把它们各自做对的放在自己的层，各自做错的从架构上修正——这是"站在巨人肩膀上"的真正含义。

**第二句**：理想形态的核心判断是 **"把行业 SOP 编译为 LLM 必须遵守的运行时约束"**。三个关键词——**编译**（不是写在 markdown）、**必须**（不是建议）、**运行时**（不是设计时）——任何一个词丢了，就是另一个工具，不是 Fortis。

---

## 附录：三条架构师注解

### 注解一：决策 5 + 决策 8 是核心创新

这两条决策都在做同一件事——**把"LLM 自觉"换成"系统强制"**。

- superpowers 没敢做（它只到 prompt 层）
- ECC 没想到（它的 Runtime 只做基建，没做约束）
- DDT 想做但缺架构能力（D34 hook 兜底是初级形态）

Fortis 的第一性原理判断是：**LLM 时代的可靠性不能靠 LLM 自觉，必须靠系统层的不可绕过**。

### 注解二：决策 7 是商业模型的底层

Industry Pack 显式 DSL 看似只是技术决策，实际是**商业模型决策**：

- Fortis = 免费 OS
- 每个 Industry Pack = 付费 / 订阅应用
- 行业领域专家 = Pack 开发者，分润生态

客户买 Fortis 不是买插件，是买"我们行业的 Pack 包"。这是 DDT 卖给企业的**真正护城河**——客户离不开的不是 Fortis 框架，是行业 Pack 里编译的 SOP 知识。

### 注解三：决策 9 是寿命保险

短期看像"未来主义"，但长期看：**所有手工维护的 skill 库都会退化**。

证据：GitHub 上 1 年没更新的 Claude plugin 一半已经死了，superpowers 自己也靠 Jesse Vincent 一人苦撑（94% PR 拒绝率背后是巨大的守门成本）。

自演进不是 nice-to-have，是**平台寿命的根本保障**。Fortis 必须从第一行代码就内建这个能力，后期再补会失败（ECC 的 continuous-learning-v2 就是事后补的，效果有限）。

---

## 原始引用

- DDT 现状：`digital-delivery-team/README.md` + `ROADMAP.md`
- Superpowers 调研报告：`digital-delivery-team/docs/research/superpowers-deep-dive.md`
- 致领导战略汇报：`digital-delivery-team/docs/research/ddt-vision-leadership-report.md`
- ECC 2.0 参考架构：`everything-claude-code/docs/ECC-2.0-REFERENCE-ARCHITECTURE.md`
- DDT 历史反模式记录：`digital-delivery-team/CHANGELOG.md`（D32-D36 段落）
