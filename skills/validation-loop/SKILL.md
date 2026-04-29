---
name: validation-loop
description: 每写一个文件立即跑 build/lint/type-check/test，失败立即停下让用户决策。auto-loaded by build-api / build-web / fix 等 IMPLEMENT phase。DDT 每文件验证 + 失败立即停的 validation loop。
origin: DDT
---

# Validation Loop · 每步验证

> Golden Rule: If a validation fails, fix it before moving on. Never accumulate broken state.
>
> M6.4 整改：v0.6.x 的 backend-agent / frontend-agent 是写完才测，
> 一旦有 bug 已经写了 10 个文件，根因排查困难。
> v0.7.0 改 main thread + validation loop——每文件立即测，失败立即停。

## Triggers

- `/build-api` IMPLEMENT phase（每个 step 后）
- `/build-web` IMPLEMENT phase（每个组件后）
- `/fix --apply`（每条 patch 后）
- 任何 main thread 写完一个关键文件后

## Core Philosophy

> **不累积破损状态**：每一步验证失败都立即停下，让用户决策是修复 / 跳过 / 重新规划。
> 不要"先写 10 个文件再一起测"——出问题时无法定位是哪步引入的。

## 检测包管理器与构建工具

按文件存在性自动选对命令：

| 检测到的文件 | 包管理器 | build 命令 | lint 命令 | typecheck 命令 | test 命令 |
|------------|---------|-----------|----------|--------------|----------|
| `pnpm-lock.yaml` | pnpm | `pnpm run build` | `pnpm run lint` | `pnpm exec tsc --noEmit` | `pnpm test --run` |
| `yarn.lock` | yarn | `yarn build` | `yarn lint` | `yarn tsc --noEmit` | `yarn test --run` |
| `package-lock.json` 或 `package.json` 无 lock | npm | `npm run build` | `npm run lint` | `npx tsc --noEmit` | `npm test --silent --run` |
| `pom.xml` | maven | `mvn -B compile` | `mvn -B verify -DskipTests` | `mvn -B compile` | `mvn -B test` |
| `build.gradle*` | gradle | `./gradlew build -x test` | `./gradlew check -x test` | `./gradlew compileJava` | `./gradlew test` |
| `pyproject.toml` + poetry.lock | poetry | `poetry build` | `poetry run ruff check` | `poetry run mypy .` | `poetry run pytest` |
| `pyproject.toml` 无 poetry | pip + ruff | — | `ruff check .` | `mypy .` | `pytest` |
| `Cargo.toml` | cargo | `cargo build` | `cargo clippy` | `cargo check` | `cargo test` |
| `go.mod` | go | `go build ./...` | `golangci-lint run` | `go vet ./...` | `go test ./...` |

> 命令优先用项目脚本（如 `npm run build`）；脚本不存在则 fallback 到通用命令（`tsc --noEmit`）。

## Validation Mode（按场景选）

### Quick Mode（每个文件后）

只跑当前文件相关的最快验证：

- `.ts/.tsx`：`tsc --noEmit <path>` + 该文件 lint
- `.js`：`<lint> <path>`
- `.java`：当前模块 `mvn -B compile -pl <module>`
- `.go`：`go vet <package>` + `go build <package>`
- `.py`：`mypy <path>` + `ruff check <path>`

5 秒内能跑完，不打断 flow。

### Standard Mode（每个 step 后）

跑所有目标的 validation：

```text
Step: P1.1 db layer 完成
→ tsc --noEmit       (5s)
→ npm run lint        (3s)
→ npm test src/db.spec.ts  (10s)
→ ✅ 全绿 → checkpoint commit → 进入 P1.2
```

### Strict Mode（VERIFY phase）

完整跑：build / lint / typecheck / test 全量 + 契约对齐 + smoke test：

```text
✓ npm run build        OK
✓ npm run lint         OK (0 errors / 2 warnings)
✓ npm run typecheck    OK
✓ npm test --run       PASS 15/15 (coverage 92.96%)
✓ check-contract-alignment.mjs  OK
✓ smoke: curl http://localhost:3001/health  200 OK
```

任一失败 → 写 blocker → 停止。

## 失败处理决策表

任何 mode 下验证失败都必须：

1. **停止**：不继续下一步
2. **显示**：把失败原因（编译错 / 测试失败 stack / lint rule）显示给用户
3. **AskUserQuestion**：4 选项决策
   - 修复（推荐）：保持 plan，专注修当前 step
   - 跳过此步（不推荐）：标 blocker，进入下一 step
   - 回滚到上个 checkpoint：git revert，重新规划
   - 重新规划：跑 `/<phase> --refresh` 重新生成 plan

```typescript
{
  questions: [{
    question: "Validation 失败：<失败原因摘要>。如何继续？",
    header: "Validate fail",
    multiSelect: false,
    options: [
      { label: "修复并重试 (Recommended)",
         description: "保持 plan，专注修当前 step",
         preview: "<失败的具体输出，最多 1500 字符>" },
      { label: "跳过此步标 blocker",
         description: "进入下一 step，blocker 由用户后续处理" },
      { label: "回滚到上个 checkpoint",
         description: "git revert，回到上次绿色状态" },
      { label: "重新规划（--refresh）",
         description: "整体方案有问题，重新生成 plan" }
    ]
  }]
}
```

## 与 build-api/build-web 的集成

build-api/build-web 的 IMPLEMENT phase 每个 step 必须：

```bash
# step N: 写代码
# (Write/Edit 文件)

# step N: validation
node "$DDT_PLUGIN_ROOT/bin/validate.mjs" --mode standard --files <list> || {
  # 失败：触发 AskUserQuestion 决策（见上表）
  exit 0  # 不直接 exit 2，因为决策可能是"跳过"
}

# step N: checkpoint commit（按 checkpoint-commit skill）
git add <files> && git commit -m "P<step>: <description>"
```

## DDT 范式说明

本 skill 在 `/build-api` `/build-web` `/fix` 等命令的 IMPLEMENT phase 中标准化以下三大原则：

- 分级验证模式（quick / standard / strict / pre-commit）
- Golden Rule "fix before moving on"
- 检测包管理器 + 一次一错 + 卡住即停

## 与 v0.6.x 的差异

| v0.6.x（已废弃） | v0.7.0 |
|--------|--------|
| subagent self-check（写完才测） | 每文件 / 每 step 立即测 |
| 失败由 agent 自己决定（黑盒） | 失败 AskUserQuestion 用户决策（透明） |
| validation 命令硬编码 npm/jest | 自动检测包管理器 + 构建工具 |
| 没有 checkpoint commit 配合 | 每 step validation 通过 = checkpoint commit |

## Don't

- ❌ 不要"批量写 5 个文件再跑一次测试" — 必须每文件 quick mode + 每 step standard mode
- ❌ 不要把验证失败当"warning"忽略 — 必须 stop + AskUserQuestion
- ❌ 不要为了让测试通过修改测试 expected 值（除非测试本身有 bug，且必须用户批准）

## Do

- ✅ Quick mode 5 秒内能完成 — 不要选超长命令
- ✅ Standard mode 每 step 跑（≤ 30s 可接受）
- ✅ Strict mode 仅在 VERIFY phase 跑
- ✅ 失败时显示 stack trace 完整 1500 字符（让用户能看出根因）
