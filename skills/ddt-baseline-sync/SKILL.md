---
name: ddt-baseline-sync
description: 把项目人员需求计划表 / 工时表 / 进度表（xlsx / csv）解析为 DDT baseline 历史项目数据，追加到 baseline/historical-projects.csv 让 pm-agent /wbs 阶段的工时估算更准。当用户说"导入工时数据"、"录入人员表"、"baseline 校准"、"historical-projects 增量"、"项目人员表"、"工时表入库"，或粘贴 xlsx 路径含"人员需求"/"工时"/"项目计划"/"resource-plan" 等关键词时，立即触发本 skill。姊妹 skill：ddt-brief-builder（写 brief 时识别到 baseline 信息源会协同触发本 skill）。
origin: DDT
---

# DDT Baseline Sync · 人员表 → 历史项目工时基线

> **使命**：把"已知项目的真实工时数据"沉淀到 DDT baseline，让 pm-agent 在 /wbs 阶段从"凭模板"升级到"按真实历史校准"。
> **范围**：仅做 baseline CSV 增量。不写 brief、不出 PRD、不动其他产物。
> **触发模式**：独立调用 / 被 ddt-brief-builder 协同调用（识别到 baseline 信息源时）。

## 何时触发

| 信号 | 处理 |
|---|---|
| 用户显式说"导入工时" / "录入人员表" / "baseline 校准" / "historical-projects 增量" | 主流程 |
| 用户给 xlsx 路径，文件名含"人员需求" / "工时" / "项目计划" / "resource-plan" | 主流程 |
| ddt-brief-builder 识别到 baseline 信息源，AskUserQuestion 确认后转触发本 skill | 协同模式 |

**不触发**：
- 用户给的是功能清单 xlsx → 触发 ddt-brief-builder（不是 baseline）
- 用户给的是事件流 events.jsonl → 那是 metrics-agent 范围
- 用户问"baseline 怎么用" → 直接回答，不必跑 skill

## 核心原则（v0.9.7 标准化）

1. **模板 vs 数据分离**：插件分发的 `examples/` 是教学示例，**绝不**当用户初始数据；用户项目的 baseline 从 `assets/historical-projects.template.csv`（**仅表头**）开始累积。
2. **可重入幂等**：按 `project_name` 查重；同名项目再次导入时进入决策门（skip / overwrite / append-as-new）。
3. **项目级优先**：baseline 写入用户项目根 `<cwd>/baseline/historical-projects.csv`；插件根 baseline 仅作 plugin-default schema 兜底，本 skill 不写。
4. **工具约束遵守**：AskUserQuestion options ≤ 4 项（Claude Code 工具硬约束）。

## 核心流程

```
用户给人员表 path
    ↓
1. dump xlsx（用 ddt-brief-builder 同款 dump-xlsx.py）
    ↓
2. parse-staffing.py 解析角色 × 人月 × 时间窗
    ↓
3. AskUserQuestion 让用户确认 / 调整：
   - 项目类型（B2B-后台 / SaaS / API-Mobile / 其他）
   - 是否追加（追加 / 仅展示 / 完成后再决定）
    ↓
4. 同名查重：
   - 不存在 → 直接 append（HIST-NNN 自增）
   - 存在 → 决策门（skip / overwrite / append-as-new）
    ↓
5. append-historical.mjs 写一行（项目根优先；不存在则用 assets 模板初始化）
    ↓
6. 输出"baseline 已校准"+ 下一步（跑 pm-agent 时估算更准）
```

## 如何调用本 skill 的 scripts/

LLM 跑 Bash 时 cwd 是用户项目根，必须用绝对路径调本 skill 脚本：

```bash
# 解析 plugin root（marker 文件 fallback chain）
PR="${DDT_PLUGIN_ROOT:-$(cat "${HOME}/.claude/delivery-metrics/.ddt-plugin-root" 2>/dev/null)}"
PR="${PR:-${HOME}/.claude/plugins/marketplaces/digital-delivery-team}"

# 端到端管道（推荐）
python3 "$PR/skills/ddt-baseline-sync/scripts/parse-staffing.py" <xlsx-path> \
  | node "$PR/skills/ddt-baseline-sync/scripts/append-historical.mjs" \
    --json - --type "<项目类型>"
```

**禁止** `python3 scripts/parse-staffing.py ...`（cwd 是项目根，找不到）。

## 角色 → phase 映射规则

`baseline/historical-projects.csv` schema 的 phase 列定义如下，本 skill 按表映射：

| 人员表角色 | 映射 phase 列 | 备注 |
|---|---|---|
| 项目经理 / 架构 | `architecture` | 含 design 阶段；如同时担任 PM，建议 60% architecture / 40% requirements |
| 产品经理 | `requirements` | prd + wbs 合计 |
| UI 设计 | `design` | UI 部分（与架构 design 列区分；不冲突，二者都进 design 累加） |
| 前端 | `frontend` | 多人累加 |
| 后端 | `backend` | 多人累加 |
| 测试 | `test` + `review` | 默认 7:3 拆分（test_hours = 0.7×人月×176h, review_hours = 0.3×人月×176h） |
| 运维 / DevOps | `docs` | 暂无独立列，挂 docs |

**计算公式**：
- 工时 = 人月 × 22 工作日 × 8 小时 = **人月 × 176**
- 总工时 = 各 phase 累加
- 复杂度 = 总工时档位（≤60 简单 / 60-200 中等 / >200 复杂）

详见 `examples/historical-projects.example.md` 的 schema 字段速查与映射效果。

## CSV 行 schema（baseline/historical-projects.csv）

```csv
project_id,name,type,total_hours,prd_hours,wbs_hours,design_hours,frontend_hours,backend_hours,test_hours,review_hours,docs_hours,defect_count,coverage_pct,team_size,notes
```

字段填法见 `examples/historical-projects.example.md`。要点：
- `project_id`：自动生成 `HIST-<NNN>`（扫描已有最大编号 +1）
- `type`：来自 AskUserQuestion 用户选（B2B-后台 / SaaS / API-Mobile / 其他）
- `defect_count` / `coverage_pct`：留空（项目还没跑完）
- `notes`：人月明细 + 时间窗 + 来源 xlsx 路径

## 关键决策门

### Step A — 项目类型（在追加前问）

```typescript
{
  question: "本项目类型是？影响 baseline 同类对比与未来 pm-agent 估算精度。",
  header: "项目类型",
  options: [
    { label: "B2B-后台 (Recommended)",
      description: "运营 / 客户管理 / 长服役（车队、医院、政府、ERP 等）" },
    { label: "SaaS / C 端",
      description: "C 端订阅 / 自助注册 / 公开产品" },
    { label: "API / Mobile",
      description: "纯 API / SDK 库 / iOS / Android 原生 App" },
    { label: "其他（自定义）",
      description: "在 Other 输入自定义类型，如 IoT / Embedded / Desktop" },
  ]
}
```

> ⚠️ **工具约束**：Claude Code 的 AskUserQuestion 单题 options 上限 4 项。"其他"选项**不要**手写，工具会自动提供 Other 输入框。本 skill 把 4 个语义合并为 4 类。

### Step B — 是否追加

```typescript
{
  question: "识别到人员需求表（<总人月> 人月 / <角色数> 角色 / <时间窗>）。是否追加到 baseline/historical-projects.csv？",
  header: "baseline 增量",
  options: [
    { label: "追加 (Recommended)",
      description: "本次项目作为 HIST-NNN 写入，让未来 pm-agent /wbs 估算更准",
      preview: "type=<推断> / total_hours=<计算> / team_size=<人数> / 复杂度=<档位>" },
    { label: "仅展示不入库",
      description: "解析后输出表格但不修改 baseline，让用户校对" },
    { label: "完成后再决定",
      description: "项目跑完真实工时与计划工时对比后再决定是否入 baseline" },
  ]
}
```

### Step C — 同名查重（仅在已存在时触发）

```typescript
{
  question: "baseline 中已存在同名项目 \"<name>\"（旧记录 <HIST-NNN> / <旧工时> h）。如何处理？",
  header: "重复项目",
  options: [
    { label: "跳过 (Recommended)",
      description: "不动旧记录，本次解析仅展示，避免误改已封盘数据" },
    { label: "覆盖原行",
      description: "用本次解析结果替换旧 <HIST-NNN>，project_id 不变" },
    { label: "作新行追加",
      description: "保留旧行，本次作为新 HIST-NNN（如同名项目跑了两期需独立计入）" },
  ]
}
```

## 落盘位置 & 初始化

**写入目标**：`<cwd>/baseline/historical-projects.csv`（项目根，**永远不写**插件根）

**首次初始化**：
- 项目根无 CSV → 从 `$DDT_PLUGIN_ROOT/skills/ddt-baseline-sync/assets/historical-projects.template.csv`（**仅表头**）复制建立
- **不**复制 `examples/historical-projects.example.csv`（那是 8 行教学示例，不是用户数据）
- 用户若想看示例做学习/对比，显式跑 `--with-examples`

**协同 brief**：本 skill 完成后告知 ddt-brief-builder 已写入；brief §5 可加"团队规模 N 人月 / 时间窗 X / 总工时 H 小时"（如未写）

## 边界

✅ **做**：
- 人员表完整解析（含日期 / 人月 / 角色 / 工作内容）
- AskUserQuestion 让用户确认项目类型 + 是否追加
- 项目根 baseline 优先；从 skill assets 模板初始化（仅表头）
- 同名查重 + 重入决策门
- 复杂度按工时档位自动判定

❌ **不做**：
- 替用户决定项目类型（必须 AskUserQuestion）
- 写 brief / 出 PRD / 改 progress.json（越界）
- 静默追加（必须用户确认）
- 修改插件根 baseline（用户共享数据，谨慎）
- 把 `examples/` 当用户初始数据复制（污染源）

## 资源索引

```
ddt-baseline-sync/
├── SKILL.md                                    ← 本文件
├── scripts/
│   ├── parse-staffing.py                       ← xlsx → JSON 结构化
│   └── append-historical.mjs                   ← JSON → CSV 一行（含初始化 + 查重 + 重入）
├── assets/
│   └── historical-projects.template.csv        ← 仅表头，初始化用
└── examples/
    ├── from-staffing-xlsx.md                   ← 完整实战：人员表 → CSV 行
    ├── historical-projects.example.csv         ← 8 行教学示例（HIST-001~HIST-008）
    └── historical-projects.example.md          ← schema 字段速查与映射效果
```

**姊妹 skill**：
- `skills/ddt-brief-builder/`：把任意输入转 project-brief.md（识别到 baseline 信息源会协同触发本 skill）
