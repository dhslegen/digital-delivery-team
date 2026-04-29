# USAGE · digital-delivery-team

场景化使用示例。完整命令参考与安装方式见 [README.md](./README.md)。

---

## 场景一：从零启动新项目（默认 java-modern + 决策门）

**适用**：全新项目，从一句需求开始。

```bash
cd my-new-project/

echo "用户可以创建任务、分配给团队成员、设置截止日期、用看板视图管理状态" > project-brief.md
```

回到 Claude Code 会话中：

```text
/kickoff                # 默认 interactive：每个 phase 落盘后暂停决策门
                        # → /prd → 决策门 → /wbs → 决策门 → /design → 决策门
/impl                   # 串行 /build-api → 决策门 → /build-web → 决策门
                        # 每文件 validation-loop + 每 step checkpoint commit
/verify                 # 测试 + 评审并行
/ship                   # 文档 + 效率报告 + 打包
```

**v0.7.0 行为变化**：每个 phase 落盘后会用 `AskUserQuestion` 4 选项问你：
- 接受并继续（推荐）
- 修改某条具体内容
- 新增内容
- 重新生成（带说明）

如果想要 v0.6.x 的"一键自动"体验：

```text
/kickoff --auto         # 跳过所有决策门
/impl --auto
```

完成后产出：

```text
docs/prd.md  docs/wbs.md  docs/risks.md
docs/arch.md  docs/api-contract.yaml  docs/data-model.md
docs/build-api-exploration.md  build-api-plan.md  build-api-summary.md
docs/build-web-exploration.md  build-web-plan.md  build-web-summary.md
web/...   server/...   tests/test-report.md
docs/review-report.md   docs/efficiency-report.md
README.md  docs/deploy.md  docs/demo-script.md
.ddt/progress.json  tech-stack.json  decisions.jsonl  checkpoints.log
delivery-<project-id>-<timestamp>.tar.gz
```

**典型耗时参考**（基于 8 个历史 java-modern 项目均值）：

| 阶段 | 基线估算 |
|------|---------|
| kickoff（prd + wbs + design） | ~13h |
| impl（build-api + build-web） | ~24h |
| verify（test + review） | ~7h |
| ship（package + report） | ~3h |
| **合计** | **~47h** |

---

## 场景二：技术栈交互式选型（v0.6.1+，推荐路径）

**适用**：项目要求灵活技术栈；想从 Spring Initializr 等价问卷中选；想要 v0/figma/lovable 设计源接入。

### 方案 A：brief 写 interactive（推荐）

```markdown
## 技术栈选型

### 快捷预设（路径 1）
- **技术栈预设**: interactive    <!-- 改这里 -->
- **AI-native UI**: claude-design
```

跑 `/kickoff` 时 LLM 主动调用 `AskUserQuestion` 4 步问卷：

```
Q1 主语言栈:    Java SpringBoot 3 / Node TS / Python FastAPI / Go Gin
Q2 数据库+缓存: PostgreSQL+Redis / MySQL+Redis / SQLite / MongoDB
Q3 前端框架:    React+Vite / Next.js 14 / Vue 3 / Angular 19
Q4 UI 库:       根据 Q3 动态：tailwind+shadcn / antd / element-plus / ...
```

每个选项含 `preview` 字段展示完整 stack 摘要。

### 方案 B：CLI 参数覆盖

```text
/kickoff --preset go-modern --ai-design figma
```

### 方案 C：完全自定义（专家）

brief 中填详细字段：

```markdown
### 后端组件（路径 3）
- **后端语言**: java
- **后端框架**: spring-boot-3
- **数据库**: postgres-16
- **缓存**: redis-7
- **ORM / 数据访问**: jpa-hibernate
- **认证**: spring-security-oauth2

### 前端组件（路径 3）
- **前端框架**: react
- **构建工具**: vite
- **UI 组件库**: antd-5
- **状态管理**: redux-toolkit
- **数据获取**: rtk-query
```

完整选项树见插件 `templates/tech-stack-options.yaml`（Spring Initializr 22 分组等价）。

> 优先级：CLI flag > brief 字段 > `.ddt/tech-stack.json` > manifest 自动检测 > 默认 `java-modern`。
> `.ddt/tech-stack.json` 是 SSoT，agent 不能直接编辑（PreToolUse hook 硬拦截）。

---

## 场景三：中途接手已有项目

**适用**：项目已有部分文档或代码，需要接手继续推进。

```text
/resume                 # 看当前进度
```

输出例：

```text
=== DDT Resume ===
项目 ID: proj-...
最后活动: 5 分钟前

阶段进度：
  ✅ prd（2026-04-29T01:00）
  ✅ wbs（2026-04-29T01:30）
  🔄 design（已 12 分钟）
  ⏸ build-web
  ⏸ build-api
  ...

=== 下一步建议 ===
🔄 当前在 design 阶段，最近 12 分钟内有活动。继续完成（产物：docs/arch.md, ...）
```

按建议继续。也可单独跑某个岗位命令补齐：

```text
/design                 # 单独补架构设计
/build-api --module auth   # 只补认证模块（v0.7.0 --module 分块）
/verify                 # 只跑测试 + 评审
```

> 强制重新生成用 `--refresh`：`/prd --refresh "新需求..."` / `/design --refresh`。
> v0.7.0 起 main thread 实现 `/build-api` `/build-web`，无 subagent 黑盒；EXPLORE 阶段会先扫现状，避免重写已有代码。

---

## 场景四：评审 → 修复闭环

```text
/verify                              # 产出 docs/review-report.md
# 假设有 1 条 blocker（B1）+ 3 条 warning（W1/W3/W4）

/fix --severity blocker              # dry-run，先看 patch
# 显示 B1 的 patch diff，等待 user review

/fix --severity blocker --apply      # 用户批准后正式 apply
# 自动跑回归测试

/fix --severity warning --apply      # 一次性 apply 所有 warning patch

/verify                              # 再跑一次确认通过
/ship                                # 出包
```

**关键原则**：
- 默认 dry-run；阻塞级即使 `--apply` 也强制人工 review
- 不修改契约 / 数据模型（属于 architect-agent 职责）
- 可重入：再次跑 `/fix` 跳过 `status: fixed` 的条目

---

## 场景五：导入外部 AI 设计稿

**适用**：UI 设计在 figma / v0 / lovable 完成，要落地为 React 代码。

```text
# Figma（要求 figma-mcp-server 已配置）
/import-design --from figma --url https://figma.com/design/abc/MyApp?node-id=12-34

# v0（推荐配 node-modern preset）
/import-design --from v0 --url https://v0.dev/r/xxx

# Lovable（推荐配 python-fastapi preset）
/import-design --from lovable --url https://github.com/user/lovable-export

# Claude artifact 直接生成（默认）
/import-design --from claude-design
```

输出落入 `web/`，自动通过契约对齐检查（`bin/check-contract-alignment.mjs`）。

详细工作流见 `skills/ai-native-design/SKILL.md`。

---

## 场景六：复杂需求分块实现（v0.7.0 新）

**适用**：需求 endpoint ≥ 10 个，一次写不完丢上下文。

```text
# 后端按模块多轮跑
/build-api --module auth        # 第一轮：认证模块（独立 6-phase）
                                # EXPLORE → PLAN → APPROVE → IMPLEMENT → VERIFY → SUMMARY
/build-api --module tasks       # 第二轮：任务模块
/build-api --module stats       # 第三轮：统计模块

# 前端类似
/build-web --module auth-pages  # 登录注册页
/build-web --module task-board  # 看板主页
/build-web --module settings    # 设置页
```

每轮独立 6-phase，独立 plan + approve + checkpoint commits。多轮拼成完整前后端。

模块名来自 `docs/wbs.md` 中的任务分组。

---

## 场景七：跨会话接力（v0.6.0 新）

**适用**：

- token 接近上限，需要切到新会话
- 把项目交给同事 / 自己换设备
- 切换 AI 模型（Claude → GPT → Gemini）
- 长项目阶段性归档备份

```text
/relay                   # 屏幕显示完整 13 段式接力 prompt
                         # 文件存档：.ddt/relay-<YYYYMMDD-HHMMSS>.md
```

**自动注入**：项目 ID / 当前 phase / 已完成 phase / 技术栈摘要 / 关键产物路径 / git log / 未提交改动。

**AI 补充 9 段**（What WORKED / What Did NOT Work / What Has NOT Been Tried Yet / Current State of Files / Decisions Made / Blockers / Exact Next Step / Environment & Setup Notes）。

跨会话续作：

```text
# 旧会话
/relay                   # 复制屏幕输出

# 新会话（同设备 / 不同设备 / 不同 AI 都可）
[粘贴 prompt 到第一句对话]
# AI 立即知道：项目在哪、做到哪步、下一步做什么、什么不要重试
```

切换 AI 模型场景：

```text
/relay --quiet --out /tmp/relay.md
cat /tmp/relay.md | pbcopy        # macOS 复制到剪贴板
# 在 ChatGPT / Gemini 里粘贴 → AI 接手
```

---

## 场景八：决策门交互（v0.6.2 新）

**适用**：用户希望每个 phase 落盘后参与决策。

默认行为（**v0.7.0 起所有 phase 都启用决策门**）：

```text
# 跑完 /prd 后
✅ 已生成 docs/prd.md（5 个用户故事 / 26 条 AC / P0=3 P1=2）

[AskUserQuestion 弹出]
PRD review:
  ⚪ 接受并继续 (Recommended)            → 进入 /wbs
  ⚪ 修改某条具体内容                     → AI 问"哪条 + 怎么改"
  ⚪ 新增内容                            → AI 问"补充什么"
  ⚪ 重新生成（带说明）                   → AI 问"原因 + 要保留什么"
  ⚪ Other（自定义文本）                  → AI 解析意图
```

`/preview <phase>` 在决策门弹出后辅助查看摘要：

```text
/preview prd           → 用户故事数 / AC 数 / 优先级 / vs HEAD diff
/preview design        → ADR 数 / endpoint 数 / 数据模型实体
/preview impl          → 后端文件 / 前端组件 / 测试数
/preview all           → 全部 9 个 phase 一次输出
```

---

## 场景九：查看实际效率数据

**适用**：项目结束或阶段结束后，分析哪个环节耗时最多。

通常**直接跑 `/report` 即可**：

```text
/report
```

产出 `docs/efficiency-report.md`（含自然语言洞察 + 三问分析 + Top 3 优化建议）。

如果 v0.5.x 时代留下的 metrics.db 数据膨胀，先重建：

```bash
node "$DDT_PLUGIN_ROOT/bin/aggregate.mjs" --project "$DDT_PROJECT_ID" --rebuild
```

> v0.6.0+ 起 `aggregate.mjs` 用 watermark 增量 ingest，phase_runs 不再 4× 膨胀；
> v0.6.2+ 起 `metrics-agent` 严格判定"工时不可证明"，禁止用 WBS 预估替代实际工时。

**报告包含**：
- 阶段级对比表（实际 h vs 基线 h vs Δ%）
- 质量守门表（覆盖率 / 阻塞 / 验收通过率 / 返工次数 / 缺陷密度）
- 三问分析（提效最多 / 劣化阶段 / Top 3 优化建议）

---

## 场景十：只跑单个岗位命令

```text
# 只要 PRD
/prd "增加手机号登录功能，支持短信验证码"

# 只要代码评审（与 main 对比）
/review main

# 只要效率报告
/report

# 只要测试（不重新生成测试用例）
/test --regression-only

# 单独实现某个模块
/build-api --module auth
```

每个岗位命令都是独立可运行的；缺失前置产物时会用 exit 1 提示。

---

## 常见问题

**Q: v0.7.0 的 /impl 为什么变慢了？**
A: 改成串行 + 决策门后用户参与了关键节点；不再"agent 黑盒一气呵成"。如果想要旧体验：`/impl --auto` 跳过决策门。但工时数据更精确（lookback join 并发错配从根上消失）。

**Q: --module 怎么知道有哪些模块？**
A: 模块名来自 `docs/wbs.md` 中的任务分组。如 wbs.md 含 "## 模块: auth"、"## 模块: tasks"，就用 `--module auth` `--module tasks`。

**Q: `/build-api` 为什么不再用 backend-agent？**
A: v0.7.0 改 main thread 模式：每写一个文件你都能看到 + 每文件立即 validation + 每 step git commit。subagent 黑盒导致的"工时不可证明 + 用户失语"两大问题从根上消失。`backend-agent.md` 的知识全部迁到 `skills/backend-development/SKILL.md`，由 main thread auto-load。

**Q: 决策门弹出时，preview 字段没看到关键信息怎么办？**
A: 选 "Other"（自定义文本），输入"我想看 X 详情"——LLM 会再展示。或者跑 `/preview <phase>` 查更详细摘要。

**Q: 度量数据在哪里？**
A: 默认在 `~/.claude/delivery-metrics/`。可通过 `DDT_METRICS_DIR` 环境变量修改。项目本地数据在 `.ddt/`（progress / tech-stack / decisions / checkpoints / locks / relay）。

**Q: 如何临时关闭某个 hook？**
A: 设 `DDT_DISABLED_HOOKS=ddt:pre-tool-use`（CSV 多个）。DDT 用独立命名空间，不读取其他插件命名空间的环境变量。

**Q: Node.js 版本不够怎么办？**
A: 需要 ≥ 22.0.0（使用内置 `node:sqlite`，零 npm 依赖）。运行 `nvm install 22 && nvm use 22` 升级。

**Q: efficiency-report 阶段对比表里某个 stage 的实际工时是 `—`？**
A: 说明该阶段没有捕获到 phase 工时事件。先确认插件 ≥ v0.6.0；老项目跑一次 `aggregate.mjs --rebuild` 重新 ingest；新项目重启会话让 SessionStart hook 重新推断。`metrics-agent` 在工时缺失时严格输出"不可证明"，不会用 WBS 预估替代。

**Q: 想换技术栈但已经跑过 /design 怎么办？**
A: `rm .ddt/tech-stack.json` 后重跑 `/design --preset <new>` 或 `/design --refresh`。注意：架构产物会被增量刷新，但既有代码可能与新栈冲突，建议在新分支操作。

**Q: 跨会话怎么不失忆？**
A: `/relay` 输出 13 段式 prompt 复制到下一会话；自动注入 progress / tech-stack / 关键产物路径 / git log。同设备/跨设备/跨 AI 都能用。

---

> v0.7.0 · M6 路线图收官 · 完整变更见 [CHANGELOG.md](./CHANGELOG.md)
