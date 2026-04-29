# USAGE · digital-delivery-team

场景化使用示例。完整命令参考与安装方式见 [README.md](./README.md)。

---

## 场景一：从零启动新项目（默认 java-modern 栈）

**适用**：全新项目，没有任何文档，从一句需求开始。

```bash
# 1. 进入项目目录（或 mkdir 一个新的）
cd my-new-project/

# 2. 写下一句话需求
echo "用户可以创建任务、分配给团队成员、设置截止日期、用看板视图管理状态" > project-brief.md
```

回到 Claude Code 会话中：

```text
/kickoff                # 默认 java-modern 预设（Spring Boot + React + Tailwind）
/impl                   # 前后端并行实现
/verify                 # 测试 + 评审并行
/ship                   # 文档 + 效率报告 + 打包
```

完成后产出：

```text
docs/prd.md  docs/wbs.md  docs/risks.md
docs/arch.md  docs/api-contract.yaml  docs/data-model.md
web/...   server/...   tests/test-report.md
docs/review-report.md   docs/efficiency-report.md
README.md  docs/deploy.md  docs/demo-script.md
delivery-<project-id>-<timestamp>.tar.gz
```

**典型耗时参考**（基于 8 个历史 java-modern 项目均值）：

| 阶段 | 基线估算 |
|------|---------|
| kickoff（prd + wbs + design） | ~13h |
| impl（frontend + backend） | ~24h |
| verify（test + review） | ~7h |
| ship（package + report） | ~3h |
| **合计** | **~47h** |

---

## 场景二：切换到非默认技术栈

**适用**：项目要求 Node.js / Go / Python 而非 Java；或自定义栈。

### 方案 A：在 brief 里声明（推荐）

```markdown
## 关键约束

- **技术栈预设**: node-modern    <!-- java-modern | node-modern | go-modern | python-fastapi | java-traditional -->
- **AI-native UI**: v0           <!-- claude-design | figma | v0 | lovable -->
```

然后照常 `/kickoff` 即可。

### 方案 B：CLI 参数覆盖

```text
/kickoff --preset go-modern --ai-design figma
```

### 方案 C：自动检测已有 manifest

如果项目根目录已有 `pom.xml` / `package.json` / `go.mod` / `pyproject.toml`，DDT 会自动选择对应预设；可手动用 CLI flag 覆盖。

> 优先级：CLI flag > project-brief 字段 > `.ddt/tech-stack.json` 已有内容 > manifest 自动检测 > 默认 `java-modern`。

---

## 场景三：中途接手已有项目

**适用**：项目已有部分文档或代码，需要接手继续推进。

进入项目目录后**先运行 `/resume`** 看进度：

```text
/resume
```

输出例：

```text
=== DDT Resume ===
项目 ID: proj-...
最后活动: 5 分钟前

阶段进度：
  ✅ prd（2026-04-28T01:00）
  ✅ wbs（2026-04-28T01:30）
  🔄 design（已 12 分钟）
  ⏸ build-web
  ...

=== 下一步建议 ===
🔄 当前在 design 阶段。继续完成（产物：docs/arch.md, docs/api-contract.yaml, docs/data-model.md）
```

按建议继续即可。也可以单独跑某个岗位命令补齐：

```text
/design                 # 单独补架构设计
/build-api              # 只补后端
/verify                 # 只跑测试 + 评审
```

> 子代理会自动读取已有的 `docs/prd.md`、`docs/api-contract.yaml` 作为上下文。文档不全时，agent 会写 `docs/blockers.md` 并停止。
> 强制重新生成用 `--refresh`：`/prd --refresh`、`/design --refresh`。

---

## 场景四：评审 → 修复闭环

**适用**：`/verify` 报出阻塞级评审项，需要快速修复。

```text
/verify                              # 产出 docs/review-report.md
# 假设有 1 条 blocker（B1）+ 3 条 warning（W1/W3/W4）

/fix --severity blocker              # dry-run，先看 patch
# 显示 B1 的 patch diff，等待用户 review

/fix --severity blocker --apply      # 用户批准后正式 apply
# 自动跑回归测试

/fix --severity warning --apply      # 一次性 apply 所有 warning patch

/verify                              # 再跑一次确认通过
/ship                                # 出包
```

**关键原则**：
- 默认 dry-run（仅输出 patch diff）；阻塞级即使 `--apply` 也强制人工 review
- 不修改契约 / 数据模型（属于 architect-agent 职责，写 blockers）
- 可重入：再次跑 `/fix` 时跳过 `status: fixed` 的条目

---

## 场景五：导入外部 AI 设计稿

**适用**：UI 设计已在 figma / v0 / lovable 完成，要落地为 React 代码。

```text
# Figma（要求 figma-mcp-server 已配置）
/import-design --from figma --url https://figma.com/design/abc/MyApp?node-id=12-34

# v0（推荐配 node-modern preset）
/import-design --from v0 --url https://v0.dev/r/xxx

# Lovable（推荐配 python-fastapi preset）
/import-design --from lovable --url https://github.com/user/lovable-export

# Claude artifact 直接生成（默认无依赖）
/import-design --from claude-design
```

输出落入 `web/`，自动通过契约对齐检查（`bin/check-contract-alignment.mjs`）：
- 不引入 lovable supabase mock client
- 字段命名匹配 `docs/api-contract.yaml`
- 路由资源路径匹配契约

详细工作流见 `skills/ai-native-design/SKILL.md`。

---

## 场景六：只跑单个岗位命令

**适用**：只需要特定角色的输出，不走完整流程。

```text
# 只要 PRD
/prd "增加手机号登录功能，支持短信验证码"

# 只要代码评审（与 main 对比）
/review main

# 只要效率报告
/report

# 只要测试（不重新生成测试用例）
/test --regression-only
```

每个岗位命令都是独立可运行的，仅前置依赖产物存在；缺失时命令会用 exit 1 提示。

---

## 场景七：查看实际效率数据

**适用**：项目结束或阶段结束后，分析哪个环节耗时最多。

通常**直接跑 `/report` 即可**——commands 内部已自动调用 aggregate + report：

```text
/report
```

产出 `docs/efficiency-report.md`（含自然语言洞察 + 三问分析 + Top 3 优化建议）。

如果想手动重生成原始数据报告（排错时用）：

```bash
: "${DDT_PLUGIN_ROOT:=$(cat "${HOME}/.claude/delivery-metrics/.ddt-plugin-root" 2>/dev/null)}"
DDT_PROJECT_ID=$(cat .ddt/project-id)

node "$DDT_PLUGIN_ROOT/bin/aggregate.mjs" --project "$DDT_PROJECT_ID"
node "$DDT_PLUGIN_ROOT/bin/report.mjs" --project "$DDT_PROJECT_ID" \
  --baseline baseline/baseline.locked.json \
  --out docs/efficiency-report.raw.md
```

> v0.5.0：质量指标已由 PostToolUse hook 自动捕获，不再需要 `--capture-quality` 参数。
> baseline 在 `/report` 首次运行时自动封盘；不可手动修改（防止后视偏差）。

**报告包含**：
- 阶段级对比表（实际 h vs 基线 h vs Δ%）
- 质量守门表（覆盖率 / 阻塞 / 验收通过率 / 返工次数 / 缺陷密度）
- 三问分析（提效最多 / 劣化阶段 / Top 3 优化建议）

---

## 场景八：跨会话恢复

**适用**：长项目中断后重新打开，或多人协作。

任意时刻：

```text
/resume                              # 看当前进度 + 下一步建议
```

DDT 通过 `.ddt/progress.json` 自动维护状态机，由 hook 全自动驱动：
- **SessionStart**：根据 `docs/*` 文件存在性 infer 状态
- **UserPromptSubmit**：检测到 phase 命令时标 `in_progress`
- **Stop**：每个 turn 结束 infer，artifact 出现则标 `completed`

**冲突保护**（advisory lock）：

DDT 对 6 个 SSoT 文件加 advisory lock：`docs/api-contract.yaml` / `docs/prd.md` / `docs/wbs.md` / `docs/arch.md` / `docs/data-model.md` / `.ddt/tech-stack.json`。两个会话同时改同一个文件时会在 stderr 输出 warn（不阻塞，TTL 30 分钟）。

---

## 常见问题

**Q: 命令执行后没有产物？**
A: 确认 `project-brief.md` 存在并已填写；运行 `/digital-delivery-team:doctor` 自检。

**Q: 度量数据在哪里？**
A: 默认在 `~/.claude/delivery-metrics/`。可通过 `DDT_METRICS_DIR` 环境变量修改。

**Q: 如何临时关闭某个 hook？**
A: 设 `DDT_DISABLED_HOOKS=ddt:pre-tool-use`（CSV 多个）。DDT 用独立命名空间，不读 ECC 变量。

**Q: 可以只用部分命令不用全套吗？**
A: 可以，每个岗位命令都是独立可运行的；编排命令 `/kickoff` `/impl` `/verify` `/ship` 是可选的便利包装。

**Q: Node.js 版本不够怎么办？**
A: 需要 ≥ 22.0.0（使用内置 `node:sqlite`，零 npm 依赖）。运行 `nvm install 22 && nvm use 22` 升级。

**Q: efficiency-report 阶段对比表里某个 stage 的实际工时是 `—`？**
A: 说明该阶段没有捕获到 phase 工时事件。检查 `~/.claude/delivery-metrics/<project-id>/events.jsonl` 是否包含 `phase_start` 事件；若缺失，重启会话让 SessionStart hook 重新推断。`metrics-agent` 在工时缺失时会严格输出"不可证明"，不会用 WBS 预估替代。

**Q: 想换技术栈但已经跑过 /design 怎么办？**
A: `rm .ddt/tech-stack.json` 后重跑 `/design --preset <new-name>`。注意：架构产物会被增量刷新，但既有代码可能与新栈冲突，建议在新分支操作。

---

> v0.5.0 · 完整变更见 [CHANGELOG.md](./CHANGELOG.md)
