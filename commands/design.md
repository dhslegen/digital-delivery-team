---
description: 架构师命令 · 生成架构草案 + OpenAPI 契约 + 数据模型。
argument-hint: "[--refresh] [--preset java-modern|node-modern|go-modern|python-fastapi|java-traditional] [--ai-design claude-design|figma|v0|lovable] [架构倾向性说明]"
---

# /design

**输入**：$ARGUMENTS

---

## Phase 1 — 前置校验

```bash
test -f docs/prd.md || { echo "❌ docs/prd.md 不存在，请先运行 /prd"; exit 1; }
test -f docs/wbs.md || { echo "❌ docs/wbs.md 不存在，请先运行 /wbs"; exit 1; }
[ -f "$DDT_PLUGIN_ROOT/bin/aggregate.mjs" ] || DDT_PLUGIN_ROOT=$(cat "${HOME}/.claude/delivery-metrics/.ddt-plugin-root" 2>/dev/null)
[ -f "$DDT_PLUGIN_ROOT/bin/aggregate.mjs" ] || DDT_PLUGIN_ROOT="${HOME}/.claude/plugins/marketplaces/digital-delivery-team"
[ -f "$DDT_PLUGIN_ROOT/bin/aggregate.mjs" ] || { echo "❌ DDT plugin root 未解析。可能原因：(1) 插件未安装；(2) shell 中 DDT_PLUGIN_ROOT 指向无效路径，请 unset DDT_PLUGIN_ROOT 后重启会话；(3) 运行 /digital-delivery-team:doctor 自检"; exit 1; }
export DDT_PLUGIN_ROOT

node "$DDT_PLUGIN_ROOT/bin/emit-phase.mjs" --phase design --action start
"$DDT_PLUGIN_ROOT/bin/check-blockers.sh" || exit 2
```

若 `docs/api-contract.yaml` 已存在且未传 `--refresh`，进入增量修订模式。

## Phase 2 — 解析技术栈（M3-3 优先级链 + M6.3 交互式问卷）

### Step 2a：先尝试自动解析

```bash
# 提取参数中的 --preset 与 --ai-design（如果有）
PRESET_FLAG=$(printf '%s' "$ARGUMENTS" | grep -oE -- '--preset [a-zA-Z0-9_-]+' | head -1 | awk '{print $2}')
AIDESIGN_FLAG=$(printf '%s' "$ARGUMENTS" | grep -oE -- '--ai-design [a-zA-Z0-9_-]+' | head -1 | awk '{print $2}')

node "$DDT_PLUGIN_ROOT/bin/resolve-tech-stack.mjs" \
  ${PRESET_FLAG:+--preset "$PRESET_FLAG"} \
  ${AIDESIGN_FLAG:+--ai-design "$AIDESIGN_FLAG"} \
  --write
```

### Step 2b：M6.3 交互式问卷（关键）

**LLM 必须执行**：检查 `project-brief.md` 中的 "技术栈预设" 字段：

- 若值为 `interactive` 或 `custom`：**必须**用 `AskUserQuestion` 工具发起 Spring Initializr 等价 4 步问卷
- 若值为具体 preset（如 `java-modern`）但 `project-brief.md` 同时含 "后端框架"、"前端框架"等具体字段且与 preset 默认值冲突：用 AskUserQuestion 问 1 题确认偏好
- 若值为 `none` 或 `interactive` 且 brief 无具体字段：**强制**走 4 步问卷，不允许 LLM 自行选栈

#### AskUserQuestion 4 步问卷模板

数据来源：`templates/tech-stack-options.yaml::askuserquestion_flow`（含 4 个 step 的完整选项 + preview）

**Step 1：主语言栈**（4 选项 + Other）
- Java + Spring Boot 3 (Recommended)
- Node + TypeScript
- Python + FastAPI
- Go (Gin / Fiber)

**Step 2：数据库 + 缓存**（4 选项 + Other）
- PostgreSQL 16 + Redis 7 (Recommended)
- MySQL 8 + Redis 7
- SQLite（轻量）
- MongoDB

**Step 3：前端框架**（4 选项 + Other）
- React 18 + Vite (Recommended)
- Next.js 14 (App Router)
- Vue 3 + Vite
- Angular 19

**Step 4：UI 组件库**（动态：根据 step 3 调整）
- 若选 React：tailwind+shadcn-ui (Recommended) / antd-5 / mui-5 / chakra-ui-2
- 若选 Vue：element-plus (Recommended) / naive-ui / antd-vue / primevue
- 若选 Angular：angular-material (Recommended) / primeng / ng-zorro

每个选项都附 `preview` 字段展示完整 stack 摘要（如 "Spring Boot 3.5 + Maven + Java 21 + MyBatis-Plus + MySQL 8 + Redis 7"）。

#### 收集后写入 .ddt/tech-stack.json

收集 4 个答案后，构造 components JSON 并写入：

```bash
# LLM 把 AskUserQuestion 收集的答案写入临时文件
cat > /tmp/ddt-user-components.json <<JSON
{
  "preset": "<step1 推断出的预设>",
  "backend": { "language": "...", "framework": "...", "database": { "primary": "..." } },
  "frontend": { "framework": "...", "ui": { "components": "..." } },
  "ai_design": { "type": "..." }
}
JSON

node "$DDT_PLUGIN_ROOT/bin/resolve-tech-stack.mjs" \
  --components-json /tmp/ddt-user-components.json \
  --write

rm /tmp/ddt-user-components.json
```

### 优先级链（从高到低）

CLI flag > **AskUserQuestion 收集结果** > project-brief.md "技术栈预设"（值非 interactive/custom） > 已存在的 `.ddt/tech-stack.json` > manifest 自动检测 > 默认 `java-modern`。

### 产出

`.ddt/tech-stack.json`（architect-agent 必读输入；**仅 resolve-tech-stack.mjs 可写入，agent 禁止编辑**）。

## Phase 3 — 派发 architect-agent

使用 Task 工具派发 `architect-agent`，传入：

- `docs/prd.md`（需求文档）
- `docs/wbs.md`（工作分解结构）
- `.ddt/tech-stack.json`（**M3 必读** 技术栈选型，禁止偏离）
- `templates/api-contract.template.yaml`（契约模板）
- `templates/data-model.template.md`（数据模型模板）
- `$ARGUMENTS`（架构倾向性说明）

architect-agent 产出：

| 产出文件 | 说明 |
|----------|------|
| `docs/arch.md` | 架构决策记录，含技术选型理由 |
| `docs/api-contract.yaml` | OpenAPI 3.0 契约 |
| `docs/data-model.md` | 数据模型（ER 图文字描述 + 字段规范） |

## Phase 4 — 自动契约 lint（硬门禁）

```bash
if command -v npx >/dev/null 2>&1; then
  npx --yes @redocly/cli lint docs/api-contract.yaml || exit 4
else
  echo "OpenAPI lint tool missing; cannot verify contract"
  exit 5
fi
```

契约 lint 失败必须停止，禁止推进到 `/impl`、`/build-web` 或 `/build-api`。

## Phase 5 — 汇总输出

```
/design 完成

ADR 决策数:   <n> 条
Endpoint 数:  <n> 个
契约 lint:    通过

产出文件:
  docs/arch.md
  docs/api-contract.yaml
  docs/data-model.md

建议下一步：/impl 或 /build-web / /build-api
```

## --refresh

传入 `--refresh` 时，重新读取 PRD、WBS 与技术栈信息，增量刷新架构、契约和数据模型；禁止替换整份产物或移除已有 ADR/变更记录。



## Phase 决策门 — M6.2 用户决策注入

按 `skills/decision-gate/SKILL.md` 标准模板执行：

### Step 1: 检查 --auto

如果 `$ARGUMENTS` 含 `--auto`，跳过决策门直接进入"标记阶段完成"。否则继续 Step 2。

### Step 2: 发射 decision_point 事件

```bash
if ! printf '%s' "$ARGUMENTS" | grep -q -- '--auto'; then
  node "$DDT_PLUGIN_ROOT/bin/emit-decision.mjs" --phase design --action point \
    --options "accept|modify|add|regenerate"
fi
```

### Step 3: LLM 调用 AskUserQuestion

```typescript
{
  questions: [{
    question: "架构 + 契约 已生成（ADR 数 / endpoint 数 / 数据模型实体数），如何继续？",
    header: "Design review",
    multiSelect: false,
    options: [
      { label: "接受并继续 (Recommended)",
         description: "进入 /impl",
         preview: "<填充本 phase 关键产物的 1-2 段摘要>" },
      { label: "修改某条具体内容",
         description: "我会指出哪条 + 怎么改" },
      { label: "新增内容",
         description: "我有遗漏的需求/字段/约束要补充" },
      { label: "重新生成（带说明）",
         description: "整体方向不对，重写本 phase" }
    ]
  }]
}
```

### Step 4: 收到答案后 emit decision_resolved

```bash
node "$DDT_PLUGIN_ROOT/bin/emit-decision.mjs" --phase design --action resolved \
  --user-action <accept|modify|add|regenerate|other> \
  --note "<用户备注摘要 ≤200 字>"
```

### Step 5: 按答案分支

| 用户选择 | 行为 |
|---------|------|
| 接受并继续 | 走"标记阶段完成"段落（emit-phase end）+ 提示用户运行 `/impl` |
| 修改某条 | 进一步问"哪条？怎么改？"，用 `--refresh` 增量修订 → 修订完再走一次决策门 |
| 新增内容 | 问"补充什么？"，用 `--refresh` 增量新增 → 决策门 |
| 重新生成 | 问"原因？要保留什么？"，用 `--refresh` 重生成（保留已确认部分） → 决策门 |
| Other | 解析意图，按 4 类映射；映射不上写 blocker |

**关键**：未收到用户决策前禁止进入下一 phase 命令，禁止 emit-phase end。

## Phase 末 — 标记阶段完成（M6.1.3）

```bash
node "$DDT_PLUGIN_ROOT/bin/emit-phase.mjs" --phase design --action end
```

$ARGUMENTS
