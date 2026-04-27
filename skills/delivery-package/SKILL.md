---
name: delivery-package
description: Knowledge pack for assembling production-grade delivery packages (README / deploy guide / demo script). Auto-loaded by docs-agent.
origin: DDT
---

# Delivery Package

## Triggers
- docs-agent 启动 / /package 命令

## Package Must Contain
1. `README.md`（5 分钟上手）
2. `docs/deploy.md`（幂等部署）
3. `docs/demo-script.md`（3–5 分钟演示）
4. 质量守门产物（`tests/test-report.md` + `docs/review-report.md`）

## README 8 要素（缺一不可）
1. **一句话定位（What）**：让读者 5 秒内判断是否值得继续读
2. **受众与场景（Who / When）**：明确谁在什么场景下使用
3. **5 分钟上手（copy-paste 命令序列）**：必须实际可跑通，含 `make bootstrap` 或等价一键命令
4. **目录结构导览**：列出关键目录及其用途
5. **常见问题（Top 5 FAQ）**：覆盖最高频的上手障碍
6. **相关文档索引**：链接到 arch.md / api-contract.yaml / deploy.md
7. **维护者与反馈渠道**：姓名 + 联系方式（用 `<YOUR_EMAIL>` 占位）
8. **许可证**：明确声明

## Deploy 原则
- **幂等**：重复跑 5 次，结果与第 1 次完全一致
- **环境变量注入**：不硬编码任何密钥、内网地址、账号信息（一律 `<YOUR_XXX>`）
- **回滚脚本**：必须有对应的 rollback 命令或说明
- **环境校验**：跑前自检（Node 版本、必要工具、磁盘空间）
- **脚本头部**：`set -euo pipefail`

## Demo Script 原则
- 时间轴精确到 10 秒（示例：`00:00–00:30 展示登录流程`）
- 每步标注三项：**动作** / **期望屏幕状态** / **口播稿**
- 总时长 3–5 分钟，聚焦 1–2 个核心特性，不要塞进 10 个特性
- 有**意外演示备选分支**（网络挂了 / 接口超时时的应对预案）

## Do
- 用 `<YOUR_XXX>` 占位所有真实密钥、邮件、内网地址
- 部署脚本加 `set -euo pipefail`
- README 第一段必须让人知道"值不值得继续读"
- 所有示例命令在 clean 环境下实际验证可跑通

## Don't
- README 不是 changelog，不要罗列每次更新历史
- 部署不要依赖"先手工改一下 XXX 再运行"
- Demo 不要总时长超过 5 分钟或覆盖超过 3 个特性
- 不在 README 里放真实用户数据或截图中含敏感信息

## Quality Gate（出包前必须通过）
- [ ] `tests/test-report.md` 存在且覆盖率 ≥ 70%
- [ ] `docs/review-report.md` 存在且阻塞级问题 = 0
- [ ] README 从零 clone 后可完整运行
- [ ] deploy.md 幂等验证通过（至少空跑一次）
- [ ] demo-script.md 时长在 3–5 分钟内

## Templates & References
- `templates/deploy.template.md`
- `templates/demo-script.template.md`
- `templates/prd.template.md`（参考"受众"章节写法）
