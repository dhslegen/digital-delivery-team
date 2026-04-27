---
description: 新项目起手 · 串行跑 /prd → /wbs → /design，完成后可进入 /impl。
argument-hint: "[补充需求描述]"
---

# /kickoff

**输入**：$ARGUMENTS（补充需求描述，透传给 `/prd`）

---

## 执行步骤

1. 跑 `/prd $ARGUMENTS`
   - 若 `project-brief.md` 缺失 → 停止，提示用户填写
   - 若存在阻塞项（`docs/blockers.md` 非空）→ 停止，提示处理阻塞

2. 跑 `/wbs`
   - 若失败 → 停止

3. 跑 `/design`
   - 若契约 lint 未通过 → 停止，返回退出码 4
   - 若 OpenAPI lint 工具缺失 → 停止，返回退出码 5
   - 若产出文件缺失 → 停止

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
