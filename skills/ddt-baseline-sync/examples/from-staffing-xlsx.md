# 示例：人员需求表 → baseline CSV 行（实战）

## 用户输入

```
请把 design/比赛项目/项目人员需求计划表.xlsx 加到 baseline，作未来 /wbs 估算参考
```

## 触发识别

- 信号：文件名含"人员需求" + 用户说"加到 baseline"
- 模式：独立调用（非 ddt-brief-builder 协同）

LLM 开场说："识别到人员需求表，将解析后追加 baseline。先 dump 看内容。"

## 跑脚本（端到端 pipeline）

```bash
PR="${DDT_PLUGIN_ROOT:-$(cat "${HOME}/.claude/delivery-metrics/.ddt-plugin-root" 2>/dev/null)}"
PR="${PR:-${HOME}/.claude/plugins/marketplaces/digital-delivery-team}"

python3 "$PR/skills/ddt-baseline-sync/scripts/parse-staffing.py" \
  design/比赛项目/项目人员需求计划表.xlsx
```

输出 JSON：
```json
{
  "project_name": "无人物流车运营系统",
  "team_size": 7,
  "total_person_months": 5.0,
  "total_hours": 880,
  "complexity": "复杂",
  "time_window": "2026-01-04 ~ 2026-03-15",
  "roles": [...],
  "phase_hours": {
    "prd_hours": 169, "wbs_hours": 70, "design_hours": 201,
    "frontend_hours": 211, "backend_hours": 141,
    "test_hours": 62, "review_hours": 26, "docs_hours": 0
  }
}
```

## AskUserQuestion 决策（项目类型 + 是否追加）

> ⚠️ Claude Code 的 AskUserQuestion options 上限 4 项；"其他"由工具自动提供 Other 输入框，不要手写第 5 项。

```typescript
{
  question: "本项目类型是？影响 baseline 同类对比与未来估算精度。",
  header: "项目类型",
  options: [
    { label: "B2B-后台 (Recommended)",
      description: "运营 / 客户管理 / 长服役（车队、医院、政府等）",
      preview: "本项目识别信号：物流 / 客户 / 网点 / 多模块——强匹配 B2B-后台" },
    { label: "SaaS / C 端", description: "C 端订阅 / 自助注册 / 公开产品" },
    { label: "API / Mobile", description: "纯 API / SDK / iOS / Android 原生" },
    { label: "其他（自定义）", description: "在 Other 输入自定义类型" },
  ]
}
```

```typescript
{
  question: "识别到人员需求表（5.0 人月 / 7 角色 / 2.5 月窗口 / 总 880h / 复杂度=复杂）。是否追加到 baseline/historical-projects.csv？",
  header: "baseline 增量",
  options: [
    { label: "追加 (Recommended)",
      description: "本次项目作为 HIST-NNN 写入，让未来 pm-agent /wbs 估算更准",
      preview: "type=B2B-后台 / total=880h / team=7 / 复杂度=复杂" },
    { label: "仅展示不入库", description: "解析后输出表格但不修改 baseline" },
    { label: "完成后再决定", description: "项目跑完真实工时再决定" },
  ]
}
```

## 跑追加（管道方式更丝滑）

```bash
python3 "$PR/skills/ddt-baseline-sync/scripts/parse-staffing.py" \
  design/比赛项目/项目人员需求计划表.xlsx \
  | node "$PR/skills/ddt-baseline-sync/scripts/append-historical.mjs" \
    --json - --type "B2B-后台"
```

输出（首次跑，从 skill assets 模板初始化）：
```
ℹ️  从 skill assets 模板初始化 baseline（仅表头，干净起点）→ /path/baseline/historical-projects.csv

--- RESULT ---
{
  "status": "appended",
  "target": "/path/baseline/historical-projects.csv",
  "project_id": "HIST-001",
  "new_row": "HIST-001,无人物流车运营系统,B2B-后台,880,...",
  "initialized": true,
  "duplicate_of": null
}

✅ 追加 HIST-001: HIST-001,无人物流车运营系统,B2B-后台,880,169,70,201,211,141,62,26,0,,,7,5 人月 / 7 角色 / 2026-01-04 ~ 2026-03-15 / 复杂度 复杂
```

## 重入场景（同名项目第二次跑，默认 skip）

```bash
node "$PR/skills/ddt-baseline-sync/scripts/append-historical.mjs" \
  --json - --type "B2B-后台"     # 同样的 staffing JSON，第二次跑
```

输出：
```
--- RESULT ---
{
  "status": "skipped_duplicate",
  "target": "/path/baseline/historical-projects.csv",
  "existing_project_id": "HIST-001",
  "existing_project_name": "无人物流车运营系统",
  "message": "同名项目已存在，本次跳过（幂等保护）。如需覆盖，重跑加 --on-duplicate overwrite；如需作两期独立项目，加 --on-duplicate append",
  "initialized": false
}

ℹ️  跳过：baseline 已含 HIST-001 "无人物流车运营系统"
```

## 角色 → phase 映射效果（本案例）

| 角色 | 人月 | 工时（人月×176） | 映射到 phase | 计算 |
|---|---|---|---|---|
| 韩金群 项目经理/架构 | 1.4 | 246 | architecture 60% / requirements 40% | architecture +148, requirements +98 |
| 王紫旋 产品经理 | 0.8 | 141 | requirements 50% / wbs 50% | requirements +70, wbs +70 |
| 王鹭檬 UI 设计 | 0.3 | 53 | ui_design | design +53 |
| 李侠 前端 | 0.6 | 106 | frontend | frontend +106 |
| 王天奕 前端 | 0.6 | 106 | frontend | frontend +105 |
| 于依尘 后端 | 0.8 | 141 | backend | backend +141 |
| 王福蓉 测试 | 0.5 | 88 | test 70% / review 30% | test +62, review +26 |

最终：
- prd_hours = 168（98 + 70）
- wbs_hours = 70
- design_hours = 201（148 architecture + 53 ui_design）
- frontend_hours = 211（106+105）
- backend_hours = 141
- test_hours = 62
- review_hours = 26
- 总：879 ≈ 880（取整误差）

## 同 ddt-brief-builder 的协同

如用户先跑了 ddt-brief-builder，后跑本 skill，brief 已写明团队规模（§5），本 skill 仅追加 CSV，不重复写 brief。

如用户直接跑本 skill 没有 brief，可建议 "如需配 brief，请触发 ddt-brief-builder"。
