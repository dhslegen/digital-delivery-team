# DDT 契约完整性规则

> 适用 agent：architect-agent、frontend-agent、backend-agent、test-agent
> 本文件约束 OpenAPI 契约的变更权限与一致性要求。

---

## 规则

### C-1 · 契约变更权限

OpenAPI 契约（`docs/api-contract.yaml`）的任何变更**只能**在 `/design` 命令（由 architect-agent 执行）内发生。

- frontend-agent、backend-agent、test-agent 只读契约，不得修改
- 若发现契约与实现不一致，写 blocker 并停止，不得擅自修改契约

### C-2 · 变更必须有 ADR

所有契约变更必须在 `docs/arch.md` 的 ADR 段落追加条目，格式：

```markdown
### ADR-YYYYMMDD-NN · <变更标题>

- **决策**：<具体变更内容>
- **理由**：<为什么做此变更>
- **影响**：<对 frontend/backend/test 的影响>
- **日期**：YYYY-MM-DD
```

无 ADR 的契约变更视为无效变更。

### C-3 · 契约 lint 失败必须退出

`/design`、`/build-web`、`/build-api`、`/test` 命令在前置阶段校验契约时，若 lint 检查失败（如字段类型不匹配、必填字段缺失、引用路径无效），必须：

```bash
echo "❌ OpenAPI 契约 lint 失败，请先运行 /design 修正契约。"
exit 4
```

若 lint 工具缺失，必须退出 5，不得降级为警告后继续执行。

不得继续执行后续阶段。

### C-4 · 禁止二次编造契约内容

契约定义的字段（名称、类型、枚举值、校验规则）不得被以下内容覆盖或替换：

- UI 文案（如把 `error_code` 改为 `errorMsg`）
- 默认值的隐式假设
- 错误提示的自创格式

实现必须与契约严格对齐。若契约定义不足，写 blocker，不得在实现层面自行补充。
