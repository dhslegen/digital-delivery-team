---
description: 通道执行器 · 派生 3 通道（claude-design / figma / v0）附件包，引导用户投喂工具并回贴结果
argument-hint: "[--channel claude-design|figma|v0|all] [--refresh] [--bundle <zip-path>] [--url <design-url>]"
---

# /design-execute

**输入**：$ARGUMENTS

把 `docs/design-brief.md`（10 字段 SSoT）派生为目标通道的附件包 + 通道专属 prompt，引导用户投喂工具，等用户回贴设计源后摄取到 `web/`。

---

## Phase 1 — 前置校验

```bash
git rev-parse --is-inside-work-tree 2>/dev/null || { echo "❌ 非 git 仓库"; exit 1; }

[ -f "$DDT_PLUGIN_ROOT/bin/aggregate.mjs" ] || DDT_PLUGIN_ROOT=$(cat "${HOME}/.claude/delivery-metrics/.ddt-plugin-root" 2>/dev/null)
[ -f "$DDT_PLUGIN_ROOT/bin/aggregate.mjs" ] || DDT_PLUGIN_ROOT="${HOME}/.claude/plugins/marketplaces/digital-delivery-team"
[ -f "$DDT_PLUGIN_ROOT/bin/aggregate.mjs" ] || { echo "❌ DDT plugin root 未解析。可能原因：(1) 插件未安装；(2) shell 中 DDT_PLUGIN_ROOT 指向无效路径，请 unset DDT_PLUGIN_ROOT 后重启会话；(3) 运行 /digital-delivery-team:doctor 自检"; exit 1; }
export DDT_PLUGIN_ROOT

node "$DDT_PLUGIN_ROOT/bin/emit-phase.mjs" --phase design-execute --action start
"$DDT_PLUGIN_ROOT/bin/check-blockers.sh" || exit 2

# 必需输入校验
test -f docs/design-brief.md || { echo "❌ 请先运行 /design-brief 生成 brief"; exit 1; }

# frontend.type 三态检查（PR-E）
FRONT_TYPE=$(node "$DDT_PLUGIN_ROOT/bin/get-frontend-type.mjs" 2>/dev/null)
if [ "$FRONT_TYPE" = "server-side" ] || [ "$FRONT_TYPE" = "none" ]; then
  echo "ℹ️  frontend.type=$FRONT_TYPE，/design-execute 跳过：服务端渲染由 /build-api 处理。"
  node "$DDT_PLUGIN_ROOT/bin/emit-phase.mjs" --phase design-execute --action end
  exit 0
fi
```

## Phase 2 — 解析参数

```bash
# 通道：默认 claude-design（首选默认，零外部账号）
CHANNEL=$(printf '%s' "$ARGUMENTS" | grep -oE -- '--channel [a-z0-9-]+' | awk '{print $2}')
CHANNEL=${CHANNEL:-claude-design}

# 外部回贴源（可选，等用户在通道完成后再传）
# W7.5 R9：用 bin/parse-cli-flag.mjs 解析含空格路径 + 单/双引号（grep [^ ]+ 会截断）
BUNDLE_PATH=$(node "$DDT_PLUGIN_ROOT/bin/parse-cli-flag.mjs" --flag bundle -- "$ARGUMENTS")
URL=$(node "$DDT_PLUGIN_ROOT/bin/parse-cli-flag.mjs" --flag url -- "$ARGUMENTS")

# B4: URL 白名单校验（防 shell 注入；只允许 http/https + 标准 URL 字符）
if [ -n "$URL" ] && ! printf '%s' "$URL" | grep -qE '^https?://[A-Za-z0-9._~:/?#@!$&'\''()*+,;=%-]+$'; then
  echo "❌ --url 含非法字符或非 http(s) 协议，已拒绝（防 shell 注入）"; exit 1
fi

# 派生 / 摄取分支：
#   - 无 --bundle 与 --url：派生附件包 + 提示用户操作
#   - 有 --bundle <zip>：摄取 zip（仅 claude-design 通道支持）
#   - 有 --url：摄取 share URL（figma / v0 通道）
case "$CHANNEL" in
  claude-design|figma|v0) ;;
  all) [ -n "$BUNDLE_PATH" ] && { echo "❌ --channel all 不可与 --bundle 同时使用"; exit 1; }
       [ -n "$URL" ]         && { echo "❌ --channel all 不可与 --url 同时使用"; exit 1; } ;;
  *) echo "❌ --channel 必须是 claude-design / figma / v0 / all（实测：$CHANNEL）"; exit 1 ;;
esac
```

## Phase 3 — 派发分支

### 分支 A：无 `--bundle` / `--url` → 派生通道附件包并提示用户

```bash
DERIVE_ARGS="--channel $CHANNEL"
printf '%s' "$ARGUMENTS" | grep -q -- '--refresh' && DERIVE_ARGS="$DERIVE_ARGS --refresh"

node "$DDT_PLUGIN_ROOT/bin/derive-channel-package.mjs" $DERIVE_ARGS || exit 4
```

派生器输出（按通道）：

| 通道 | 产物 |
|------|------|
| `claude-design`（默认） | `.ddt/design/claude-design/upload-package/`（7 文件） + `prompt.md` |
| `figma` | `.ddt/design/figma/upload-package/`（7 文件） + `prompt.md`（TC-EBC） |
| `v0` | `.ddt/design/v0/v0-sources/` + `project-instructions.md` + `prompts/<screen>.md` |

main thread 引导用户操作（按通道展开）：

#### claude-design

```
✅ Claude Design 附件包已生成：.ddt/design/claude-design/

请按以下步骤操作：
  1. 打开 https://claude.ai/design 创建新项目
  2. 项目模式选 "Design System"，命名 "<project>-ds"（先建 DS）
  3. 把 .ddt/design/claude-design/upload-package/ 内 7 个文件全部拖入 uploads
  4. 粘贴 .ddt/design/claude-design/prompt.md 内容到对话框首条消息
  5. 在 Claude Design 内迭代设计（先建 DS，再 spawn Hi-fi design 项目）
  6. 完成后两种回贴方式：
     (优选) Share → Handoff to Claude Code → Local coding agent
     (备选) Download as .zip → 跑 /design-execute --channel claude-design --bundle <zip>
```

#### figma

```
✅ Figma 附件包已生成：.ddt/design/figma/

请按以下步骤操作：
  1. 打开 Figma Make（推荐）或 First Draft
  2. 上传 .ddt/design/figma/upload-package/07-references/ 内截图
  3. 粘贴 .ddt/design/figma/prompt.md 内容（TC-EBC 框架）
  4. 在 Figma 内完成设计稿
  5. 完成后回到 Claude Code 跑：
     /design-execute --channel figma --url <figma-file-url>
```

#### v0

```
✅ v0 通道附件包已生成：.ddt/design/v0/

请按以下步骤操作：
  1. 在 v0.dev 创建 Project（一次性，跨多次生成共享上下文）
  2. Settings → Sources：上传 .ddt/design/v0/v0-sources/ 内全部文件
     （openapi.yaml + tokens.css + design-brief.md + components-inventory.md）
  3. Settings → Instructions：粘贴 .ddt/design/v0/project-instructions.md 内容
  4. 每屏在 v0 chat 中粘贴对应 prompts/<screen>.md
  5. 每屏完成后回贴 share URL：
     /design-execute --channel v0 --url <v0-share-url>
```

派发完成后**等用户回贴**——main thread 不要继续 emit-phase end，等用户下次跑 `/design-execute --bundle ...` 或 `--url ...` 时再走 Phase 4。

### 分支 B：`--bundle <zip>` → 摄取 Claude Design zip

```bash
if [ -n "$BUNDLE_PATH" ]; then
  test -f "$BUNDLE_PATH" || { echo "❌ --bundle 文件不存在: $BUNDLE_PATH"; exit 1; }
  node "$DDT_PLUGIN_ROOT/bin/ingest-claude-design.mjs" --bundle "$BUNDLE_PATH" || exit 5
fi
```

> 注：`ingest-claude-design.mjs` 由 W4 实现。当前阶段（W3）若用户尝试 --bundle 会因脚本缺失而提示。

### 分支 C：`--url <share-url>` → 摄取 figma / v0 share

```bash
if [ -n "$URL" ]; then
  case "$CHANNEL" in
    figma) node "$DDT_PLUGIN_ROOT/bin/ingest-figma-context.mjs" --url "$URL" || exit 5 ;;
    v0)    node "$DDT_PLUGIN_ROOT/bin/ingest-v0-share.mjs"     --url "$URL" || exit 5 ;;
    *)     echo "❌ claude-design 通道用 --bundle <zip>，不用 --url"; exit 1 ;;
  esac
fi
```

> 注：摄取脚本由 W4 实现。

## Phase 4 — 摄取后构建 + 验证（仅 --bundle / --url 分支）

```bash
# 跑 web/ 构建 + lint + 测试
# W7.5 R11：按 lockfile 选包管理器（全局 CLAUDE.md 偏好 yarn；同时尊重项目实情）
if [ -d web ]; then
  PM=npm
  if   [ -f web/yarn.lock ];      then PM=yarn
  elif [ -f web/pnpm-lock.yaml ]; then PM=pnpm
  fi
  (cd web && $PM run build && $PM run lint && $PM run test) || exit 6
fi

# 10 维评分（W6 实现，先占位）
if [ -f "$DDT_PLUGIN_ROOT/bin/score-design-output.mjs" ]; then
  node "$DDT_PLUGIN_ROOT/bin/score-design-output.mjs" || true
fi
```

## Phase 5 — 决策门（M6.2）— 仅在摄取分支后触发

派发分支（无 --bundle / --url）不走决策门，等用户回贴后再走。

### Step 1: 检查 --auto

如果 `$ARGUMENTS` 含 `--auto`，跳过决策门。

### Step 2: 发射 decision_point 事件

```bash
if [ -n "$BUNDLE_PATH$URL" ] && ! printf '%s' "$ARGUMENTS" | grep -q -- '--auto'; then
  node "$DDT_PLUGIN_ROOT/bin/emit-decision.mjs" --phase design-execute --action point \
    --options "accept|modify|add|regenerate"
fi
```

### Step 3: LLM 调用 AskUserQuestion（含 10 维评分摘要）

```typescript
{
  questions: [{
    question: "设计稿已落地（<n> 组件 / <n> 屏 / 评分 <X>/100），如何继续？",
    header: "Design output review",
    multiSelect: false,
    options: [
      { label: "接受并继续 (Recommended)",
         description: "进入 /build-web 收尾",
         preview: "<10 维评分摘要>" },
      { label: "修复扣分项后重审",
         description: "指明哪几项要改" },
      { label: "重新跑通道",
         description: "设计方向不对，重新派发" },
      { label: "跳过评分强制接受",
         description: "记 blocker，强制通过" }
    ]
  }]
}
```

### Step 4: 收到答案后 emit decision_resolved

```bash
node "$DDT_PLUGIN_ROOT/bin/emit-decision.mjs" --phase design-execute --action resolved \
  --user-action <accept|modify|add|regenerate|other> \
  --note "<备注 ≤200 字>"
```

## Phase 6 — 汇总输出

派发分支：

```
/design-execute --channel <X> 派发完成

附件包: .ddt/design/<channel>/
prompt: .ddt/design/<channel>/prompt.md（或 project-instructions.md）

请按上方提示在外部工具完成设计，然后回贴 --bundle / --url 让 DDT 摄取。
```

摄取分支：

```
/design-execute 摄取完成

通道: <channel>
源:   <bundle-path | url>
落地: web/components/ + web/styles/tokens.css
评分: <X>/100

✅ 建议下一步：/build-web 跑构建 + checkpoint commit
```

## Phase 末 — 标记阶段完成

```bash
node "$DDT_PLUGIN_ROOT/bin/emit-phase.mjs" --phase design-execute --action end
```

## 可重入

`/design-execute` 是天然可重入的：
- 派发分支带 `--refresh` 重新生成附件包
- 摄取分支用新的 `--bundle` / `--url` 替换对应章节组件
- 已通过契约对齐 + 测试的组件不会重生成

## 与 v0.7 `/import-design` 的关系

`/import-design` 在 v0.8 **直接删除**（密集开发期，无历史用户）。`/design-execute` 是新命令，无 alias 链。

$ARGUMENTS
