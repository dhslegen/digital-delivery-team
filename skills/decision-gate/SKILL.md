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

---

## 新增 phase 命令时的强制对齐 checklist（v0.8.1 D9 教训）

**背景**：v0.8.0 引入 `/design-brief` / `/design-execute` 两个新 phase 命令，但只补了
emit-phase / emit-decision 的 VALID_PHASES（W7.5 R1），漏了 `bin/progress.mjs::PHASE_ARTIFACTS`
状态机层与命令尾部"建议下一步"链。后果：度量层"看见"事件能落盘，但**状态机层不承认这两个 phase 存在**，
SessionStart 推断"继续"永远跳到 build-web，用户视角 design-brief / design-execute 沦为游离辅助命令。

**修复（v0.8.1 D9 + D2 + D3）**：单点改 PHASE_ARTIFACTS 一个常量连锁解三个体系级 BUG。

**教训**：phase 名称在 6 处都有依赖，新增时必须**全部对齐**——任何一处漏了都会留下"半完成"的隐形断裂。

### 新增/重命名 phase 命令时的强制对齐 6 处

| # | 文件 | 修改内容 | 验证方式 |
|---|---|---|---|
| 1 | `bin/emit-phase.mjs::VALID_PHASES` | 加入新 phase 名（小写 / kebab-case） | `bin/emit-phase.mjs --phase <new> --action start; echo $?` 应为 0 |
| 2 | `bin/emit-decision.mjs::VALID_PHASES` | 同上 | `bin/emit-decision.mjs --phase <new> --action point ...` 应为 0 |
| 3 | `bin/progress.mjs::PHASE_ARTIFACTS` | 加 `<new>: ['<sentinel-artifact>']` 键值对 | 跑 `tests/integration/progress-state-machine.test.mjs` 全过 |
| 4 | 上一个 phase 命令的"建议下一步" | 指向新 phase（必要时按 `frontend.type` 分支） | 跑 `tests/unit/commands-slim.test.mjs` |
| 5 | 新 phase 命令的"建议下一步" | 指向后续 phase | 同上 |
| 6 | `tests/integration/progress-state-machine.test.mjs::progress --init` | 把新 phase 加入 `expectedPhases` 数组 | 测试自然失败提示 |

### 进阶：跳过条件如何表达

如果新 phase 在某些 tech-stack 下不适用（如 design-brief / design-execute 仅在 `frontend.type=spa` 时跑）：

7. 在 `bin/progress.mjs::shouldSkipPhase` 加分支返回 `true`，让 infer 自动标 `skipped`
8. 在 commands/上一阶段 的"建议下一步"分支表里**显式声明跳过**，避免用户疑惑

### 新增 phase 命令前的 4 个判断题

**用 AskUserQuestion 自己问自己**（M6.4 路径上）——动手前必须给出明确答案：

1. 这个 phase 是 **必经** 还是 **可选**？必经 → 加进 PHASE_ORDER；可选 → 用 `skipped` 状态
2. 它的 sentinel artifact 是什么？必须是**单一文件**或**目录**，不能是动态产出（否则 infer 推断不出 completed）
3. 它前后衔接哪两个 phase？写出 `prev → new → next` 三元组并落到命令尾部建议链
4. 它是否触发 emit-phase / emit-decision？如不触发（纯展示型命令），跳过 1-3 的对齐——但应改为非 phase 命令（如 `/preview` `/resume`）

### 反模式（v0.8.1 之前的实际错误）

- ❌ "只补 VALID_PHASES 度量就好了"——会让状态机层留下断裂（D9）
- ❌ "建议下一步先按旧的写，发版后再改"——隐式契约一旦固化，用户已经开始按错误路径用了（D1）
- ❌ "新 phase 不需要 sentinel，靠 emit-phase end 事件标完成"——progress.mjs 是 sync 的，必须能从文件存在性 infer
- ❌ "测试就先放着，反正本地能跑通"——`expectedPhases` 数组是契约，漏了等于让未来重构者挖坑（D9 修复时立刻被既有测试断言抓到，是正反馈）
