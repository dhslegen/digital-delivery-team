<!-- 来源: ddt-team-admin-v0.8.1, 时间: 2026-05-06, DDT: v0.8.1→v0.8.2, 触发: D6 (visual_direction 多行解析) -->
# Design Brief · node-modern

> 版本：v1.0 · 作者：design-brief-agent · 日期：2026-05-06 · 项目：`proj-motby8l1-dg56gs`
>
> 由 /design-brief 自动编译。**编辑此文件后跑 /design-brief --refresh**，不要直接改 .ddt/design/<channel>/ 内的派生产物。
> Brief 是 SSoT，3 个通道（Claude Design / Figma / v0）的 prompt 与附件包都从它派生。

---

## 1. Problem Alignment

**用户（主要）**：运营经理，中型 SaaS 公司，5–20 人小团队，每周 5–10 次成员变更操作，同时使用 Google Workspace / Notion / Slack 等 3 个以上工具完成一次完整的入职流程，核心关注点是操作效率与可审计性。

**用户（次要）**：HR / IT 协作员，偶发性批量入职与离职清理，关注操作准确性与能否撤销错误。

**核心痛点（3 条）**：
1. 成员管理动作分散在 Google Workspace / Notion / Slack 等多工具中，一次新员工入职平均耗时 2 个工作日，运营经理需要在多处手工同步数据。
2. 权限变更无单一记录源，变更追溯困难；遇到合规审查或安全事件时无法快速提供完整的操作证据链。
3. 现有工具缺乏角色冲突检测，运营经理在不依赖工程师的情况下无法安全调整组织权限结构，导致权限设置错误风险高。

**为什么现在做**：合规审查要求所有敏感操作 100% 可追溯；业务规模增长使多工具手工同步成本超过可接受阈值；自助运营目标要求去除对工程师的操作依赖。

**成功指标（G1–G4，直接来自 PRD §2）**：
- G1：单次入职流程（创建 → 分配角色 → 发送邀请）≤ 5 分钟
- G2：90% 的角色变更操作在 30 秒内完成（含搜索定位）
- G3：所有敏感操作（删除 / 降权 / 批量改）100% 写入审计日志，含操作人 / 前后值 / 时间戳
- G4：新人首次使用 5 分钟内完成第一次成员创建，无需文档或培训

---

## 2. User Stories

> 编译器正则未能匹配 PRD 中文加粗格式（"**用户故事**：As an `运营经理`..."），以下 5 条由 design-brief-agent 从 PRD §4 手动提取并覆盖编译器占位。

- **F1 成员列表**：As an `运营经理`，I want `在一个分页列表中快速定位成员并执行批量操作`，so that `我不需要在多个工具间跳转就能完成日常团队管理`。
  → 关键 AC：筛选栏（角色 + 状态）立即刷新列表；批量停用需二次确认弹窗，操作完成后审计日志同步记录操作人、前后状态；搜索无结果展示空状态提示而非报错。

- **F2 创建成员**：As an `运营经理`，I want `通过 4 步分步表单快速创建新成员并分配角色`，so that `新员工可以在 5 分钟内完成权限开通，而不是等待 2 个工作日`。
  → 关键 AC：邮箱格式非法时字段下方即时展示错误，"下一步"保持禁用；邮箱已存在时展示内联错误 `CONFLICT` 阻止进入 Step2；表单意外关闭后不保留草稿，用户从 Step1 重新开始。

- **F3 成员详情**：As an `运营经理`，I want `在一个页面内查看成员完整信息、角色权限与操作历史`，so that `当需要排查权限问题或追溯变更原因时，无需查询多个系统`。
  → 关键 AC：删除成员必须在确认输入框中键入成员姓名方可执行（`DELETE /members/{id}` 需携带 `X-Confirm-Name` header）；操作历史标签为空时展示"暂无操作记录"空状态。

- **F4 审计日志**：As an `运营经理`，I want `在统一的审计日志流水页面检索和导出所有操作记录`，so that `遇到合规审查或安全事件时，可以快速提供完整的操作证据链`。
  → 关键 AC：全文搜索响应 ≤ 500ms；CSV 导出按当前筛选结果生成，不含密码/token 字段；10,000+ 条记录时使用虚拟滚动，初始渲染 ≤ 2s；审计日志 UI 层无编辑/删除入口。

- **F5 角色管理**：As an `运营经理`，I want `通过可视化权限矩阵编辑角色权限并检测冲突`，so that `在不依赖工程师的情况下，安全地调整组织内的权限结构`。
  → 关键 AC：同时勾选互斥权限（如 read + write 同一资源）时弹出冲突提示并阻止保存；继承权限与直接权限以不同颜色/标签区分；角色下仍有活跃成员时拒绝删除角色。

---

## 3. Information Architecture

**导航模式**：左侧固定侧边栏（240px 宽，始终可见）+ 顶部 breadcrumb 栏 + 右上角用户菜单。理由：dense + professional 后台用户的操作频率高、模块间跳转频繁，固定侧边栏消除了"收起/展开"的认知成本，比顶部导航在信息密度上更有优势；与 Linear / Stripe Dashboard 等参考产品的导航模式一致。

```text
/ (根路由)
  └─ 跳转至 /members（无仪表盘，直接进入核心功能）

左侧导航
  ├─ 成员管理        → /members
  ├─ 审计日志        → /audit-logs
  └─ 角色管理        → /roles

/members                              成员列表页
  ├─ 筛选栏（角色下拉 / 状态下拉 / 关键词搜索）
  ├─ 批量操作工具栏（勾选后浮现：批量启用 / 批量停用）
  ├─ TanStack Table 分页列表（pageSize 默认 20）
  └─ /members/new                     创建成员（单独页面，非模态）
       ├─ Step 1: 基本信息（姓名 / 邮箱 / 手机 / 入职日期）
       ├─ Step 2: 分配角色（多选角色列表）
       ├─ Step 3: 通知偏好（邮件 / 短信开关）
       └─ Step 4: 确认预览（只读摘要 + "确认创建"按钮）

/members/{id}                         成员详情页
  ├─ Tab 1: 基本信息（姓名 / 邮箱只读 / 手机 / 状态 / 入职日期 / 通知偏好，可编辑）
  ├─ Tab 2: 角色矩阵（当前角色列表 + 权限继承展示，可修改）
  ├─ Tab 3: 操作历史（时间线倒序，每条含操作类型/操作人/时间/前后值）
  └─ 危险区域（页面底部）: 软删除成员（DangerConfirmDialog）

/audit-logs                           审计日志流水页
  ├─ 筛选栏（操作类型下拉 / 时间范围选择 / 全文搜索框）
  ├─ TanStack Table 虚拟滚动列表（TanStack Virtual，仅渲染可视区域）
  └─ CSV 导出触发器（工具栏按钮 → 直接调 GET /audit-logs/export.csv，不弹独立路由）

/roles                                角色管理页
  ├─ 角色列表（左侧面板，可点选）
  └─ 权限矩阵编辑器（右侧主区域，resource × action 复选框矩阵 + 继承权限高亮）

全局 Layout
  ├─ 左侧导航栏（固定，240px）
  ├─ 顶部 breadcrumb 栏（含当前路径 + 右上角用户头像/菜单）
  └─ 主内容区（flex-1，含页头 + 操作按钮区 + 内容区）
```

**说明**：创建成员采用独立路由 `/members/new` 而非模态弹窗，理由是 4 步分步表单在模态内布局局促（Step 4 含完整预览），独立页面能提供更充裕的内容空间，且浏览器后退行为更符合用户心智模型。

---

## 4. Screen Inventory

### Screen 1: 成员列表 (`/members`)

- **角色**：运营经理（拥有 `p-member-read` 权限的所有用户）
- **入口**：左侧导航"成员管理"链接；根路由 `/` 重定向；创建成员完成后重定向回此页
- **出口**：点击行 → `/members/{id}`；点击"创建成员"→ `/members/new`；左侧导航 → `/audit-logs` 或 `/roles`
- **数据来源**：
  - `GET /members?page=&pageSize=&role=&status=&q=` → `PaginatedMemberResponse`（见 api-contract.yaml#L33）
  - `POST /members:batch-update` → `BatchUpdateMembersResponse`（见 api-contract.yaml#L276，批量操作写回）
- **关键交互**：
  1. 筛选栏变更（角色 / 状态 / 搜索词）立即重新请求列表，无需手动点击"搜索"
  2. 勾选 1+ 行后批量操作工具栏从隐藏变为可见（浮现在列表上方）
  3. 点击"批量停用"弹出 `DangerConfirmDialog`，确认后调 `POST /members:batch-update`，partial-success 时展示失败明细 toast
  4. 分页跳转清空已选项，工具栏显示"已选中第 N 页 X 条"，不跨页合并选择
  5. 列表行 hover 展示快捷操作图标（查看详情）
- **状态枚举**：empty（搜索无结果）/ loading（首次加载 + 筛选变更）/ success（正常展示）/ error（网络/5xx，展示 inline 错误 + 重试按钮）/ unauthorized（401，跳转 /login）/ forbidden（403，展示无权限提示）/ partial-success（批量操作部分失败，toast 展示 failedItems）
- **特殊约束**：不跨页合并选择（PRD F1 AC 明确）；搜索无结果返回空数组不报 404（api-contract.yaml#L39）

---

### Screen 2: 创建成员 (`/members/new`)

- **角色**：运营经理（拥有 `p-member-write` 权限）
- **入口**：成员列表页"创建成员"按钮；浏览器直接访问 URL
- **出口**：创建成功 → 重定向至 `/members/{newId}`（成员详情页）；取消 / 浏览器后退 → `/members`
- **数据来源**：
  - `GET /roles` → `Role[]`（Step 2 角色选择，见 api-contract.yaml#L495）
  - `POST /members` → `Member`（Step 4 确认提交，见 api-contract.yaml#L114）
- **关键交互**：
  1. Step 1 邮箱字段失焦时即时校验格式（zod email schema），格式非法时"下一步"禁用
  2. 点击"下一步"时前端先校验当前 step 字段，后端校验邮箱唯一性（409 CONFLICT → 展示内联错误阻止进入 Step 2）
  3. 步骤进度条展示当前 step（1/4 到 4/4），已完成 step 可点击回退修改
  4. Step 4 为只读预览摘要（姓名/邮箱/角色/通知偏好）+ "确认创建"按钮，点击后按钮进入 loading 状态
  5. 表单意外关闭后不做草稿持久化，重新打开从 Step 1 开始，页面有明确提示"表单未保存"（PRD F2 AC 明确）
- **状态枚举**：default（Step 1 初始）/ loading（提交中，"确认创建"按钮 spinner）/ error（422 字段级错误 inline 展示）/ success（重定向至详情页）/ unauthorized（401）/ forbidden（403，无创建权限）
- **特殊约束**：4 步分步表单进度不持久化（v1.0 范围外）；邮箱唯一性服务端校验在 Step 1 "下一步"时触发，避免用户填完 4 步后才报错

---

### Screen 3: 成员详情 (`/members/{id}`)

- **角色**：运营经理（`p-member-read`）；编辑/删除操作需 `p-member-write`
- **入口**：成员列表点击行；创建成员完成后的重定向目标
- **出口**：Tab 切换（同页内）；删除成功 → 重定向至 `/members`；左侧导航 → 其他模块
- **数据来源**：
  - `GET /members/{id}` → `Member`（基本信息 + 角色 ID 列表，见 api-contract.yaml#L167）
  - `PATCH /members/{id}` → `Member`（基本信息 / 角色更新，见 api-contract.yaml#L195）
  - `DELETE /members/{id}` → 204（软删除，需 `X-Confirm-Name` header，见 api-contract.yaml#L239）
  - `GET /audit-logs?targetKind=member&targetId={id}` → `PaginatedAuditLogResponse`（操作历史 Tab，见 api-contract.yaml#L316）
- **关键交互**：
  1. Tab 1（基本信息）：行内编辑模式，点击"编辑"后字段变为可编辑，保存时调 `PATCH /members/{id}`
  2. Tab 2（角色矩阵）：多选角色，保存前校验角色冲突（422 时展示冲突说明）
  3. Tab 3（操作历史）：时间线倒序展示，每条含操作类型标签/操作人/相对时间/展开变更前后值；空状态展示"暂无操作记录"
  4. 删除成员：点击危险区域"删除成员"→ 弹出 `DangerConfirmDialog`（输入框要求键入成员姓名）→ 匹配后"确认删除"按钮启用 → 调 `DELETE /members/{id}` 含 `X-Confirm-Name` header
  5. 确认输入框内容与成员姓名不匹配时"确认删除"按钮保持禁用（前端校验，与 PRD F3 AC 对应）
- **状态枚举**：loading（首次加载）/ success（正常展示）/ error（404 成员不存在 / 5xx）/ unauthorized（401）/ forbidden（403，无读取权限）/ empty（操作历史 Tab 无记录）
- **特殊约束**：email 字段创建后只读（PATCH /members/{id} 不接受 email 变更，api-contract.yaml#L199）；软删除后状态显示"已停用"，详情页仍可查看（status=deleted）

---

### Screen 4: 审计日志 (`/audit-logs`)

- **角色**：运营经理（`p-audit-read`）；无写入入口（UI 层无编辑/删除按钮）
- **入口**：左侧导航"审计日志"链接
- **出口**：CSV 导出（触发浏览器下载，不跳路由）；左侧导航 → 其他模块；无行级钻取路由（详情通过展开行内联展示）
- **数据来源**：
  - `GET /audit-logs?page=&pageSize=&actionType=&q=&from=&to=` → `PaginatedAuditLogResponse`（见 api-contract.yaml#L316）
  - `GET /audit-logs/{id}` → `AuditLog`（行展开详情，见 api-contract.yaml#L412）
  - `GET /audit-logs/export.csv?actionType=&q=&from=&to=` → CSV 文件流（见 api-contract.yaml#L443）
- **关键交互**：
  1. 全文搜索框输入（匹配 actorName / targetSnapshot / 邮箱），防抖 300ms 后触发请求，响应 SLA ≤ 500ms（PRD F4 AC）
  2. 操作类型下拉（`actionType` 枚举：member.create / member.update / member.softDelete / member.batchDisable / member.batchEnable / role.permissionChange / role.create / role.delete）+ 时间范围选择器联动筛选
  3. 列表使用 TanStack Virtual 虚拟滚动，10,000+ 条仅渲染可视区域 DOM，初始渲染 ≤ 2s（PRD F4 AC）
  4. 点击"导出 CSV"按钮：按当前筛选参数调 `GET /audit-logs/export.csv`，触发浏览器下载；按钮进入 loading 状态直到响应完成
  5. 行展开（点击行）内联展示完整 `beforeValue` / `afterValue` JSON，避免跳路由
- **状态枚举**：loading（首次加载 + 筛选变更）/ success（正常展示）/ empty（筛选无结果）/ error（5xx，inline 错误 + 重试）/ unauthorized（401）/ rate-limited（429，展示倒计时提示）
- **特殊约束**：虚拟滚动初始渲染 ≤ 2s（PRD AC）；全文搜索响应 ≤ 500ms（PRD AC）；CSV 不包含密码/token 字段（契约保证，api-contract.yaml#L448）；UI 层无编辑/删除入口（PRD F4 AC）

---

### Screen 5: 角色管理 (`/roles`)

- **角色**：运营经理（`p-role-read`；编辑需 `p-role-write`）
- **入口**：左侧导航"角色管理"链接
- **出口**：左侧导航 → 其他模块；权限矩阵保存成功 → 停留当前页（不跳转）
- **数据来源**：
  - `GET /roles` → `Role[]`（角色列表 + permissionIds，见 api-contract.yaml#L495）
  - `GET /permissions` → `Permission[]`（权限元数据，用于矩阵行渲染，见 api-contract.yaml#L570）
  - `PATCH /roles/{id}/permissions` → `Role`（权限矩阵保存，见 api-contract.yaml#L524）
- **关键交互**：
  1. 左侧角色列表点选后，右侧权限矩阵更新为所选角色的 `permissionIds`（resource × action 复选框）
  2. 继承权限（`inheritsFromRoleId` 不为 null 时）以不同颜色/标签区分直接权限（可勾选）和继承权限（只读展示，灰色）
  3. 勾选互斥权限组合（检查 PermissionConflict 表）时前端即时高亮冲突，"保存变更"按钮禁用并展示冲突说明；若前端漏检后端返回 422 时 inline 展示冲突明细
  4. 点击"保存变更"弹出确认弹窗（非 DangerConfirmDialog，普通确认），确认后调 `PATCH /roles/{id}/permissions`
  5. 角色删除（仅当 `p-role-write`）：检查是否有活跃成员引用，有则展示"该角色下仍有 N 名成员，请先转移成员后再删除"（PRD F5 AC）
- **状态枚举**：loading（初始加载角色 + 权限列表）/ success（正常展示矩阵）/ error（保存失败：422 冲突 / 5xx）/ empty（无任何角色，展示"暂无角色"空状态）/ forbidden（403，无权限编辑）/ unauthorized（401）
- **特殊约束**：权限矩阵互斥检测在前端即时校验（避免用户填完后提交才报错）；`PATCH /roles/{id}` 修改角色名称接口在 api-contract.yaml v1.0 未暴露，本屏不提供角色重命名入口（见 api-contract.yaml#L531 注释）

---

## 5. Component States（强制 8 状态矩阵）

> 5 类组件 × 8 状态，覆盖表格 / 多步表单 / 危险确认弹窗 / 抽屉（本项目实现为详情 Tab 页而非抽屉，见说明）/ 时间线。

**关于 Drawer/Sheet**：成员详情使用独立路由 `/members/{id}` + Tab 组件，而非侧边抽屉，理由是详情页信息量大（3 个 Tab + 操作历史时间线），抽屉宽度不足以展示完整内容。Tab 组件的 8 状态在此纳入矩阵。

---

### 组件 1：DataTable（成员列表 / 审计日志）

| 状态 | 视觉描述 | 触发条件 | a11y 备注 |
|------|---------|---------|---------|
| default | 行背景 neutral-0，分割线 neutral-100，文字 neutral-900，固定列头 | 数据加载完成，无交互 | `role="grid"`，列头 `scope="col"` |
| hover | 行背景变为 neutral-50（#F6F8FA），行尾快捷操作图标出现 | 鼠标悬停在数据行 | 不依赖 hover-only 展示关键信息（hover 图标为快捷入口，不是唯一入口）|
| focus-visible | 聚焦行有 2px solid primary 描边，行背景 neutral-50 | 键盘 Tab 或方向键导航到行 | `outline` 不可去除；屏幕阅读器宣告行数据 |
| active | 行背景 primary/10（#EBF3FF），左侧复选框选中蓝色 | 点击行复选框选中 | `aria-selected="true"` |
| disabled | 行文字颜色 neutral-300，复选框不可交互（已停用成员） | 成员 status=disabled 时行级样式 | `aria-disabled="true"`，仍可键盘导航但无法选中 |
| loading | 骨架屏（Skeleton）占位，列头保留，行区域 pulse 动画 | 首次加载 / 筛选参数变更 / 翻页 | `aria-busy="true"` 挂载在 table 容器 |
| empty | 整行跨列居中展示"未找到匹配成员"文字 + 重置筛选链接 | `GET /members` 返回空数组 | `role="status"` 宣告空状态文字 |
| error | 行区域替换为 inline 错误卡片，含错误文案 + "重试"按钮 | 网络错误 / 5xx 响应 | `role="alert"` 宣告错误，焦点移至错误区 |

---

### 组件 2：MultiStepForm（创建成员 4 步）

| 状态 | 视觉描述 | 触发条件 | a11y 备注 |
|------|---------|---------|---------|
| default | 步骤进度条（1/4 高亮当前 step），当前 step 表单字段可编辑，"下一步"按钮 primary | Step 初始状态，用户未输入 | `role="group"` 包裹当前 step 字段，`aria-label="步骤 1/4：基本信息"` |
| hover | 输入框边框 neutral-500（加深），"下一步"按钮背景 primary-hover | 鼠标悬停在输入框或按钮 | 不影响功能 |
| focus-visible | 输入框 2px solid primary 描边，label 保持可见 | Tab 导航到字段 | `outline` 不去除；`aria-describedby` 指向字段说明 |
| active | 输入框背景 neutral-50，文字输入中 | 用户正在输入 | 输入字符实时宣告 |
| disabled | "下一步"按钮背景 neutral-200，文字 neutral-500，`cursor-not-allowed` | 当前 step 存在校验错误 / 必填字段为空 | `aria-disabled="true"`，`button` 不 `disabled` 属性（保留 tab 可达）而用 `aria-disabled` |
| loading | "确认创建"按钮（Step 4）显示 spinner，按钮文字变为"创建中..."，表单字段只读 | Step 4 点击"确认创建"后，等待 `POST /members` 响应 | `aria-live="polite"` 宣告"正在创建成员" |
| error | 字段下方红色 inline 错误文案（zod 校验 / 422 fieldErrors），字段边框变 danger 色 | 格式校验失败 / 后端 422 响应 | `role="alert"` 挂载在错误文案元素，`aria-invalid="true"` 在字段 |
| empty | Step 1 初始状态：所有字段空，进度条显示第 1 步；不是错误状态 | 首次打开 `/members/new` | 页面标题"创建成员 · 步骤 1/4"由 `<h1>` 宣告 |

---

### 组件 3：DangerConfirmDialog（删除成员 / 批量停用）

| 状态 | 视觉描述 | 触发条件 | a11y 备注 |
|------|---------|---------|---------|
| default | 模态居中，标题红色 danger，说明文字 neutral-700，确认输入框空，"确认删除"按钮 danger 但 disabled | 弹窗打开，用户未输入确认文字 | `role="dialog"`，`aria-modal="true"`，焦点自动移至确认输入框；`aria-labelledby` 指向弹窗标题 |
| hover | "取消"按钮 hover 背景 neutral-100；"确认删除"按钮（启用后）hover 背景 danger-hover | 鼠标悬停在操作按钮 | 不影响功能 |
| focus-visible | 确认输入框 2px solid danger 描边；按钮 focus 有 2px solid primary 描边 | Tab 导航在弹窗内循环（focus trap） | focus trap 限制在弹窗内，禁止 Tab 跳出；Esc 键关闭弹窗 |
| active | "确认删除"按钮按下时背景 danger-active | 鼠标按住"确认删除" | 不需要特殊 a11y |
| disabled | "确认删除"按钮背景 neutral-200，文字 neutral-500 | 确认输入框内容与成员姓名不匹配 | `aria-disabled="true"`，提示文字"请输入完整的成员姓名以确认" |
| loading | "确认删除"按钮 spinner，遮罩层不可点击，输入框只读 | 点击"确认删除"后，等待 `DELETE /members/{id}` 响应 | `aria-live="polite"` 宣告"正在删除成员" |
| error | 弹窗内展示 inline 错误（如 422 名称不匹配 / 5xx），"重试"链接 | 后端返回 4xx/5xx | `role="alert"` 宣告错误 |
| empty | 不适用（弹窗始终有内容）| — | — |

---

### 组件 4：DetailTab（成员详情 Tab 组件，替代 Drawer）

| 状态 | 视觉描述 | 触发条件 | a11y 备注 |
|------|---------|---------|---------|
| default | Tab 栏（基本信息 / 角色矩阵 / 操作历史），当前 Tab 下划线 primary，内容区渲染当前 Tab | 页面加载完成，Tab 1 默认激活 | `role="tablist"`，Tab 按钮 `role="tab"`，内容区 `role="tabpanel"` |
| hover | Tab 按钮 hover 时文字 primary，背景 neutral-50 | 鼠标悬停在 Tab 按钮 | 不影响功能 |
| focus-visible | Tab 按钮聚焦时 2px solid primary 描边 | 键盘 Tab 导航到 Tab 按钮 | 方向键左右切换 Tab（ARIA Tabs 模式） |
| active | 已选中 Tab 下划线 primary + 文字 primary + `aria-selected="true"` | 点击或键盘激活 Tab | `aria-selected="true"` 在选中 Tab |
| disabled | 不适用（所有 Tab 在 v1.0 范围内始终可点） | — | — |
| loading | Tab 内容区显示 Skeleton 骨架屏，Tab 按钮不受影响 | 切换 Tab 时加载新内容 | Tab 按钮 `aria-busy="true"` 仅在内容加载中 |
| empty | 操作历史 Tab：整区域居中展示"暂无操作记录" + 说明文字 | `GET /audit-logs?targetId={id}` 返回空数组 | `role="status"` 宣告空状态 |
| error | Tab 内容区 inline 错误卡片 + 重试按钮（成员 404 或 5xx） | API 返回 4xx/5xx | `role="alert"` 宣告错误 |

---

### 组件 5：Timeline（操作历史时间线）

| 状态 | 视觉描述 | 触发条件 | a11y 备注 |
|------|---------|---------|---------|
| default | 垂直时间线：左侧时间轴线 neutral-200 + 圆点（颜色按操作类型：danger/warning/success/neutral）+ 右侧事件卡片（操作类型标签 / 操作人 / 相对时间 / 折叠的 before/after 值） | 数据加载完成，无交互 | `role="list"`，每条记录 `role="listitem"` |
| hover | 事件卡片背景 neutral-50，折叠区域展开箭头高亮 | 鼠标悬停在事件卡片 | 不依赖 hover-only 展示关键信息 |
| focus-visible | 事件卡片有 2px solid primary 描边 | 键盘导航到事件卡片 | 支持键盘展开/收起 before/after 值 |
| active | 事件卡片背景 neutral-100，before/after 区域展开 | 点击事件卡片展开 | `aria-expanded="true/false"` 在可展开按钮 |
| disabled | 不适用（时间线纯展示，无禁用状态） | — | — |
| loading | 骨架屏（3-5 条 pulse 动画占位），时间轴线保留 | 切换到"操作历史"Tab / 滚动加载更多 | `aria-busy="true"` 挂载在时间线容器 |
| empty | 整区域居中展示"暂无操作记录"文字 + 图标 | 新创建成员，无任何变更记录 | `role="status"` 宣告空状态 |
| error | inline 错误卡片（替代时间线内容）+ 重试按钮 | `GET /audit-logs` 返回 5xx | `role="alert"` 宣告错误，焦点移至错误区 |

---

## 6. Data & API Contract

> 直接引用 `docs/api-contract.yaml`，不在此重复 schema。

**关键 endpoints**（按使用频率排序）：

- `GET /members` → 见 api-contract.yaml#L34，对应屏幕：成员列表（Screen 1）
- `POST /members` → 见 api-contract.yaml#L114，对应屏幕：创建成员（Screen 2）
- `GET /members/{id}` → 见 api-contract.yaml#L168，对应屏幕：成员详情（Screen 3）
- `PATCH /members/{id}` → 见 api-contract.yaml#L195，对应屏幕：成员详情（Screen 3）
- `DELETE /members/{id}` → 见 api-contract.yaml#L239，对应屏幕：成员详情（Screen 3）
- `POST /members:batch-update` → 见 api-contract.yaml#L277，对应屏幕：成员列表（Screen 1）
- `GET /audit-logs` → 见 api-contract.yaml#L317，对应屏幕：审计日志（Screen 4）、成员详情操作历史 Tab（Screen 3）
- `GET /audit-logs/{id}` → 见 api-contract.yaml#L413，对应屏幕：审计日志行展开（Screen 4）
- `GET /audit-logs/export.csv` → 见 api-contract.yaml#L444，对应屏幕：审计日志（Screen 4）
- `GET /roles` → 见 api-contract.yaml#L496，对应屏幕：角色管理（Screen 5）、创建成员 Step 2（Screen 2）
- `PATCH /roles/{id}/permissions` → 见 api-contract.yaml#L525，对应屏幕：角色管理（Screen 5）
- `GET /permissions` → 见 api-contract.yaml#L571，对应屏幕：角色管理权限矩阵渲染（Screen 5）

**禁止使用 mock 数据**。所有 fetch 必须经 `web/lib/api-client.ts`（由 `openapi-typescript` 生成）。

**契约对齐红线**（自动 lint 检测）：
- ❌ 出现 `mockData` / `fakeUsers` / `placeholder.*data` 关键字
- ❌ 出现 `fetch('/api/...')` / `axios.get(...)`（应走 api-client）
- ❌ 出现裸字符串错误文案（应对应 ErrorCode 枚举）

---

## 7. Validation & Error

### 字段级校验（react-hook-form + zod）

**CreateMemberRequest 字段校验规则（对应 F2 4 步表单）**：

- `email`：`z.string().email("请输入有效的邮箱地址")`，必填，失焦即校验；服务端唯一性校验在"下一步"时触发（409 CONFLICT → 内联错误"该邮箱已绑定其他成员账户"）
- `name`：`z.string().min(1, "姓名不能为空").max(64, "姓名不超过 64 个字符")`，必填
- `phone`：`z.string().max(32).nullable().optional()`，可选，如填写则校验格式（E.164 格式建议，PRD 未强制）
- `roleIds`：`z.array(z.string().uuid()).min(1, "至少选择一个角色")`，Step 2 必须选中至少 1 个角色
- `hireDate`：`z.string().date().nullable().optional()`，可选，格式为 ISO8601 日期
- `notificationPrefs.email`：`z.boolean()`，默认 true
- `notificationPrefs.sms`：`z.boolean()`，默认 false

**UpdateMemberRequest 字段校验规则（成员详情编辑）**：
- `name`：同上，可选（仅修改时传入）
- `phone`：同上，可选
- `roleIds`：`z.array(z.string().uuid()).min(1).optional()`，修改时至少保留 1 个角色
- 注意：`email` 字段不可修改（api-contract.yaml#L199 明确），前端不渲染 email 编辑入口

**UpdateRolePermissionsRequest 字段校验规则（角色权限矩阵）**：
- `permissionIds`：`z.array(z.string()).min(0)`，可为空数组（清空所有权限）
- 互斥检测：前端在用户勾选时即时查 PermissionConflict 规则，命中则高亮冲突对并禁用保存

**DangerConfirmDialog 确认文字校验**：
- 确认输入框：`z.string().refine(val => val === memberName, "请输入完整的成员姓名以确认")`，与成员当前 name 严格匹配

---

### 系统级错误文案（对应 ErrorCode 枚举 ProblemDetails.code）

| HTTP 状态码 | ErrorCode | 中文提示文案 | 用户操作建议 |
|-----------|-----------|------------|------------|
| 400 | `BAD_REQUEST` | "请求参数有误，请刷新后重试" | 刷新页面；如持续出现请联系管理员 |
| 401 | `UNAUTHORIZED` | "登录已过期，请重新登录" | 自动跳转 /login（上游 SSO 登录页）|
| 403 | `FORBIDDEN` | "您没有权限执行此操作" | 提示联系有权限的管理员；审计日志修改时展示"审计日志不可修改" |
| 404 | `NOT_FOUND` | "未找到对应记录，可能已被删除" | 返回上一页；刷新列表 |
| 409 | `CONFLICT` | "该邮箱已绑定其他成员账户，请检查后重试" | inline 展示在邮箱字段下方；不允许进入下一步 |
| 422 | `UNPROCESSABLE_ENTITY` | 使用 `fieldErrors[]` 逐字段展示（如"请输入有效的邮箱地址"）；无 fieldErrors 时展示"操作不符合业务规则，请检查输入" | inline 展示在对应字段；权限冲突时弹 toast 列出冲突对 |
| 429 | `RATE_LIMITED`（推断，契约未显式定义 ErrorCode，见下方 blocker）| "请求过于频繁，请 {retryAfterSeconds} 秒后重试" | 展示倒计时；倒计时结束后自动重试（仅 GET 请求）|
| 500 | `INTERNAL_ERROR` | "服务暂时不可用，请稍后重试" | 自动重试 1 次（间隔 2s）；重试仍失败展示"如持续出现请联系管理员" |
| network-offline | —（前端检测）| "网络连接已断开，请检查网络后重试" | 展示全局离线横幅；恢复网络后自动消失 |

**429 blocker**：`api-contract.yaml` 的 `ProblemDetails.code` 枚举（#L1010-L1018）未包含 `RATE_LIMITED`，但端点可能返回 429。此 ErrorCode 未在契约中定义，前端需要处理 HTTP 429 状态但无法对齐枚举。已记录至 `docs/blockers.md`。

---

### 审计日志写入失败的降级策略

**决策：fail-fast（同事务回滚，非 fail-open）。**

依据：
1. PRD G3 成功指标明确"所有敏感操作 100% 写入审计日志"，fail-open（主操作成功但审计失败）会破坏此指标。
2. `docs/data-model.md §3` 明确"写审计日志必须与上游写在同一事务"（NestJS `@Transactional()` 或 `$transaction`），事务内任一失败整体回滚。
3. 后果对称性：比起"成员被删除但无审计记录"，"成员删除失败但用户得到明确错误提示"的可接受度更高（运营经理可以重试，而审计缺失无法补救）。

用户可见行为：审计写入失败时操作返回 500 + `"服务暂时不可用，请稍后重试"`，不区分是主表写入失败还是审计写入失败（两者在同一事务中，对外表现一致）。

---

## 8. Visual Direction & Design Tokens

### 8.1 Visual Direction（强制单选 1 种风格方向）

> **强观点设计原则**：必须从下面 9 种方向中**单选一种**，不允许混搭。混搭会导致设计无主张，AI 输出退化为"通用 SaaS 模板"。

| 方向 | 适用 | 字体倾向 | 色彩倾向 | 留白 | 动效 |
|------|------|---------|---------|------|------|
| `brutally-minimal` | 工程 / 内部工具 | Geist Mono / IBM Plex | 黑白 + 单一品牌色 | 极宽 | 几乎无 |
| `editorial` | 内容 / 文档 / 博客 | Serif（Source Serif / Iowan） | 米白 + 墨黑 + 极少 accent | 中 | 文字 reveal |
| `industrial` | 数据 / 监控 / 物流 | Mono + Sans 混排 | 深灰 + 高对比 accent | 紧凑 | 状态过渡 |
| `luxury` | 高端 ToC / 品牌 | Serif Display + Sans | 米色 + 暖金 + 深棕 | 宽 | 缓慢 ease |
| `playful` | 教育 / 儿童 / 社区 | Round Sans（Quicksand） | 多彩饱和 | 中 | 弹性 spring |
| `geometric` | 设计 / 创意工具 | Geometric Sans（Inter Tight） | 大色块 + 几何形 | 中 | 形状变换 |
| `retro-futurist` | Web3 / Gaming | Mono + 装饰字 | 霓虹 + 深紫黑 | 紧凑 | glow / scanline |
| `soft-organic` | 健康 / 冥想 / 母婴 | Round Sans / Hand-drawn | 柔粉 + 灰绿 + 米白 | 宽 | flowing |
| `maximalist` | 时尚 / 媒体 / 创意 | 多字体混排 | 撞色 + 大图 | 紧凑 | 多图层 |

**本项目的选择**：

```yaml
visual_direction:
  selected: industrial
  rationale: >
    项目参考标准为"Linear / Stripe Dashboard 的 dense + professional 风格"（project-brief.md §参考资料），
    industrial 方向以紧凑布局、高对比 accent 与状态过渡动效为核心特征，与表格主导的 SaaS 后台后台信息密度需求
    精确匹配；tokens.json 默认使用 Geist Sans（无衬线）+ Geist Mono（等宽）+ GitHub 风格中性色板，
    与 industrial 字体倾向（Mono + Sans 混排）天然一致，保留即可，无需微调字体家族，
    仅建议将 table 行高从默认调低至 36px（spacing[9]=36 插值）以进一步强化信息密度。
    证据 1：PRD 目标用户"运营经理，每周 5–10 次成员变更操作"——高频操作场景要求低留白密集布局。
    证据 2：project-brief.md 明确引用 Linear / Stripe Dashboard（两者均为 industrial 风格的典型代表）。
```

**与 tokens.json 的关系**：保留全部默认值。`color.primary="#1F6FEB"`（GitHub 蓝）、`color.danger="#D73A49"`（GitHub 红）与 industrial 的高对比 accent 一致；`font-sans: Geist Sans` 与 `font-mono: Geist Mono` 直接映射 industrial 的 Mono + Sans 混排字体策略。建议微调：表格行高显式设为 36px（`spacing` 数组插值），以替代 shadcn 默认 40px 行高，进一步强化 dense 感。

**与 anti-patterns 的对照**：`industrial` 选择排除了 anti-pattern #1（无渐变）、#2（无毛玻璃）、#4（无 parallax）、#6（Geist 非"通用 sans"）、#7（品牌色来自 tokens，非随机情感色）。

### 8.2 Design Tokens

> 来自 `.ddt/design/tokens.json`。**审阅时务必打开 `.ddt/design/tokens-preview.html` 查看真实渲染效果**，不要只读 JSON。

```json
{
  "color": {
    "primary": "#1F6FEB",
    "danger":  "#D73A49",
    "warning": "#F59E0B",
    "success": "#0F9D58",
    "neutral-50":  "#F6F8FA",
    "neutral-100": "#EAEEF2",
    "neutral-500": "#6E7781",
    "neutral-900": "#1F2328"
  },
  "spacing": [4, 8, 12, 16, 24, 32, 48, 64],
  "radius": { "sm": "4px", "md": "8px", "lg": "16px" },
  "typography": {
    "font-sans": "Geist Sans, ui-sans-serif",
    "font-mono": "Geist Mono, ui-monospace",
    "scale":     [12, 14, 16, 20, 24, 32, 48]
  }
}
```

> 与 visual_direction=industrial 对齐说明：保留上述默认值；建议在 Tailwind 配置中将 DataTable 行高显式设为 `h-9`（36px），覆盖 shadcn 默认 `h-10`（40px），以实现 dense 信息密度目标。

### 8.3 Anti-Patterns（强制黑名单 · 11 条）

> **每个通道的 prompt 都会逐字注入此清单**，防止 AI 输出退化为"通用 SaaS slop"。

| # | 反模式 | 替代做法 |
|---|--------|---------|
| 1 | 紫蓝默认渐变（`from-purple-500 to-blue-500`） | 实色 + 单一品牌色 accent |
| 2 | 无意义 glass morphism（毛玻璃滥用） | 实色 + 微妙阴影 / 微高斯模糊仅在覆盖层 |
| 3 | 不该圆角的圆角（按钮 / 卡片 / 输入框统一 8px） | 多档圆角（sm 4 / md 8 / lg 16），每类组件独立选 |
| 4 | 滚动过度动画（parallax / scroll-jacking） | 仅在关键节点用 staggered fade-in |
| 5 | 居中 hero on stock gradient | 网格不对称布局 + 真实参考图 |
| 6 | 通用 sans-serif（Inter / Arial / 系统默认） | 按 visual_direction 选具体字体（Geist / IBM Plex / Satoshi 等） |
| 7 | 通用情感色（饱和蓝 / 天蓝） | 品牌色 + 中性色优先；情感色仅作语义（success / warning / error） |
| 8 | "interchangeable SaaS hero"（标题 + 副标 + 双 CTA） | hero 区必须含产品独特视觉锚点（screenshot / 数据 / 真实截图） |
| 9 | "generic card piles"（无层级的卡片堆叠） | 信息分层：summary card / detail card / action card 三类各异 |
| 10 | "random accent without system"（随手用色） | 所有 accent 必须出自 tokens.json，禁止 inline 颜色 |
| 11 | "motion that exists only because animation was easy" | 每个动效必须能回答"它服务于什么 task" |

---

## 9. References

> 用户上传的视觉参考；与 visual_direction 一起决定通道生成风格。

**参考产品**（业界对标）：
- Linear：极简 + 高密度，dense 表格 + 状态标签，深色/浅色模式切换流畅
- Stripe Dashboard：professional + dense，数据表格主导，高对比状态 badge，操作审计入口清晰

**参考截图**（已落到 `.ddt/design/assets/`）：
- （无）— 用户未上传参考截图；visual_direction 决策依据为 project-brief.md 文字说明与 PRD 用户画像

> 注：`web/components/` 目录在 v0.8 骨架阶段未建立（见 `.ddt/design/components-inventory.md`）；web/ 工程将在 /design-execute 后由 AI 设计源生成，届时 components-inventory 将由编译器重新扫描更新。

**风格关键词**：dense / professional / high-contrast-accent / mono-sans-mixed / state-driven

---

## 10. Constraints

- **平台**：Web 应用（桌面端优先）；Next.js 14 App Router + Tailwind + shadcn-ui（SPA 模式，`frontend.type=spa`）。窄屏（< 1280px）展示降级提示"当前界面为桌面端设计，建议在宽度 ≥ 1280px 的设备上使用"，不做移动端功能适配（PRD §3.3 明确非目标）。

- **断点**：以 `xl: 1280px` 为主断点（来自 `.ddt/design/tokens.json breakpoint.xl`）。`sm: 640px` / `md: 768px` / `lg: 1024px` 仅用于组件内部响应（如抽屉宽度），主布局在 xl 以下展示降级提示而非自适应。`2xl: 1536px` 布局宽度上限，内容区 max-width 约束在 `1440px`。

- **可达性（a11y）**：WCAG 2.1 AA 级。具体要求：
  - 所有交互元素键盘可达（Tab / Enter / Space / 方向键）
  - 焦点环（focus-visible）始终可见，不得 `outline: none` 无替代
  - 文字与背景对比度 ≥ 4.5:1（正文），大文字 ≥ 3:1
  - DangerConfirmDialog 弹出时 focus trap 限制在弹窗内，Esc 键关闭
  - 所有状态变更（loading / error / success）通过 `aria-live` 或 `role="alert/status"` 宣告
  - 危险操作（删除成员）在 screen reader 中宣告"此操作不可撤销"

- **性能预算**（来自 PRD AC，非推断）：
  - 审计日志虚拟滚动初始渲染 ≤ 2s（PRD F4 AC，10,000+ 条记录场景）
  - 全文搜索响应 ≤ 500ms（PRD F4 AC，服务端 SLA）
  - FCP / LCP：`<待用户确认>`（PRD 未明示，不擅自填写）

- **浏览器矩阵**（PRD 未明示，以下为合理推断，待用户确认）：Chrome 119+ / Firefox 120+ / Safari 17+。不支持 IE 任何版本。

- **国际化（i18n）**：v0.8 仅中文（zh-CN），多语言不在 v1 范围内；文案字符串不做 i18n key 抽取，直接硬编码中文（v1.0 如需多语言可后续迁移 next-intl）。

- **暗色模式**：tokens.json 已定义 `color-dark` token 集（GitHub 风格），shadcn-ui 支持 class 切换暗色。v0.8 不强制实现暗色模式切换 UI，但组件样式应避免写死 light-only 颜色（使用 CSS 变量而非 hardcode hex），为后续暗色适配保留扩展点。

---

## 11.（可选）参考实现

- 已有内部组件库：无（v0.8 骨架阶段，`web/components/ui/` 未初始化）
- shadcn registry：https://ui.shadcn.com/docs/components/data-table（DataTable 参考范式，project-brief.md §参考资料）
- 已有 Figma 设计稿：无（本次为 claude-design 主通道，Figma 通道为后续复跑验证）

---

## 编译信息（自动生成，请勿手改）

```yaml
generated_at:  2026-05-06T06:47:56.931Z
generator:     ddt-design-brief-compiler v0.8.0
inputs:
  prd:           docs/prd.md@2f1d8ce
  api_contract:  docs/api-contract.yaml@untracked
  tech_stack:    .ddt/tech-stack.json
  user_assets:
    - (无)
    - .ddt/design/tokens.json
derived_packages:
  - .ddt/design/claude-design/upload-package/
  - .ddt/design/figma/upload-package/   (if --channel includes figma)
  - .ddt/design/v0/v0-sources/          (if --channel includes v0)
```

---

## Self-Check

- [x] §1 Problem Alignment 4 字段（用户 / 痛点 / 紧迫性 / 成功指标）齐全
- [x] §3 IA 含完整页面树（5 屏：/members / /members/new / /members/{id} / /audit-logs / /roles）
- [x] §4 Screen Inventory 每屏 4 字段（入口 / 出口 / 数据 / 状态枚举）齐全，共 5 屏
- [x] §5 Component States 8 状态矩阵覆盖所有交互组件（DataTable / MultiStepForm / DangerConfirmDialog / DetailTab / Timeline）
- [x] §7 Validation 系统级错误对应 ErrorCode 枚举（BAD_REQUEST / UNAUTHORIZED / FORBIDDEN / NOT_FOUND / CONFLICT / UNPROCESSABLE_ENTITY / INTERNAL_ERROR）+ 审计日志降级策略（fail-fast）
- [x] §8.1 visual_direction 9 选 1（industrial）+ rationale ≥ 2 句 + 2 条独立证据（PRD 用户画像 + project-brief.md 竞品引用）
- [x] §10 Constraints 含平台 / 断点 / a11y / 性能 4 大类
- [x] §2 User Stories 已从 PRD §4 手动提取 5 条（编译器正则未匹配）；§6 / §11 / 编译信息块保持编译器原样
- [x] 末尾无 `<请填>` / `<待填>` 占位（除显式标记 blocker 的 429 ErrorCode 与 FCP/LCP 性能预算）

**Blockers（已追加到 `docs/blockers.md`）**：
- `[BLOCK-DESIGN-BRIEF-001]`：`api-contract.yaml` `ProblemDetails.code` 枚举未包含 `RATE_LIMITED`，但 429 响应可能发生。建议在 api-contract.yaml 补充此枚举值，或前端以 HTTP 状态码 429 作为 fallback 判断依据。
- `[BLOCK-DESIGN-BRIEF-002]`：PRD 未明示 FCP / LCP 性能预算，§10 已填写"待用户确认"。请用户在 project-brief.md 补充或直接修改 §10。
- `[BLOCK-DESIGN-BRIEF-003]`：浏览器兼容矩阵（Chrome 119+ / Firefox 120+ / Safari 17+）为 design-brief-agent 合理推断，PRD 未明示。请用户确认后移除此 blocker。
