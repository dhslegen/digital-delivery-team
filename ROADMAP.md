# DDT 演进路线图 · 通向 v1.0

> **状态**：M1 进行中 · **最后更新**：2026-05-09 · **当前版本**：v0.9.20
>
> 本文档是 DDT 从 v0.9.x（演示就绪）到 v1.0（生产闭环）的演进规划。变更历史见 [CHANGELOG.md](./CHANGELOG.md)，使用文档见 [README.md](./README.md) / [USAGE.md](./USAGE.md)。

---

## 📋 锁定决策（ADR）

### ADR-001 · M1 定位

| 字段 | 内容 |
|---|---|
| **决定** | alv-ops 作为**试点生产项目**——真正上线运行、对接新石器 sandbox 拿真车数据 |
| **驳回选项** | "仅强化演示项目"（缺乏生产级证据）、"先做 M2 工具链再回头"（重蹈 v0.9.x"温柔乐观"覆辙）、"试点+演示双轨"（资源稀释） |
| **后果** | M1 工期从 1 周延长至 **3-4 周**（含 1 个月稳定性观察）；但能产出"我们靠 DDT 真把项目送上了生产"的硬证据 |
| **决定者** | 项目负责人，2026-05-09 |

### ADR-002 · SLO 标准

| 字段 | 内容 |
|---|---|
| **决定** | **Demo 级 99% 可用率 + 错误日志可查** |
| **驳回选项** | 企业级 99.9%（M2 工时翻倍）、金融级 99.95%（多活/自动 failover 过度工程）、"先不定 SLO"（拒绝"未来再说"乐观） |
| **后果** | 允许 7.2h/月 停机；监控用 Prometheus + Grafana + 飞书机器人（轻量栈，无 PagerDuty） |
| **决定者** | 项目负责人，2026-05-09 |

---

## 1. 现状评估：B 级评价的根因

领导反馈关键词："**没有真正跑出高可用的结果，没有闭环**"

| 维度 | v0.9.x 现状 | 高可用闭环标准 | 差距 |
|---|---|---|---|
| **代码可运行** | 演示前 4 处救火（密码/actuator/process.env/client.ts ENOENT） | clone 即跑通 smoke | 🟠 中 |
| **业务可联调** | server 端 NeolixClient 骨架（D33），**从未真实调过新石器 API** | 实际拉到真车辆数据回写 t_vehicle | 🔴 高 |
| **质量可证明** | efficiency-report 仍报 backend/docs "不可证明" + 5 个 DEFECT 未修 | 全 stage 工时齐 + 0 阻塞缺陷 | 🟠 中 |
| **运行可观测** | 仅本地 SQLite 度量；线上无监控 | Prometheus + Grafana + 告警 | 🔴 高 |
| **变更可回滚** | git checkpoint 在 dev，无生产灰度 | blue-green / 金丝雀 + 一键回滚 | 🔴 高 |
| **故障可恢复** | 无 SLO / 无 on-call runbook / 无 incident review | 错误预算 + runbook + 复盘机制 | 🔴 高 |
| **团队可复用** | 一人一队 + 单项目 baseline | 多人协作 + 跨项目知识沉淀 | 🟡 低 |

**根因一句话**：v0.9.x 这 36 个 hotfix 解决的都是 **"演示前救火"**，而 "高可用" 需要的是 **"线上 7×24h 不出事"**——它们是两条互不重叠的能力线。

---

## 2. 四阶段路线图

```
v0.9.20 (now)     v0.10.x (M1)        v0.11.x (M2)        v0.12.x (M3)        v1.0 (M4)
   │                  │                   │                   │                  │
   │  演示就绪         │  实战闭环          │  生产就绪          │  团队协作         │  行业落地
   │                  │                   │                   │                  │
   │  36 hotfix       │  alv-ops 试点      │  /deploy /observe │  角色权限          │  文档站
   │  救火完毕         │  真实业务联调       │  /rollback        │  跨项目语料库      │  5×5 预设矩阵
   │                  │  99% SLO 达标      │  production-gate  │  ADR / 审计 log    │  案例库 / 认证
   │                  │                   │                   │                  │
   └─ 当下评价: B ──→  目标评价: A- ──→     目标评价: A ──→     目标评价: A+ ──→    行业影响力
```

### 🚀 M1 (v0.10.x) · 实战闭环 · 3-4 周

**目标**：把 alv-ops 从"演示项目"升级为"试点生产项目"，所有 v0.9.x 救火不再需要。

| 工作项 | 验收标准 | 反哺 DDT |
|---|---|---|
| **A. NeolixClient 真实联调** | `t_vehicle` 表能拉到 ≥ 10 辆真车数据（`mock-enabled=false`） | 验证 D33 生成器骨架；产出 "外部 API 联调 checklist" skill |
| **B. 全 stage 工时可证明** | 重跑 `/build-api` `/build-web` `/package`，efficiency-report 无 `—` | 验证 D34 hook 兜底 |
| **C. 所有 DEFECT 清零** | DEFECT-001/002/003/004/005 全修；test-report 0 阻塞 | 产出 `/fix --severity all --autoapply` 命令 |
| **D. deploy.md 一次跑通** | 新机器 clone → `make bootstrap` → smoke 全绿 | 验证 D36 facts 驱动；标准化 `make bootstrap` |
| **E. 真实演示视频** | 录 5 分钟：clone → 部署 → 业务功能 → 度量报告 | 作为 DDT README 顶部权威证据 |
| **F. 稳定性观察 14 天** | 99% 可用率（飞书机器人统计），至少 1 次故障被处理 + 复盘 | 产出 incident review 模板 |

**M1 退出标准**：5 项 ✅ 全勾 ⇒ B 级评价升级至 A-

### 🛡 M2 (v0.11.x) · 生产就绪 · 3-4 周

**目标**：DDT 工具链补齐 SLO 99% 所需的 5 个能力（不做金融级过度工程）。

**砍掉的（避免 over-engineering）**：

| 不做 | 原因 |
|---|---|
| ❌ 多 region 部署 / DB 主从 / 自动 failover | SLO 99% 不需要 |
| ❌ PagerDuty / OpsGenie 集成 | 飞书/钉钉机器人足够 |
| ❌ 错误预算精算 / 燃尽图 | 简单"每月剩余停机预算"即可 |
| ❌ Chaos Engineering | 当前规模过早优化 |

**保留的核心 5 件**：

| 新增能力 | MVP 形态 | 关键设计 |
|---|---|---|
| **`/deploy`** | docker compose up + DB migrate + health check + smoke gate | 失败自动回滚到上一 git tag |
| **`/observe`** | Spring Actuator `/metrics` + Prometheus scrape config + Grafana dashboard JSON | 5 个标准 SLI：可用率/RT P95/错误率/QPS/资源水位 |
| **`/rollback`** | 基于 `.ddt/checkpoints.log` 选 tag + 反向 SQL migration | 复用 D34 checkpoint-commit skill |
| **`incident-response` skill** | 5W1H runbook 模板 + 飞书机器人告警自动开 incident 工单 | 复盘记录到 `.ddt/incidents/*.md` 进 baseline 学习 |
| **`production-gate` 硬门禁** | `/ship --production` 前强制校验 SLO 已声明、`/observe` 已跑、`/deploy --dry-run` 通过 | exit code 拦截（"系统强制 > LLM 自觉"） |

### 👥 M3 (v0.12.x) · 团队协作 · 4-6 周

**前置条件**：M1 + M2 跑出 ≥ 2 个真实项目案例后才启动（避免在没人用的功能上空耗）

| 能力 | 现状 | M3 目标 |
|---|---|---|
| **角色权限** | 所有 agent 平权 | 角色矩阵 + PreToolUse hook 强制鉴权 |
| **决策追溯** | 仅 4 选项决策门 | ADR 升级：背景/选项/决定/后果 4 段 |
| **跨项目知识** | 单项目 baseline | `~/.claude/ddt-corpus/` 中央语料库供 LLM RAG |
| **多人协作** | 单会话 | `/relay --to <teammate>` 加密推送 + 接力链路可追溯 |
| **审计合规** | 无 | LLM 输入输出可选 audit log + PII 脱敏 + 合规导出 |

### 🌍 M4 (v1.0) · 行业落地 · 6-8 周

| 交付物 | 内容 |
|---|---|
| **文档站** | docusaurus `https://ddt.dev` |
| **行业预设矩阵** | 5 套技术栈 × 5 个行业（电商/SaaS/IoT/AI 应用/政企）= 25 套 |
| **案例库** | alv-ops + 5 个真实项目的完整 6-phase 产物 |
| **多语言** | brief/PRD 模板中/英双语 |
| **认证体系** | "DDT Certified Project" 徽章 + Practitioner 认证 |
| **生态扩展点** | Plugin SPI：第三方可注册自定义 agent / skill / hook |

---

## 3. M1 详细周计划（4 周冲刺）

### Week 1 · 关键路径：打通新石器 sandbox

| 天 | 任务 | 阻塞风险 |
|---|---|---|
| D1 | 申请/确认新石器 sandbox 凭证（AppID / Secret / 测试车辆 ID） | 🔴 外部审批可能 2-3 天 |
| D2 | `app.neolix.mock-enabled=false` + 实现 `NeolixOAuthService.fetchToken()` | 🟠 OAuth 签名错误 |
| D3 | 跑通 1 个 endpoint（建议 `GET /vehicles`），数据写 `t_vehicle` | 🟠 字段映射 |
| D4 | 跑通其余 17 个 endpoint，建立单元测试覆盖 ≥ 80% | 🟡 中 |
| D5 | 修 DEFECT-001/002/003/004/005（全部 5 个缺陷归零） | 🟡 中 |

### Week 2 · 生产可部署

| 天 | 任务 |
|---|---|
| D6-D7 | `make bootstrap` 在新机器（公有云 ECS）从零跑通；deploy.md 实际验证幂等 |
| D8 | 接入飞书机器人（错误告警 + 每日健康摘要） |
| D9 | 录 5 分钟演示视频（clone → bootstrap → 业务功能 → 度量） |
| D10 | 跑 `/report`，确认所有 stage 工时可证明 |

### Week 3-4 · 稳定性观察

| 阶段 | 验收标准 |
|---|---|
| 自然流量跑 2 周 | 99% 可用率（飞书机器人统计） |
| 至少 1 次故障 + 复盘 | 产出 incident report + 改进点列表 |
| 度量数据闭环 | efficiency-report 显示线上数据（如：alert 处理 P95 时长） |

---

## 4. 关键里程碑 vs B 级评价对应

| 领导反馈关键词 | 由哪个 milestone 闭合 |
|---|---|
| "没有真正跑出" | **M1**：alv-ops 真闭环（NeolixClient 联调成功） |
| "高可用" | **M2**：SLO + 监控 + 灰度 + 回滚 |
| "没有闭环" | **M1 + M2**：业务闭环 + 反馈闭环（指标驱动决策） |

完成 M1 + M2 → 评价 **B → A-/A**
完成 M3 + M4 → 评价冲击 **A+** + 行业影响力

---

## 5. 风险登记

| 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|
| 新石器 sandbox 申请被卡 | 🟡 中 | 🔴 M1 W1 阻塞 | D1 同时启动申请 + 备选：Mock Server 模拟新石器 API 跑通其余链路 |
| 99% SLO 实战不达标 | 🟡 中 | 🟠 M1 退出延期 | 1 个月预留缓冲；不达标也做 incident review，数据沉淀进 DDT baseline |
| M2 工具链开发期间无人用 | 🟢 低 | 🟡 工具脱离实战 | 用 alv-ops 自己 dogfooding，每个新命令先在 alv-ops 跑过 |
| 团队人手不足 | ⚪ 未知 | 🟠 工期延长 | 路线图按"单人单项目"估算；多人加速可压缩 |

---

## 6. 下次汇报建议节奏

| 时间 | 状态 | 给领导讲什么 |
|---|---|---|
| **+1 周** | M1 W1 完成 | "新石器 API 真实联调成功，server 端不再 mock；演示视频出炉" |
| **+2 周** | M1 W2 完成 | "alv-ops 在公有云 ECS 跑起来了，飞书每天推健康摘要" |
| **+1 月** | M1 退出 | "99% 可用率达成，已处理 X 次故障，efficiency-report 全闭环；评价从 B → A-" |
| **+2 月** | M2 完成 | "/deploy /observe /rollback 三件套就位，任何 DDT 项目都能复制此能力" |
| **+3 月** | M3 启动 | "团队协作版本开发中，目标企业级研发交付平台" |

---

## 7. 给领导的"反转故事"框架

下次汇报建议这样讲：

> "上次 B 级评价的核心反馈是'未闭环'。我们做了三件事：
>
> 1. **诚实承认**：v0.9.x 36 个 hotfix 都是'演示前救火'，未触及高可用闭环
> 2. **锁定试点**：alv-ops 升级为试点生产项目，对接新石器 sandbox，做真实业务闭环（不是再做一次演示）
> 3. **目标可量化**：Demo 级 SLO 99% 可用率 + 故障复盘机制，1 个月内拿出数据
>
> 这次不是'更努力做演示'，而是**目标和方法的根本转变**——从'演示就绪'升级到'生产闭环'。"

---

## 8. 设计哲学的延续

回看 v0.9.x 的 D30/D33/D34/D35/D36 五个核心 hotfix，它们形成了 DDT 的"LLM 反脆弱"模式语言：

| Hotfix | 模式 |
|---|---|
| D30 | 上游配置 → 强制翻译为产出 |
| D33 | 上游声明 → 强制翻译为代码骨架 |
| D34 | 系统事件 → hook 兜底（不依赖 LLM 自觉） |
| D35 | 模板假设 → 按 bundler 派生（不假设默认成立） |
| D36 | 部署事实 → SSoT 采集 + Hard Requirement |

**贯穿原则**：把 LLM 不可控的常识填充，逐层替换为脚本可控的事实采集。

**M2 的 production-gate 是这一原则的自然延续**——把"必须有 SLO 才能 ship"做成 exit code 拦截，而不是 prompt 提醒。M3 的角色权限矩阵同理——把"谁能改什么"做成 hook 强制鉴权，而不是 README 写"请遵守"。

v1.0 的核心承诺：**所有"温柔的乐观"都被拧紧成"显式校验 + 友好降级"**。

---

## 9. 文档维护

- 每完成一个 milestone，更新本文件顶部"状态"字段并归档当前阶段细节
- 重大决策变更需新增 ADR-NNN 并明确驳回原因
- 风险登记表中"风险等级"变化需在 commit message 注明触发事件
- 本文件不写实施细节（属于各 phase 的 PRD / 设计文档），只写**意图、决策、验收标准**

---

> **变更历史**：见 [CHANGELOG.md](./CHANGELOG.md)
> **当前用法**：见 [USAGE.md](./USAGE.md)
> **总览**：见 [README.md](./README.md)
