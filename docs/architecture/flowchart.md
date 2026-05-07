# DDT 命令依赖图

> v0.9 A1：从 `commands/*.md` 自动派生（frontmatter description + 建议下一步段落）。
> 重新生成：`node bin/render-flowchart.mjs --output <path>`

```mermaid
flowchart LR
  %% 节点定义
  build-api["/build-api<br/>后端实现 · main thread + 6-phase（E"]
  build-web["/build-web<br/>前端实现 · main thread + 6-phase（E"]
  design-brief["/design-brief<br/>设计 Brief 编译器 · 把 PRD + OpenAPI"]
  design-execute["/design-execute<br/>通道执行器 · 派生 3 通道（claude-design "]
  design["/design<br/>架构师命令 · 生成架构草案 + OpenAPI 契约 + "]
  fix["/fix<br/>修复命令 · 按 review-report 条目逐项打补丁"]
  impl(["/impl<br/>串行实现 · 串行调用 /build-api → 决策门 →"])
  integrate["/integrate<br/>集成验证 · 起 db/redis + db migrate"]
  kickoff(["/kickoff<br/>新项目起手 · 串行跑 /prd → /wbs → /des"])
  package["/package<br/>交付命令 · 生成 README + 部署指南 + 演示脚本"]
  prd["/prd<br/>产品经理命令 · 生成或刷新 PRD（含用户故事与 Give"]
  report["/report<br/>度量命令 · 生成效率报告（含洞察、瓶颈分析、优化建议）。"]
  review["/review<br/>代码评审命令 · 对当前 branch 的 diff 产出三"]
  ship(["/ship<br/>交付出包 · 串行跑 /package → /report，"])
  test["/test<br/>测试命令 · 从验收标准生成测试并跑回归，输出覆盖率报告。"]
  verify(["/verify<br/>并行验证 · 同一轮对话同时派发 test-agent 与 "])
  wbs["/wbs<br/>项目经理命令 · 从 PRD 拆出 WBS + 依赖图 + "]

  %% 依赖边（从命令尾部"建议下一步"抽取）
  build-api --> verify
  build-web --> verify
  design-brief --> design-execute
  design-execute --> build-web
  design-execute --> design-execute
  design --> design-brief
  design --> impl
  design -- spa --> design-brief
  design -- none --> impl
  fix --> verify
  impl --> integrate
  impl --> verify
  integrate --> verify
  kickoff --> impl
  package --> report
  prd --> wbs
  report --> ship
  review --> fix
  review --> verify
  test --> review
  verify --> ship
  wbs --> design

  %% 节点类型样式
  classDef phase fill:#e1f5fe,stroke:#0277bd,stroke-width:2px
  classDef orch fill:#fff3e0,stroke:#ef6c00,stroke-width:2px,stroke-dasharray:5
  class build-api,build-web,design-brief,design-execute,design,fix,integrate,package,prd,report,review,test,wbs phase
  class impl,kickoff,ship,verify orch
```

## 节点形状说明

- `phase` 类（蓝色矩形）：单一职责的开发阶段命令
- `orch` 类（橙色虚线圆角）：编排命令，串/并行调下游 phase 命令
- `utility` 类（doctor / preview / relay / resume）不在本图（无 phase 关系）
