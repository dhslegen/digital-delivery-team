# Blockers

> 记录 agent 在执行过程中遇到的、阻塞后续推进的信息缺失 / 外部依赖 / 决策歧义。
> 每个条目一个二级标题，未解决的 `resolved_at` 保持 `null`。

## <blocker-id>

- **id**: BL-YYYYMMDD-NN
- **raised_by**: <agent-name>
- **stage**: prd | wbs | design | impl | verify | ship
- **issue**: 一句话描述阻塞点
- **details**: 多行补充，列出缺失的具体信息 / 可选方案 / 影响范围
- **suggested_action**: 具体到"请人类补充哪份文件的哪个字段" / "请拉 XX 确认 YY 决策"
- **created_at**: ISO-8601 时间戳
- **resolved_at**: null
- **resolved_by**: null
- **resolution_note**: null
