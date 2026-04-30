# Figma Design Brief · {{PROJECT_NAME}}（TC-EBC 框架）

> 由 ddt-derive-channel-package 自动生成。**两种用法（任选其一）**：
>
> 1. **Figma Make**（2026 GA，推荐）：粘贴本 prompt 到 Figma Make 输入框 + 上传 07-references/ 截图
> 2. **First Draft**（Figma AI）：粘贴本 prompt 到 First Draft 入口（仅能用 Figma 自带库）
>
> 完成后回到 Claude Code：
>
> ```
> /design-execute --channel figma --url <figma-file-url>
> ```
>
> DDT 会通过 Figma MCP `get_design_context` 拉节点上下文转 React+Tailwind。

---

## Task

{{TASK_ONE_LINER}}

> 一句话目标，从 brief §1 Problem Alignment 提取。例：
> "为 Hello World demo 项目设计 1 个首页 + 错误提示页，纯 SSR Thymeleaf 架构。"

---

## Context（来自 brief §1 + §2）

**用户**：{{PERSONA}}
**核心场景**：{{SCENARIO}}
**核心痛点**：{{PAIN_POINT}}

### User Stories（来自 brief §2）

{{USER_STORIES_BLOCK}}

---

## Elements（信息架构 + 屏幕清单）

**页面树**：来自 brief §3 IA

```
{{IA_TREE}}
```

### 屏幕清单（来自 brief §4）

{{SCREEN_INVENTORY_PLACEHOLDER}}

> 详细清单见附件 01-design-brief.md §4，本段仅快速参考。

---

## Behavior（状态枚举 + 验证）

### 8 状态矩阵（来自 brief §5，**每个交互组件必画**）

| 状态 | 触发 | 视觉表现 |
|------|------|---------|
| default | 初始 | 静态 |
| hover | 鼠标悬停 | accent border / 轻微 elevation |
| active | 鼠标按下 | press 效果 |
| disabled | 不可用 | 50% opacity + cursor: not-allowed |
| focus | 键盘聚焦 | 焦点环（WCAG 2.1 AA） |
| loading | 等待响应 | spinner + 禁用交互 |
| empty | 无数据 | 空态插画 + 引导操作 |
| error | 失败 | 错误文案 + 重试按钮 |
| success | 完成 | 成功提示（auto-dismiss 3s） |

### Form 验证（来自 brief §7）

- **字段级**：实时（onBlur）+ 提交前
- **系统级**：401 / 429 / 5xx / network-offline 各有专属文案（见 brief §7 表格）
- **错误文案**必须对应 ErrorCode 枚举（来自 03-api-contract.yaml#components.schemas.ErrorCode），**禁止裸字符串**

---

## Constraints

### Visual Direction（强制单选，已锁定）

**方向**：`{{VISUAL_DIRECTION}}`
**理由**：{{VISUAL_DIRECTION_RATIONALE}}

不要混搭。如需改方向，输出"建议改为 X，理由 Y"让用户决策，**不要直接换风格**。

### Design Tokens（来自 05-design-tokens.json）

{{TOKENS_SUMMARY}}

> 完整 tokens 见附件 05-design-tokens.json。Figma 中请创建 Variables 与 Token 一一对应。

### 设备与可达性

- **平台**：Web responsive
- **断点**：sm 640 / md 768 / lg 1024 / xl 1280
- **a11y**：WCAG 2.1 AA（焦点环 / 对比度 ≥ 4.5:1 / 键盘导航 / 屏幕阅读器）

### 反 AI-slop 黑名单（11 条强制）

{{ANTI_PATTERNS_BLOCK}}

---

## References（用户上传的参考图）

{{REFERENCES_BLOCK}}

> 风格关键词：{{STYLE_KEYWORDS}}

---

## 高级用法：Code Connect 提前打桩

如果团队已经维护内部组件库（如 `@company/ui`），建议给主要组件打 Code Connect：

```
Button.figma.ts → @company/ui/Button
Input.figma.ts  → @company/ui/Input
```

这样 MCP `get_design_context` 会返回项目真实代码而不是通用 React+Tailwind。
详见 [https://developers.figma.com/docs/code-connect/](https://developers.figma.com/docs/code-connect/)

---

## 完成后

回到 Claude Code 跑：

```
/design-execute --channel figma --url <figma-file-url>
```

DDT 会自动：
- 通过 Figma MCP `get_design_context` 拉节点上下文
- 转 React+Tailwind 草稿
- 改写为符合 web/ 项目结构 + 项目契约的最终代码
- 跑构建 + lint + 测试 + 10 维评分决策门
