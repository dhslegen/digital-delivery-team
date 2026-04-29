---
description: 新项目起手 · 串行跑 /prd → /wbs → /design；默认 interactive（每步决策门），--auto 跳过决策门。
argument-hint: "[--auto] [--preset java-modern|node-modern|go-modern|python-fastapi|java-traditional] [--ai-design claude-design|figma|v0|lovable] [补充需求描述]"
---

# /kickoff

**输入**：$ARGUMENTS（补充需求描述，透传给 `/prd`）

---

## 执行步骤

### Step 0：技术栈预选（M6.3 新增）

**LLM 必须执行**：在跑 `/prd` 之前，先检查 `project-brief.md` 中的 "技术栈预设" 字段。

| 字段值 | 行为 |
|--------|------|
| 具体 preset（`java-modern` / `node-modern` ...） | 跳过问卷，按 preset 解析 |
| `interactive` 或缺失 | **必须**用 `AskUserQuestion` 工具发起 4 步问卷（Spring Initializr 等价：语言 → 数据库 → 前端 → UI） |
| `custom` 且 brief 已填详细字段 | 按详细字段解析，不再问 |
| `custom` 但 brief 字段不全 | 用 AskUserQuestion 补全缺失字段 |

具体 4 步问卷模板见 `commands/design.md::Phase 2b`，或直接读取 `templates/tech-stack-options.yaml::askuserquestion_flow`。

收集到答案后，把结果写入 `/tmp/ddt-user-components.json`，**必须使用嵌套对象 schema**：

```json
{
  "preset": "<step1 推断的 preset 名>",
  "backend":  { "language": "...", "framework": "...", "database": { "primary": "..." } },
  "frontend": { "framework": "...", "ui": { "components": "..." } },
  "ai_design": { "type": "claude-design | figma | v0 | lovable" }
}
```

**严禁**写成扁平字符串（如 `"backend": "java-spring-boot"`）—— `resolve-tech-stack.mjs` 会拒绝并退出 2，污染源默认 preset 的字段。后续 `/design` 阶段会 merge。

### M6.2 执行模式

- **默认 interactive 模式**：每个内部 phase（prd / wbs / design）跑完后**必须暂停**走决策门（`skills/decision-gate/SKILL.md`），未确认前禁止进入下一步
- **--auto 模式**：传 `--auto` 时跳过所有决策门，按旧串行 chain 跑（兼容 v0.5.x 老用户的"一键起手"体验）

### Step 1：跑 `/prd $ARGUMENTS`
- 若 `project-brief.md` 缺失 → 停止，提示用户填写
- 若存在阻塞项（`docs/blockers.md` 非空）→ 停止，提示处理阻塞
- /prd 命令内部已含决策门（除非 --auto）；用户接受后再继续 Step 2
- **未传 --auto 时**：LLM 必须等待 /prd 决策门返回 `accept` 后才推进到 /wbs

### Step 2：跑 `/wbs`
- 若失败 → 停止
- /wbs 内部决策门同上
- **未传 --auto 时**：LLM 必须等待 /wbs 决策门返回 `accept` 后才推进到 /design

### Step 3：跑 `/design $ARGUMENTS`（透传 `--preset` / `--ai-design`）
- /design 内部 Phase 2b 会基于 Step 0 收集的 components JSON 写入 `.ddt/tech-stack.json`
- 若契约 lint 未通过 → 停止，返回退出码 4
- 若 OpenAPI lint 工具缺失 → 停止，返回退出码 5
- 若产出文件缺失 → 停止
- /design 内部决策门同上
- **未传 --auto 时**：LLM 必须等待 /design 决策门返回 `accept` 后才输出 kickoff 汇总

4. 汇总输出：

```
/kickoff 完成

PRD 用户故事数: <n> 条
WBS 任务数:     <n> 个
Endpoint 数:    <n> 个
Top 3 风险:
  1. <risk-1>
  2. <risk-2>
  3. <risk-3>

建议下一步：/impl
```

$ARGUMENTS
