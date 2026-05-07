# UI 库场景化推荐（D26 / v0.9.9）

> 选 React 之后**还要选 UI 库**——shadcn-ui 不是万能的。本表按"前端场景密度"决策。  
> 主索引：`SKILL.md` §字段提取（§6 ui_components 子字段）+ `field-rules.md` §6。

## 决策矩阵

| 场景 | 推荐 UI 库 | 理由 | 反推荐 |
|---|---|---|---|
| **B2B 中后台 / 指挥中心 / 运营管理** | **AntD 5** | 高密度数据表格 / 树 / 抽屉 / 级联 / 表单组开箱即用；ConfigProvider 主题映射成熟；中文文档扎实 | shadcn-ui（缺高密度表格）/ MUI（中文不友好） |
| **SaaS C 端 / 产品官网 / 营销页** | **shadcn-ui + Tailwind** | 视觉现代 / 可定制性高 / 设计驱动迭代快 / Vercel 生态 | AntD（视觉偏后台）/ Element Plus（React 不适配） |
| **企业级 SaaS（混合）** | **MUI 5 + Tailwind** 或 shadcn-ui | Material Design 国际化好 / 组件最全 / a11y 完善 | AntD（视觉重） |
| **国内移动 H5** | **TDesign Mobile** / Vant 4 / Antd Mobile | 国内手势规范 / 性能 / 设计风 | shadcn-ui（无 mobile 套件）|
| **数据可视化重型（大屏 / BI）** | AntD 5 + **ECharts 5** + AntV G2 | AntD 表格 + ECharts 图表组合是国内 BI 标配 | 单 AntD（图表能力弱）|
| **3D / 地图重型** | AntD 5 + **MapboxGL / 高德 JSAPI 2.0** + Three.js + react-three-fiber | 同上加 3D 与地图栈 | 不适用 |

## claude-design 通道与 UI 库的关系

`claude-design` 输出的 prototype 是 **HTML + JSX + 纯 CSS variables**（`tokens.css`）。这意味着：

- **token 与 UI 库解耦**：tokens.css 是 W3C Design Tokens 风格，可以映射到任何 UI 库的主题系统。AntD ConfigProvider / shadcn-ui CSS variables / MUI ThemeProvider 都能 honor。
- **UI 库选择按场景，不按通道**：claude-design 不强制 shadcn-ui。AI 在对话中常根据场景密度建议 AntD 5（B2B 场景）。
- **chat transcript 是关键决策来源**：dump-design-handoff.mjs 会把 chat 里 AI 提及的技术栈抽到 brief §11 `aiTechRecommendations` —— LLM 写 brief §6 时**必须读这个字段**，按 chat 决策填 `ui_components`，不能凭训练偏置自由发挥。

## 与 brief §6 ui_components 子字段的对齐契约

`brief §6` 的 `ui_components` 子字段必须是以下值之一（或用户在自然语言里显式说的其它值）：

| 值 | 说明 |
|---|---|
| `tailwind+shadcn-ui` | shadcn-ui + Tailwind（preset java-modern / node-modern / go-modern / python-fastapi default） |
| `antd-5` | AntD 5（B2B 中后台 + 高密度数据 + 中文产品默认） |
| `mui-5` | Material UI 5 |
| `chakra-ui-2` | Chakra UI 2 |
| `mantine-7` | Mantine 7 |
| `naive-ui` | Naive UI（Vue 生态，仅 frontend.framework=vue 时） |
| `element-plus` | Element Plus（同上） |
| `none` | 自定义组件 / 重型设计驱动 / 仅用 tokens |

## D5 决策门（v0.9.9 新增，可选）

仅在以下条件**全部满足**时触发 D5 询问：

1. `frontend.type=spa`
2. `frontend.framework=react`
3. 输入信号无明确 UI 库提示
4. 项目类型有歧义（B2B 中后台 vs SaaS）

```typescript
{
  question: "选择 UI 组件库？影响下游开发的组件密度与中后台体验。",
  header: "UI 库",
  multiSelect: false,
  options: [
    { label: "antd-5 (B2B 中后台 Recommended)",
      description: "高密度表格/树/抽屉开箱即用",
      preview: "适合：物流 / 工厂 / 政府 / 客户管理类后台" },
    { label: "tailwind+shadcn-ui (SaaS Recommended)",
      description: "视觉现代 / 可定制性高",
      preview: "适合：C 端 SaaS / 营销页 / Vercel 生态" },
    { label: "mui-5",
      description: "Material Design 国际化好",
      preview: "适合：企业级国际化 / a11y 严格" },
  ]
}
```

> 多数 B2B 实战项目应跳过 D5，直接根据 dump-design-handoff 的 chat 抽取或场景识别填默认。D5 仅在歧义时启用，避免决策疲劳。

## 反模式

- ❌ **java-modern + Vue + Element Plus**：preset default 是 React，dump-design-handoff 也输出 .jsx，应整体走 React + AntD 5
- ❌ **claude-design + shadcn-ui + B2B 中后台高密度数据**：shadcn-ui 在数据表格 / 树 / 级联场景需要大量二次开发，导致工期翻倍
- ❌ **brief §6 留空 ui_components**：让 LLM 自由发挥 → 训练偏置（国内 Java + Vue + Element Plus）会污染产出，违反 SSoT
