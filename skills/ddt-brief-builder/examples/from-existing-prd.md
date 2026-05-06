# 示例 B：用户已有完整 PRD → 反向提炼 brief

## 用户输入（实战）

> 我已经有一份产品需求文档在 `~/Documents/team-admin-prd.md`，
> 但 DDT 让我先填 project-brief.md，能不能基于已有 PRD 反向写 brief？

## 输入识别

- 类型：D. 已有 PRD（用户明确说"我有 PRD"）+ B. 文件路径
- 信号：路径 `~/Documents/team-admin-prd.md` + "反向写 brief"

LLM 开场说："识别到已有 PRD 文档，将反向提炼 brief（从 PRD 向上抽象）。先用 Read 工具读取 PRD..."

## 反向提炼策略

PRD 是详细需求（用户故事 + AC + 优先级），brief 是**上一层抽象**（项目背景 + 成功标准）。映射规则：

| brief 字段 | 从 PRD 哪里提取 |
|---|---|
| §1 项目背景 | PRD 的"概述 / 引言 / 背景"段（通常 PRD 第一节） |
| §2 目标用户 | PRD 的"用户故事 / persona"中的角色去重合并 |
| §3 成功标准 | PRD 的"非功能需求 / KPI / 性能指标"段 |
| §4 核心功能 | PRD 的"用户故事"按主题归类后抽取动名词 |
| §5 关键约束 | PRD 的"约束 / 截止日期 / 合规"段 |
| §9 非目标 | PRD 的"非目标 / Out of Scope"段（如有） |

## 执行步骤

```bash
# 1. Read PRD
# 2. 按映射表填字段
# 3. 跑 3 个决策门（D1/D2/D3 不能从 PRD 推断，必须问用户）
# 4. 写 brief
```

## 关键边界

- ❌ **不要把 PRD 内容塞进 brief**：brief 是浓缩，不是复述
- ❌ **不要在 brief 里放 Given/When/Then AC**：那是 PRD 才有的细节
- ✅ **brief 第 §10 参考资料保留 PRD 路径**：让 product-agent 后续能 cross-reference

## 决策门特殊处理

PRD 通常**不含**技术栈预设和 AI 通道（这是 DDT 后续 /design 阶段的产物），所以 D1/D2/D3 必须用 AskUserQuestion 显式问，不能从 PRD 提取。

## 产物 brief（精简版）

```markdown
# Project Brief · <从 PRD §1 提取的项目名>

## 项目背景

<浓缩 PRD 的"概述 + 痛点 + 为什么现在做"为 1-3 句话>

## 目标用户

- **主要用户**：<PRD 用户故事中的主角色 + 频率 + 关注点>
- **次要用户**：<次要角色>

## 成功标准

<从 PRD KPI / 非功能需求段提取的可量化指标>

## 核心功能（一句话描述）

<把 PRD 用户故事按主题归类，抽 3-7 个动名词功能>

## 关键约束

<从 PRD 约束段提取截止日期 / 工期 / 合规>

## 技术栈选型

### 快捷预设

- **技术栈预设**：<D1 决策门用户选>
- **AI-native UI**：<D3 决策门用户选>

## 非目标

<从 PRD 的 Out of Scope 段提取>

## 参考资料

- 已有 PRD：~/Documents/team-admin-prd.md（反向提炼自此文档）

---
> 由 ddt-brief-builder 生成（反向提炼模式）
> 来源 PRD：~/Documents/team-admin-prd.md
> 填充率：100%（PRD 信息密度高，brief 字段全填）
> 关键决策：tech-stack=<X> / frontend=<Y> / ai-design=<Z>
```

## 下一步指引

```
✅ project-brief.md 已生成（反向提炼自 ~/Documents/team-admin-prd.md）

下一步两个路径：
路径 1（直接复用 PRD）：把 ~/Documents/team-admin-prd.md 复制到 docs/prd.md，跳过 /prd 直接 /wbs
路径 2（让 DDT 重新生成 PRD）：跑 /prd，product-agent 会基于 brief 重新出 PRD
   - 优点：DDT 标准格式 / Given-When-Then AC / 优先级
   - 缺点：可能与原 PRD 表述差异

推荐路径 1（用户已有 PRD 投入大）+ 用 /prd --refresh 增量补 DDT 标准化字段
```
