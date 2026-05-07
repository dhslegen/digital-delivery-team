# 5 套技术栈预设速查（决策门 D1）

> SKILL.md 决策门 D1 把这 5 个 + interactive 给用户选。本表是每个预设的"何时该选"决策准则。

| 预设 | 后端栈 | 前端栈 | 数据库 | 适合场景 | 不适合 |
|---|---|---|---|---|---|
| **java-modern** ⭐企业首选 | Spring Boot 3 + Java 21 + Maven | React 18 + Vite + TS + Tailwind/shadcn | PostgreSQL 16 | 企业级后台 / 已有 Java 基建 / 团队 Java 强 / 高合规要求（金融/政府/医疗） | 快速 POC（Spring 启动慢）/ 团队全 TS（栈跨度大） |
| **java-traditional** | Spring Boot 2.7 + Java 17 + Maven | Thymeleaf SSR | MySQL 8 | 内部管理后台 / 老 Java 团队迁移 / 不需独立前端工程 | 移动端友好 / 现代交互 |
| **node-modern** ⭐SaaS 首选 | NestJS 10 + Node 22 + pnpm | Next.js 14 App Router + tRPC + shadcn-ui | PostgreSQL 16 + Prisma | 全栈 TS / SaaS 产品 / 快速迭代 / 设计驱动（shadcn 生态丰富） | 高 CPU 计算 / 大型企业（前后端 TS 单一栈风险） |
| **go-modern** | Go 1.22 + Gin + sqlc | React 18 + Vite + TS + Tailwind | PostgreSQL 16 | 高并发 / 微服务 / 性能敏感 / 云原生 / 网关层 | 数据库密集 / 复杂业务建模（Go ORM 弱） |
| **python-fastapi** ⭐AI 集成首选 | FastAPI + Python 3.12 + Poetry | React 18 + Vite + TS + Tailwind | PostgreSQL 16 + SQLAlchemy | AI/ML 集成 / 数据密集 / 快速 POC / 数据分析后台 | 高并发线上服务（GIL）/ 移动端原生 |
| **interactive** | （问） | （问） | （问） | 不确定栈 / 需要严格定制 / 学习用途 / 比赛项目（探索） | 时间紧（4 题问卷耗时 ~3 分钟） |

---

## 决策助手（输入 → 推荐预设）

| 用户输入暗示 | 推荐 |
|---|---|
| "Java 团队 / Spring / 企业 / 银行 / 政府 / SSO + 部门权限 / 高合规" | java-modern |
| "Java 旧项目 / 内部后台 / 模板渲染 / Thymeleaf / 老员工" | java-traditional |
| **B2B 后台 / 物流 / 车队 / 工厂 / 医院 / 运营管理 / 多模块（5+）/ 客户合同 / 网点 / 账单** | **java-modern**（B2B 长服役 + Spring 生态最匹配） |
| "SaaS / 全栈 TS / Vercel / shadcn / Next.js / 设计驱动" | node-modern |
| "高并发 / 网关 / 微服务 / 云原生 / 性能 / Cloudflare Workers" | go-modern |
| "AI / 大模型 / 数据分析 / Jupyter / NumPy / OpenAI / RAG" | python-fastapi |
| "比赛 / 探索 / 学习 / 新栈尝试" | interactive |
| **任何不在以上的场景** | **node-modern**（v0.8+ DDT 实战默认） |

### B2B 项目特化（v0.9.2 实战经验）

B2B 后台和 SaaS 产品的差异让默认预设不同：

| 维度 | B2B 后台（推 java-modern） | SaaS 产品（推 node-modern） |
|---|---|---|
| 客户关系 | 一对多客户合同 / 长服役（≥ 3 年）/ 离线部署 | 自助注册 / 订阅模式 / 云端 |
| 用户量级 | 10-1000 内部 + 客户 | 10000+ 公开用户 |
| 功能形态 | 管理后台 + 实时数据 + 报表 + 审计 | 产品功能流 + 协作 + 通知 |
| 合规要求 | 等保 / SOC2 / 客户合同条款 / 数据隔离 | 通用 GDPR / cookie 同意 |
| 团队栈 | 通常已有 Java 工程师 + 服务端开发 | 全栈 TS 团队 |

**实战触发关键词**：物流 / 车队 / 工厂 / 医院 / 政府 / 运营 / 客户管理 / 网点 / 合同 / 账单 / 设备监控 / 车队管理 → 强推 **java-modern**。

---

## 反模式

- ❌ 输入只提"Web 项目"就推 java-modern（除非有 Java 信号）
- ❌ 提到 React 就推 node-modern（也可能是 java-modern + React）—— 看后端栈信号
- ❌ 用户说"用 Vue" → 推 interactive 让用户细化（5 预设里只有 java-modern 默认 React，需要切 Vue 应走 interactive）

---

## 与 /design Phase 2b 的对齐契约

`/design` 命令 Phase 2b 检查 brief 的"技术栈预设"字段：

- 值为具体 preset（java-modern 等）→ 自动展开 preset 默认
- 值为 `interactive` 或 `custom` → /design 主动跑 4 步问卷
- 值为空 / `none` → /design 报错"先填技术栈预设"

**本 skill 必须确保 D1 决策门后写入的字段值在以上 7 个枚举内**（5 preset + interactive + custom）。
