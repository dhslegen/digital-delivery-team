# USAGE · digital-delivery-team

场景化使用示例。完整命令参考见 [README.md](./README.md)。

---

## 场景一：从零启动新项目

**适用**：全新项目，没有任何文档，从一句需求开始。

```bash
# 1. 进入项目目录
cd my-new-project/

# 2. 写下一句话需求
echo "用户可以创建任务、分配给团队成员、设置截止日期、用看板视图管理状态" > project-brief.md

# 3. 一键起手：自动产出 PRD + WBS + 架构契约
/kickoff
# 产物：docs/prd.md、docs/wbs.md、docs/arch.md、docs/api-contract.yaml、docs/data-model.md

# 4. 并行实现前后端
/impl
# 产物：web/（前端）、server/（后端，含集成测试）

# 5. 并行测试 + 评审
/verify
# 产物：tests/test-report.md、docs/review-report.md

# 6. 打包 + 效率报告
/ship
# 产物：README.md、docs/deploy.md、docs/demo-script.md、docs/efficiency-report.raw.md
```

**完整耗时参考**（基于 8 个历史项目均值）：

| 阶段 | 基线估算 |
|------|---------|
| kickoff（prd + wbs + design）| ~13h |
| impl（frontend + backend）| ~24h |
| verify（test + review）| ~7h |
| ship（docs + report）| ~3h |
| **合计** | **~47h** |

---

## 场景二：中途加入已有项目

**适用**：项目已有部分文档或代码，需要接手继续推进。

```bash
# 假设项目已有 prd.md 和 wbs.md，缺少架构设计

# 单独补充架构设计
/design
# 产物：docs/arch.md、docs/api-contract.yaml、docs/data-model.md

# 前后端已有代码，只需跑测试 + 评审
/verify
# 产物：tests/test-report.md、docs/review-report.md

# 或者只补充后端（前端已完成）
/build-api
# 产物：server/（含集成测试）
```

**关键提示**：
- 子代理会自动读取已有的 `docs/prd.md`、`docs/api-contract.yaml` 作为上下文
- 如果文档不完整，agent 会在对话中提示缺失的信息
- 可用 `--refresh` 参数让 agent 重新生成：`/prd --refresh`

---

## 场景三：只跑单个岗位命令

**适用**：只需要特定角色的输出，不走完整流程。

### 只要 PRD

```bash
/prd "增加手机号登录功能，支持短信验证码"
# 产物：docs/prd.md（含用户故事 + Given/When/Then 验收标准）
```

### 只要代码评审

```bash
/review main
# 与 main 分支对比，产出三级评审报告
# 产物：docs/review-report.md
```

### 只要效率报告

```bash
/report
# 读取本地 metrics.db，产出阶段对比表 + 质量守门
# 产物：docs/efficiency-report.raw.md
```

### 只要测试

```bash
/test --regression-only
# 只跑回归测试，不新生成测试用例
```

---

## 场景四：查看实际效率数据

**适用**：项目结束或阶段结束后，分析哪个环节耗时最多。

```bash
export DDT_PLUGIN_ROOT="${DDT_PLUGIN_ROOT:-$CLAUDE_PLUGIN_ROOT}"
test -n "$DDT_PLUGIN_ROOT" || { echo "Set DDT_PLUGIN_ROOT to the installed plugin path"; exit 1; }

# 手动触发聚合（通常由 hook 自动完成）
node "$DDT_PLUGIN_ROOT/bin/aggregate.mjs" --project "$DDT_PROJECT_ID"

# 从 tests/test-report.md + docs/review-report.md 捕获质量指标
node "$DDT_PLUGIN_ROOT/bin/aggregate.mjs" --project "$DDT_PROJECT_ID" --capture-quality

# 在项目根目录封盘 baseline
if [ ! -f baseline/baseline.locked.json ]; then
  node "$DDT_PLUGIN_ROOT/bin/baseline.mjs" --lock \
    --hist baseline/historical-projects.csv \
    --expert baseline/estimation-rules.md \
    --out baseline/baseline.locked.json
fi

# 产出报告（指定项目 ID）
node "$DDT_PLUGIN_ROOT/bin/report.mjs" \
  --project proj-your-id \
  --baseline baseline/baseline.locked.json \
  --out docs/my-report.md

# 查看 project-id（在项目目录下）
cat .delivery/project-id
```

**报告包含**：
- 各阶段实际工时 vs 基线对比（Δ%）
- 质量守门状态（缺陷数、覆盖率）
- 原始数据路径（可二次分析）

`baseline/baseline.locked.json` 必须位于被交付项目目录；缺失时 `/report` 会失败，防止生成不可证明的提效结论。OpenAPI lint 失败会阻断 `/design`、`/build-web`、`/build-api` 与 `/kickoff`。

---

## 常见问题

**Q: 命令执行后没有产物？**  
A: 确认 `project-brief.md` 存在，或运行 `/kickoff` 前先创建该文件。

**Q: 度量数据在哪里？**  
A: 默认在 `~/.claude/delivery-metrics/`。可通过 `DDT_METRICS_DIR` 环境变量修改路径。

**Q: 如何临时关闭某个 DDT hook？**
A: 使用 `DDT_DISABLED_HOOKS`，例如 `DDT_DISABLED_HOOKS=ddt:pre-tool-use`。DDT 不读取 ECC 的 hook 开关。

**Q: 可以只用部分命令不用全套吗？**  
A: 完全可以，每个岗位命令都是独立可运行的，无强制依赖顺序。

**Q: Node.js 版本不够怎么办？**  
A: 需要 ≥ 22.0.0。DDT 使用 Node 内置 `node:sqlite`，不安装 npm SQLite 依赖。

---

_USAGE.md 由 T-P02 生成 · v0.3.0_
