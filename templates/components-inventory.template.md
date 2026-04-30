# Components Inventory · <项目名称>

> 本清单告诉外部设计工具（claude.ai/design / Figma / v0）：**项目已有这些组件，请复用，不要新造**。
> 编译时由 design-brief-compiler 扫描 `web/components/`、`shadcn` 安装记录、`@<scope>/ui` 等内部库自动生成；缺失字段由用户补充。

## 1. shadcn/ui 已安装组件

> 来自 `web/components/ui/` 与 `components.json` 注册表。

| 组件 | 路径 | 8 状态完备度 | 注释 |
|------|------|-------------|------|
| Button | `web/components/ui/button.tsx` | ✅ default/hover/active/disabled/focus/loading/error/success | 已含 variant: primary/secondary/ghost/destructive |
| Input | `web/components/ui/input.tsx` | ⚠️ 缺 loading | 待补 |
| Form | `web/components/ui/form.tsx` | ✅ | react-hook-form + zod |
| Card | `web/components/ui/card.tsx` | ⚠️ 缺 empty/error | 待补 |
| Dialog | `web/components/ui/dialog.tsx` | ✅ | Radix 底座 |

## 2. 项目自有组件

> 来自 `web/components/` 中非 ui/ 的目录。

| 组件 | 路径 | 用途 | 复用建议 |
|------|------|------|---------|
| `<DataTable>` | `web/components/data-table.tsx` | 通用数据表格 | 优先复用，新表格不要从零写 |
| `<EmptyState>` | `web/components/empty-state.tsx` | 空态占位 | 所有"无数据"场景必须用 |
| `<ErrorBoundary>` | `web/components/error-boundary.tsx` | 错误边界 | 路由级必须包裹 |

## 3. 内部 monorepo 组件库（如有）

> 来自 `packages/<scope>/<lib>/`（lerna / pnpm workspace / nx）。

| 组件 | 包名 | 入口 | 文档 |
|------|------|------|------|
| - | - | - | - |

## 4. 第三方依赖（可参考但不可改）

> 用户不应改动，但 AI 生成代码时应知悉避免冲突。

| 库 | 版本 | 用途 |
|----|------|------|
| `@radix-ui/react-*` | 1.x | shadcn 底座，无需直接 import |
| `lucide-react` | 0.4x | 图标库（首选） |
| `@tanstack/react-query` | 5.x | 服务端态管理 |
| `react-hook-form` | 7.x | 表单 |
| `zod` | 3.x | schema 校验 |

## 5. 红线（外部生成代码触发任一即丢弃）

- ❌ 新造 Button / Input / Card / Dialog（这些已在 §1 提供）
- ❌ 用 antd / mui / chakra-ui（与 shadcn 不兼容）
- ❌ 用 `redux` / `mobx` / `recoil`（项目已选 zustand + react-query）
- ❌ 用 `axios` / 裸 `fetch`（必须经 `web/lib/api-client.ts`）

---

## 编译信息

```yaml
generated_at: <ISO 8601 timestamp>
sources:
  shadcn: web/components.json
  custom: web/components/
  monorepo: packages/*/package.json (if exists)
notes: |
  本文件由 design-brief-compiler 自动维护。
  手动编辑会被下次 /design-brief --refresh 覆盖；
  如需固化注释，写到 web/components/<X>.tsx 文件头。
```
