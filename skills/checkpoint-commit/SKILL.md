---
name: checkpoint-commit
description: 每完成一个 plan 步骤自动 git commit，记录到 .ddt/checkpoints.log；支持 git revert 回滚到任意 checkpoint。auto-loaded by build-api / build-web / fix 等 IMPLEMENT phase。吸收 ECC checkpoint 范式。
origin: DDT
---

# Checkpoint Commit · 步骤级提交

> 吸收 ECC `commands/checkpoint.md` 范式：
> > 每个工作阶段创建 git checkpoint commit，记录到 .claude/checkpoints.log
>
> M6.4 整改：v0.6.x backend-agent 一次性大 commit，出问题难回滚。
> v0.7.0 改 main thread + 每 step checkpoint，让回滚到"上一个绿色状态"成为一行 git revert。

## Triggers

- `/build-api` / `/build-web` IMPLEMENT phase 的每个 plan step 完成后
- `/fix --apply` 每条 patch apply 成功后
- 任何 main thread 跑通 validation-loop 后想"标记一个绿色检查点"时

## Core Philosophy

> **每个 step 一个 commit**：不是"写到差不多再 commit"，而是"validation 通过即 commit"。
> 这样回滚永远精确——`git revert <sha>` 能精准撤销某一步而不影响其他。

## Commit message 规范

格式：

```
<phase>(<step-id>): <短描述>

<可选 body：详细描述本 step 做了什么>

- step: <step 编号或 ID>
- validation: <validation-loop 跑了什么 + 结果>
- files: <改动文件列表，最多 5 个，超过显示 N more>

Checkpoint-Phase: <phase>
Checkpoint-Step: <step>
Checkpoint-Validation: passed
```

例：

```
build-api(P1.2): implement task service business logic

实现了 TaskService 类，包含 create / list / update 三个方法，
对应契约的 POST/GET/PATCH /tasks endpoint。错误用 throws 抛出，
统一由 errorHandler 中间件转 4xx/5xx。

- step: P1.2
- validation: tsc --noEmit OK + jest src/services/taskService.spec.ts (3/3 passed)
- files: server/src/services/taskService.ts, server/src/services/taskService.spec.ts

Checkpoint-Phase: build-api
Checkpoint-Step: P1.2
Checkpoint-Validation: passed
```

## .ddt/checkpoints.log 格式

每个 checkpoint commit 后，追加一行到 `.ddt/checkpoints.log`：

```
2026-04-29T10:23:00Z | build-api | P1.1 | abc1234 | db layer
2026-04-29T10:25:30Z | build-api | P1.2 | def5678 | task service
2026-04-29T10:30:00Z | build-api | P1.3 | 1234abc | tasks routes
2026-04-29T10:32:00Z | build-web | P2.1 | 5678def | api client
```

字段：`<ISO timestamp> | <phase> | <step-id> | <git short SHA> | <短描述>`

## 实施流程

main thread 在 validation-loop 通过后：

```bash
# 1. 收集改动文件
FILES=$(git diff --cached --name-only HEAD)

# 2. 构造 commit message
PHASE="build-api"          # 当前 phase
STEP="P1.2"                 # 当前 step ID
DESC="implement task service business logic"
VALIDATION="tsc OK + jest 3/3"

# 3. git add + commit
git add $FILES
git commit -m "$(cat <<EOF
${PHASE}(${STEP}): ${DESC}

- step: ${STEP}
- validation: ${VALIDATION}
- files: ${FILES}

Checkpoint-Phase: ${PHASE}
Checkpoint-Step: ${STEP}
Checkpoint-Validation: passed
EOF
)"

# 4. 追加 checkpoints.log
SHA=$(git rev-parse --short HEAD)
TS=$(date -u +%Y-%m-%dT%H:%M:%SZ)
echo "${TS} | ${PHASE} | ${STEP} | ${SHA} | ${DESC}" >> .ddt/checkpoints.log
```

## 回滚到 checkpoint

```bash
# 看所有 checkpoint
cat .ddt/checkpoints.log

# 回滚到 P1.1（撤销 P1.2 + P1.3）
git revert <P1.2 sha> <P1.3 sha>

# 或 hard reset（破坏性，需用户确认）
git reset --hard <P1.1 sha>
```

提供 helper 命令 `bin/checkpoint-rollback.mjs --to <step-id>`（v0.7+ 待实现）。

## 与 ECC checkpoint 的关系

ECC `commands/checkpoint.md` 用 `.claude/checkpoints.log`，DDT 用 `.ddt/checkpoints.log`（项目本地，与 progress.json 同位置便于 /relay 自动捕获）。

## 与 validation-loop / build-api 的集成

build-api 的 IMPLEMENT phase 每个 step：

```text
1. main thread 写代码（Write/Edit）
2. validation-loop standard mode 跑
3. 通过 → checkpoint-commit（本 skill）→ 推进下一 step
4. 失败 → AskUserQuestion 决策（修复/跳过/回滚/重新规划）
```

## 与 progress.json 的关系

- `progress.json::phases[<phase>].artifacts`：phase 完成的整体产物（粗粒度）
- `.ddt/checkpoints.log`：phase 内部每 step 的 commit（细粒度）
- 两者互补：一个看"现在做到哪个 phase"，一个看"phase 内部做到哪步"

## 与 /relay 的协同

`/relay` 命令生成接力 prompt 时，会读取 `.ddt/checkpoints.log` 注入到 "What WORKED (with evidence)" 段（每个 commit 是有效产出的证据）。

## Don't

- ❌ 不要"先写 5 个文件再 commit"——validation 每通过一次就 commit
- ❌ 不要在 commit message 里写"WIP" / "fix" / "tmp" 这种无信息量的描述
- ❌ 不要 squash commits 进同一个（每 step 独立 sha 是回滚的基础）
- ❌ 不要 force push 已 push 的 checkpoint commit（破坏其他人/未来会话的 git 历史）

## Do

- ✅ 每 step 独立 commit + 追加 checkpoints.log
- ✅ commit message 含 phase/step/validation 元信息（让 git log --grep 能筛）
- ✅ files 列表前 5 个 + N more 摘要
- ✅ 失败时不创建 checkpoint commit（保持 git 历史绿色）

## Templates & References

- ECC `commands/checkpoint.md`
- `skills/validation-loop/SKILL.md`
- `bin/build-relay-prompt.mjs`（自动读 checkpoints.log）
