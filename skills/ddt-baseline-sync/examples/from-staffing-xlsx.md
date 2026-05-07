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
python3 $DDT_PLUGIN_ROOT/skills/ddt-baseline-sync/scripts/parse-staffing.py \
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

## AskUserQuestion 决策

LLM 把 JSON 摘要给用户后，发 1 个 AskUserQuestion 问项目类型 + 1 个问是否追加：

```typescript
{
  question: "本项目类型是？影响 baseline 同类对比与未来估算精度。",
  header: "项目类型",
  options: [
    { label: "B2B-后台 (Recommended)",
      description: "运营 / 客户管理 / 长服役（车队、医院、政府等）",
      preview: "本项目识别信号：物流 / 客户 / 网点 / 多模块——强匹配 B2B-后台" },
    { label: "SaaS", description: "C 端订阅 / 自助注册" },
    { label: "API-only", description: "纯 API / SDK" },
    { label: "Mobile", description: "iOS / Android" },
  ]
}
```

```typescript
{
  question: "识别到人员需求表（5.0 人月 / 7 角色 / 2.5 月窗口 / 总 880h / 复杂度=复杂）。是否追加到 baseline/historical-projects.csv？",
  header: "baseline 增量",
  options: [
    { label: "追加 (Recommended)",
      description: "本次项目作为 HIST-009 写入，让未来 pm-agent /wbs 估算更准",
      preview: "type=B2B-后台 / total=880h / team=7 / 复杂度=复杂" },
    { label: "仅展示不入库", description: "解析后输出表格但不修改 baseline" },
    { label: "完成后再决定", description: "项目跑完真实工时再决定" },
  ]
}
```

## 跑追加（管道方式更丝滑）

```bash
python3 $DDT_PLUGIN_ROOT/skills/ddt-baseline-sync/scripts/parse-staffing.py \
  design/比赛项目/项目人员需求计划表.xlsx \
  | node $DDT_PLUGIN_ROOT/skills/ddt-baseline-sync/scripts/append-historical.mjs \
    --json - --type "B2B-后台"
```

输出：
```
✅ 追加到 baseline/historical-projects.csv:
   HIST-009,无人物流车运营系统,B2B-后台,880,169,70,201,211,141,62,26,0,,,7,5 人月 / 7 角色 / 2026-01-04 ~ 2026-03-15 / 复杂度 复杂

下一步：
  下次 /digital-delivery-team:wbs 时 pm-agent 会读到本行作为同类项目工时基准
  /digital-delivery-team:report 阶段也会用此 baseline 做对比
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
