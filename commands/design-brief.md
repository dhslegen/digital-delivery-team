---
description: 设计 Brief 编译器 · 把 PRD + OpenAPI + tech-stack 编译为 docs/design-brief.md（10 字段 SSoT）
argument-hint: "[--refresh] [--visual-direction <name>] [--auto]"
---

# /design-brief

**输入**：$ARGUMENTS

把 `docs/prd.md` + `docs/api-contract.yaml` + `.ddt/tech-stack.json` + 用户附件，编译为 `docs/design-brief.md`（10 字段 SSoT），并准备好供 `/design-execute` 派生 3 通道（claude-design / figma / v0）的输入材料。

---

## Phase 1 — 前置校验

```bash
git rev-parse --is-inside-work-tree 2>/dev/null || { echo "❌ 非 git 仓库"; exit 1; }

[ -f "$DDT_PLUGIN_ROOT/bin/aggregate.mjs" ] || DDT_PLUGIN_ROOT=$(cat "${HOME}/.claude/delivery-metrics/.ddt-plugin-root" 2>/dev/null)
[ -f "$DDT_PLUGIN_ROOT/bin/aggregate.mjs" ] || DDT_PLUGIN_ROOT="${HOME}/.claude/plugins/marketplaces/digital-delivery-team"
[ -f "$DDT_PLUGIN_ROOT/bin/aggregate.mjs" ] || { echo "❌ DDT plugin root 未解析。可能原因：(1) 插件未安装；(2) shell 中 DDT_PLUGIN_ROOT 指向无效路径，请 unset DDT_PLUGIN_ROOT 后重启会话；(3) 运行 /digital-delivery-team:doctor 自检"; exit 1; }
export DDT_PLUGIN_ROOT

node "$DDT_PLUGIN_ROOT/bin/emit-phase.mjs" --phase design-brief --action start
"$DDT_PLUGIN_ROOT/bin/check-blockers.sh" || exit 2

# 必需输入校验
test -f docs/prd.md           || { echo "❌ 请先运行 /prd 生成 docs/prd.md"; exit 1; }
test -f docs/api-contract.yaml || { echo "❌ 请先运行 /design 生成 docs/api-contract.yaml"; exit 1; }
test -f .ddt/tech-stack.json   || { echo "❌ 请先运行 /design（会写入 .ddt/tech-stack.json）"; exit 1; }

# frontend.type 三态检查（PR-E）：仅 spa 才需要 brief
FRONT_TYPE=$(node "$DDT_PLUGIN_ROOT/bin/get-frontend-type.mjs" 2>/dev/null)
if [ "$FRONT_TYPE" = "server-side" ] || [ "$FRONT_TYPE" = "none" ]; then
  echo "ℹ️  frontend.type=$FRONT_TYPE，/design-brief 跳过：服务端渲染由 /build-api 处理；纯 API/CLI 无前端工程。"
  node "$DDT_PLUGIN_ROOT/bin/emit-phase.mjs" --phase design-brief --action end
  exit 0
fi
```

## Phase 2 — 编译 Brief

```bash
# 解析 --refresh 与 --visual-direction（透传给编译器）
COMPILE_ARGS=""
printf '%s' "$ARGUMENTS" | grep -q -- '--refresh' && COMPILE_ARGS="$COMPILE_ARGS --refresh"
VD=$(printf '%s' "$ARGUMENTS" | grep -oE -- '--visual-direction [a-z-]+' | awk '{print $2}')
if [ -n "$VD" ]; then COMPILE_ARGS="$COMPILE_ARGS --visual-direction $VD"; fi

node "$DDT_PLUGIN_ROOT/bin/compile-design-brief.mjs" $COMPILE_ARGS || exit 4
```

编译器自动产出：

| 产物 | 说明 |
|------|------|
| `docs/design-brief.md` | 10 字段 SSoT（用户故事 / IA / 屏幕清单 / 状态枚举 / 设计 token / 引用 / 约束 / 视觉方向 / anti-patterns） |
| `.ddt/design/tokens.json` | 默认 design tokens（首次跑时复制模板） |
| `.ddt/design/components-inventory.md` | 现有 shadcn / 项目组件清单（自动扫描 web/components/） |

## Phase 3 — 用户填空提示

`/design-brief` 自动抽取的字段：

- §2 **User Stories**（从 `docs/prd.md` 解析）
- §6 **API Endpoints**（从 `docs/api-contract.yaml` 解析）
- §9 **References**（如已上传 `.ddt/design/assets/*.png`）
- §11 **编译信息**（git sha / 时间戳）

需要用户**手动填写**的字段（编译器只准备占位）：

- §1 **Problem Alignment**（用户 / 痛点 / 为什么现在做 / 成功指标）
- §3 **Information Architecture**（页面树）
- §4 **Screen Inventory**（每屏入口 / 出口 / 数据 / 状态枚举）
- §5 **Component States**（8 状态矩阵）
- §7 **Validation & Error**（系统级错误文案）
- §8.1 **Visual Direction**（**强制 9 选 1**：brutally-minimal / editorial / industrial / luxury / playful / geometric / retro-futurist / soft-organic / maximalist）
- §10 **Constraints**（平台 / 断点 / a11y / 性能预算）

可选输入：

- 上传参考截图到 `.ddt/design/assets/`（命名 `ref-XX-<desc>.png`）
- 编辑 `.ddt/design/tokens.json` 调色

## Phase 4 — 决策门（M6.2）

按 `skills/decision-gate/SKILL.md` 标准模板执行。

### Step 1: 检查 --auto

如果 `$ARGUMENTS` 含 `--auto`，跳过决策门直接进入"标记阶段完成"。否则继续 Step 2。

### Step 2: 发射 decision_point 事件

```bash
if ! printf '%s' "$ARGUMENTS" | grep -q -- '--auto'; then
  node "$DDT_PLUGIN_ROOT/bin/emit-decision.mjs" --phase design-brief --action point \
    --options "accept|modify|add|regenerate"
fi
```

### Step 3: LLM 调用 AskUserQuestion

```typescript
{
  questions: [{
    question: "Design Brief 已生成（X 用户故事 / Y endpoints / Z 屏 / visual_direction=<...>），如何继续？",
    header: "Design Brief review",
    multiSelect: false,
    options: [
      { label: "接受并继续 (Recommended)",
         description: "进入 /design-execute --channel claude-design",
         preview: "<docs/design-brief.md 关键字段摘要>" },
      { label: "修改某节",
         description: "我会指出哪节要改（如 §4 Screen Inventory）" },
      { label: "新增内容",
         description: "上传新参考图 / 补充 IA / 添加屏幕" },
      { label: "重新生成（带说明）",
         description: "整体方向不对，重写 brief" }
    ]
  }]
}
```

### Step 4: 收到答案后 emit decision_resolved

```bash
node "$DDT_PLUGIN_ROOT/bin/emit-decision.mjs" --phase design-brief --action resolved \
  --user-action <accept|modify|add|regenerate|other> \
  --note "<用户备注摘要 ≤200 字>"
```

### Step 5: 按答案分支

| 用户选择 | 行为 |
|---------|------|
| 接受并继续 | 走"标记阶段完成"段落（emit-phase end）+ 提示用户运行 `/design-execute --channel claude-design` |
| 修改某节 | LLM 询问"哪节？改成什么？"，main thread 直接 Edit `docs/design-brief.md` 对应段；改完再走一次决策门 |
| 新增内容 | LLM 询问"补充什么？"，引导用户上传 `.ddt/design/assets/<file>.png` 或编辑 brief；改完再走决策门 |
| 重新生成 | LLM 询问"原因？保留什么？"，跑 `node $DDT_PLUGIN_ROOT/bin/compile-design-brief.mjs --refresh`，保留已确认部分；再走决策门 |
| Other | 解析意图，按 4 类映射；映射不上写 `docs/blockers.md` |

**关键**：未收到用户决策前禁止进入下一 phase 命令，禁止 emit-phase end。

## Phase 5 — 汇总输出

```
/design-brief 完成

User Stories: <n> 条（从 PRD 抽取）
API Endpoints: <n> 个（从 OpenAPI 抽取）
Screens: <n> 屏（用户填写）
Visual Direction: <selected>
Reference Assets: <n> 张

产出文件:
  docs/design-brief.md
  .ddt/design/tokens.json
  .ddt/design/components-inventory.md

✅ 建议下一步：/design-execute --channel claude-design（默认）
   或 --channel figma / --channel v0
```

## Phase 末 — 标记阶段完成

```bash
node "$DDT_PLUGIN_ROOT/bin/emit-phase.mjs" --phase design-brief --action end
```

## --refresh

`--refresh` 重新读取 PRD / api-contract / tech-stack 并增量刷新 brief；保留用户已确认部分（visual_direction / IA / Screen Inventory），**禁止**无差别覆盖整份产物或丢失变更记录。

## --visual-direction `<name>`

非交互模式下显式指定 9 种风格之一（CI / 自动化场景）。合法值：`brutally-minimal` / `editorial` / `industrial` / `luxury` / `playful` / `geometric` / `retro-futurist` / `soft-organic` / `maximalist`。

$ARGUMENTS
