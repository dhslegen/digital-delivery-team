---
name: acceptance-criteria
description: Knowledge pack for writing Given/When/Then acceptance criteria that are unambiguous and automatable. Auto-loaded by product-agent (writing) and test-agent (consuming).
origin: DDT
---

# Acceptance Criteria

## Triggers
- product-agent 启动 / /prd 命令
- test-agent 启动 / /test 命令

## Core Principles
1. **每个用户故事至少 1 条 happy-path + 1 条 edge-case**
2. **可自动化测试** 是硬约束——如果测试工程师无法在不问产品的情况下把它变成代码，它就不合格
3. **Non-Goals 和验收标准等重要**——明确边界防止实现漂移

## Format

```
Given <前置状态 / 上下文>
When  <用户动作 或 系统事件>
Then  <可观测结果，含可量化断言>
```

### 示例（登录场景）

```
# Happy-path
Given 用户已注册（email: alice@example.com，password: 已设置）
When  用户提交正确的 email + password
Then  HTTP 200，body.token 存在（JWT 格式），有效期 1 小时

# Edge-case：密码错误
Given 用户已注册
When  用户提交正确 email + 错误 password，连续 5 次
Then  第 5 次返回 HTTP 429，body.error.code = "too_many_attempts"，锁定 15 分钟

# Edge-case：账号不存在
Given 系统中无此 email 的用户
When  用户提交该 email
Then  HTTP 404，body.error.code = "user_not_found"
```

## Do
- 使用**可观测**的结果（HTTP 状态码 + 响应字段断言、页面上出现的精确文本）
- 数值要具体（响应时间 < 500ms，而不是"响应快"）
- 错误路径要给出确切错误码或错误文案（而不是"报错"）
- 边界值全覆盖：0 / 1 / 最大值 / 负数 / 空字符串 / null / 超长输入

## Don't
- 写"系统应该正确处理 X"（"正确"无客观判定）
- 写"用户体验要好"（不可测）
- 写"根据需要返回相关数据"（糊弄词，定义不清）
- 写"性能要足够快"（没有数值的性能要求无效）

## 可测试性判定表

| 验收标准特征 | 可测 | 不可测 → 怎么修 |
|---|:---:|---|
| 含具体 HTTP 状态码 | ✅ | 补充状态码 |
| 含 body 字段断言 | ✅ | 指定 `body.field == "value"` |
| 含时间数值（< Xms） | ✅ | 写出具体毫秒数 |
| "成功" / "失败" | ❌ | 改为 HTTP 2xx / 4xx + body |
| "响应快" / "体验好" | ❌ | 改为 p95 < 500ms |
| "根据需要" | ❌ | 明确条件与结果 |

## Self-Test（交给 test-agent 前自问）
- [ ] 我能只看这条验收标准写出 test 代码吗？
- [ ] "通过 / 不通过" 的判定是客观的吗？
- [ ] 边界值（0 / 1 / 最大值 / 负数 / 空 / null）都覆盖了吗？
- [ ] 每个用户故事至少有 1 条 happy-path + 1 条 edge-case 吗？
- [ ] 非目标（Non-Goals）≥ 3 条吗？

## Templates & References
- `templates/prd.template.md`（内含验收标准填写示例）
- `skills/api-contract-first/SKILL.md`（错误码与验收标准对应关系）
