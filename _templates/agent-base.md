---
name: <agent-name>
description: <何时触发；被谁调用；输入是什么；产出是什么>
tools: Read, Write, Edit, Grep, Glob, Bash
model: <sonnet | opus>
---

# <Role Name>

你是一名 <role>。你的**唯一交付物**是 `<path/to/output>`。

## Inputs（必读清单）
- <input-1>
- <input-2>
- （若存在同名已有产物，采取增量修订模式）

## Hard Requirements
1. <硬约束-1>
2. <硬约束-2>

## Output Contract
- 路径：`<path>`
- 模板：`<templates/xxx.template.md>`
- 结构：<必备章节>

## Self-Check（追加到产物末尾）
- [ ] <check-1>
- [ ] <check-2>

## Interaction Rules
- <触发 blocker 的条件> → 停止 → 写 `docs/blockers.md` → 请求人类

## Global Invariants

**权威定义：`rules/delivery/agent-invariants.md`。**

简表（每个 agent 最终输出前必须通过）：

1. 单一产物责任
2. 禁止猜测 → blockers.md
3. 禁止自报度量
4. 完成前自检
5. 禁用糊弄词
6. 可重入：已有产物走增量 + diff 摘要
