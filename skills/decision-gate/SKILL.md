---
name: decision-gate
description: M6.2 用户决策门标准模板。每个 phase 命令产物落盘后，LLM 必须按本 skill 调用 AskUserQuestion 让用户决策"接受/修改/新增/重生成"，未确认前禁止进入下一 phase。
origin: DDT
---

# Decision Gate · 用户决策门

> M6.2 整改：解决 v0.5.x "盲盒严重" 痛点——agent 包办所有决策。每个 phase 落盘后**强制**用 AskUserQuestion 让用户参与，让 DDT 从"包办式"转向"协作式"。

## 何时触发

任何 phase 命令的 Phase 5（汇总输出）末尾、Phase 6（emit-phase end）之前。10 个 phase command 都必须按本 skill 操作：
prd / wbs / design / build-api / build-web / test / review / fix / package / report

也包括编排命令 `/kickoff` 中各内部 step 之间（除非用户传 `--auto`）。

## 决策门标准 4 选项

LLM 必须调用 `AskUserQuestion` 工具，按以下模板：

```typescript
{
  questions: [{
    question: "<phase 中文名>已生成（<关键指标摘要>），如何继续？",
    header: "<8 字以内 phase 标识>",      // 如 "PRD review" / "Design review"
    multiSelect: false,
    options: [
      {
        label: "接受并继续 (Recommended)",
        description: "进入 <下一 phase 命令>",
        preview: "<本 phase 产物的 1-2 段摘要>"   // 让用户在选项面板就能扫一眼内容
      },
      {
        label: "修改某条具体内容",
        description: "我会指出哪条 + 怎么改（LLM 收到后用 --refresh 增量改）"
      },
      {
        label: "新增内容",
        description: "我有遗漏的需求/字段/约束要补充"
      },
      {
        label: "重新生成（带说明）",
        description: "整体方向不对，重写本 phase（LLM 收到后用 --refresh 重做）"
      }
    ]
  }]
}
```

注意：
- 第 1 个选项标 `(Recommended)` 让用户最快路径走完
- AskUserQuestion 自动加 "Other" 让用户填自定义文本
- preview 字段（仅单选支持）展示本 phase 关键输出，让用户不用打开文件即可决策
- 不要在 multiSelect=true 时用 preview（工具不支持）

## 决策事件采集（M6.2.2）

调用 AskUserQuestion 之前必须 emit decision_point：

```bash
node "$DDT_PLUGIN_ROOT/bin/emit-decision.mjs" \
  --phase <phase-name> \
  --action point \
  --options "accept|modify|add|regenerate"
```

收到用户答案后立即 emit decision_resolved：

```bash
node "$DDT_PLUGIN_ROOT/bin/emit-decision.mjs" \
  --phase <phase-name> \
  --action resolved \
  --user-action <accept|modify|add|regenerate|other> \
  --note "<用户备注摘要，≤200 字>"
```

这两条事件让 metrics-agent 后续能分析"哪个 phase 改最多次"，反馈到 baseline 调优。

## 决策处理逻辑

| 用户选择 | LLM 行为 |
|---------|---------|
| 接受并继续 | 标 phase 完成（emit-phase end）+ 提示下一步命令；不要主动跑下一命令（让用户决定时机） |
| 修改某条具体内容 | 进一步问"哪条？怎么改？"（再调一次 AskUserQuestion 或直接对话），收到后用 `--refresh` 增量修订；修订完再走一次决策门 |
| 新增内容 | 问"补充什么内容？"，收到后用 `--refresh` 增量新增 |
| 重新生成（带说明） | 问"原因是什么？要保留什么？"，收到后用 `--refresh` 重生成；保留已验证的部分 |
| Other（自定义文本） | 解析用户意图，按上述 4 类映射处理；映射不上时写 blocker 等用户进一步澄清 |

## 关键约束

1. **未收到用户决策前禁止 emit-phase end**——决策门是 phase 完成的硬条件
2. **未收到用户决策前禁止进入下一 phase 命令**（即使 LLM 知道下一步）
3. **`--auto` flag 跳过决策门**：用户传 `/kickoff --auto` 或 `/<phase> --auto` 时直接 emit-phase end，不调 AskUserQuestion；这是"专家用户兼容路径"
4. **重生成时不丢"已确认"内容**：`--refresh` 必须是增量，禁止覆盖
5. **决策结果落盘**：每次 decision_resolved 自动写入 `.ddt/decisions.jsonl`（schema：phase / ts / user_action / note）便于后续追溯

## Don't

- ❌ 用 echo "请确认 1/2/3" 替代 AskUserQuestion——echo 是文本输出，AI 不知道用户意图
- ❌ 在决策门里问"我的方案怎么样"这种开放问题——AskUserQuestion 是结构化选择，开放问题用普通对话
- ❌ 同一 phase 反复决策超过 3 次还没接受——写 blocker 让用户解释方向
- ❌ 把决策门放在 emit-phase end 之后——end 标记 phase 完成，决策应在标记前

## Do

- ✅ preview 字段填具体内容（如"5 个用户故事 / 26 条 AC / P0=3 P1=2"）
- ✅ 关键指标在 question 文本里就显示（让用户不点选项也能扫到）
- ✅ "Other" 选项的处理逻辑要写死在每个命令的 markdown 里
- ✅ /kickoff --auto 跳过；显式调用单 phase 命令时不跳过（除非传 --auto）

## 与 ECC plan 命令的关系

ECC `commands/plan.md` 也用"WAIT for user CONFIRM before proceeding"——本 skill 是 DDT 在每个 phase 都启用此机制的标准化实现。

## 在 commands.md 中引用方式

```markdown
## Phase X — 用户决策门（M6.2）

按 `skills/decision-gate/SKILL.md` 执行：

1. 调用 `bin/emit-decision.mjs --phase <name> --action point --options "accept|modify|add|regenerate"`
2. 调用 `AskUserQuestion` 工具，4 选项标准模板（见 skill）
3. 收到答案后调用 `bin/emit-decision.mjs --phase <name> --action resolved --user-action <answer>`
4. 按答案分支：accept → emit-phase end + 提示下一步；其他 → --refresh 处理后再走一次决策门

未传 `--auto` 时此 phase 必须执行决策门，跳过即违规。
```
