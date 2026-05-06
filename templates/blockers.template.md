# Blockers

> v0.9 D18：blocker 分两类，agent 写 / 工具检查时务必区分。

## 两类 blocker

| 类型 | 格式 | 是否阻塞下游 | 用途 | check-blockers.sh 检测 |
|---|---|---|---|---|
| **硬 blocker** | `## <id>` 二级标题 + `resolved_at: null` 完整 frontmatter | ✅ 阻塞 | 信息缺失 / 外部依赖 / 决策歧义，没解决就不能继续 | 默认模式 |
| **软 blocker** | `- [BLOCK-XXX-NNN] <一句描述>` 列表条目 | ❌ 不阻塞 | 业务严谨性提醒（如 PRD 未明示某字段，agent 做了合理推断） | `--soft` 模式报告，`--strict` 模式阻塞 |

## 硬 blocker 模板

每个一个二级标题，未解决的 `resolved_at` 保持 `null`。

```markdown
## BL-20260506-01

- **id**: BL-20260506-01
- **raised_by**: <agent-name>
- **stage**: prd | wbs | design | impl | verify | ship
- **issue**: 一句话描述阻塞点
- **details**: 多行补充，列出缺失的具体信息 / 可选方案 / 影响范围
- **suggested_action**: 具体到"请人类补充哪份文件的哪个字段" / "请拉 XX 确认 YY 决策"
- **created_at**: ISO-8601 时间戳
- **resolved_at**: null
- **resolved_by**: null
- **resolution_note**: null
```

解决后：把 `resolved_at` / `resolved_by` / `resolution_note` 三个字段填上，下次跑 check-blockers.sh 就放行。

## 软 blocker 模板

行首 `- [BLOCK-XXX-NNN]`，全部一行内描述清楚（含可选解决路径）。

```markdown
## design-brief-agent

- [BLOCK-DESIGN-BRIEF-001] api-contract.yaml 的 ProblemDetails.code 枚举未含 RATE_LIMITED，但 §7 中 429 状态需对齐。建议补充 enum 或文档明确 429 不带 ProblemDetails。解决后跑 `/design-brief --refresh`。
- [BLOCK-DESIGN-BRIEF-002] PRD §10 性能预算未明示 FCP/LCP 数字，agent 填写 `<待用户确认>`。请补充实际预算（参考 Web Vitals: FCP < 1.8s / LCP < 2.5s）。
```

软 blocker 不进 `## <id>` 二级标题，直接挂在产生它的 agent 名下作为列表项。

## 何时用哪种

| 场景 | 用什么 |
|---|---|
| PRD 缺少必填字段（如成功指标），agent 无法继续 | 硬 blocker |
| 外部接口契约不明，需要拉对方确认 | 硬 blocker |
| 多个合理选项需要 PM/Tech Lead 二选一 | 硬 blocker |
| PRD 未明示但 agent 做了合理推断（如浏览器矩阵） | 软 blocker |
| 上游产物有小瑕疵但下游能继续（如 enum 漏了一项） | 软 blocker |
| 业务严谨性提醒 / "这个值最好让用户确认下" | 软 blocker |

**判断准则**：如果不解决会让下游 agent 无法做正确决策 → 硬 blocker；如果是"可以继续，但你最好回头看下" → 软 blocker。
