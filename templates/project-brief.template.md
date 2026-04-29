# Project Brief · <项目名称>

> 填写完毕后运行 `/prd` 生成完整 PRD。

## 项目背景

<!-- 1–3 句话：为什么做这个项目，解决什么痛点 -->

## 目标用户

- **主要用户**：<角色描述，e.g. 运营人员、C 端消费者>
- **次要用户**：<角色描述>

## 成功标准

<!-- 项目上线后如何判断成功？至少 1 条可量化指标 -->
- [ ] <指标 1，e.g. 注册转化率 ≥ 30%>
- [ ] <指标 2>

## 核心功能（一句话描述）

1. <功能 1>
2. <功能 2>
3. <功能 3>

## 关键约束

- **截止日期**：<YYYY-MM-DD>
- **预算 / 工期**：<人天或工时>
- **合规 / 安全**：<如有，e.g. 需通过 GDPR 审计>

## 技术栈选型

> 推荐路径（任选其一）：
>   1. 用预设包（**最快**）：仅填 `技术栈预设` 字段，其他留空，DDT 自动展开
>   2. 用 AskUserQuestion 4 步问卷（**推荐**）：把 `技术栈预设` 留空或写 `interactive`，
>      `/kickoff` 时 LLM 会主动问 4 题（语言 / 数据库 / 前端 / UI）
>   3. 完全自定义（**专家**）：填下方所有具体字段
>
> 详细选项树：插件目录 `templates/tech-stack-options.yaml`（Spring Initializr 22 分组等价）

### 快捷预设（路径 1）

- **技术栈预设**：java-modern  <!-- 候选：java-modern | java-traditional | node-modern | go-modern | python-fastapi | custom | interactive -->
- **AI-native UI**：claude-design  <!-- 候选：claude-design | figma | v0 | lovable | none -->

### 后端组件（路径 3，仅在 preset=custom 时需要填）

- **后端语言**：<java | typescript | python | go>
- **后端框架**：<spring-boot-3 | spring-boot-2.7 | nestjs | express | fastify | fastapi | django | flask | gin | fiber | echo>
- **后端构建工具**：<maven | gradle | gradle-kotlin | npm | pnpm | poetry | go-modules>
- **数据库**：<postgres-16 | mysql-8 | mysql-5.7 | sqlite | mongodb | oracle | sqlserver>
- **缓存**：<redis-7 | caffeine | ehcache | none>
- **ORM / 数据访问**：<mybatis-plus | jpa-hibernate | mybatis | prisma | typeorm | sqlalchemy | gorm | sqlc | better-sqlite3 | raw>
- **认证**：<spring-security-oauth2 | passport-jwt | django-auth | none>
- **测试框架**：<junit5+testcontainers | jest+supertest | vitest+supertest | pytest | go-test+testify>

### 前端组件（路径 3）

- **前端框架**：<react | vue-3 | angular-19 | svelte-5 | solid>
- **构建工具**：<vite | nextjs-14-app | nextjs-14-pages | nuxt-3 | sveltekit-2 | solidstart | webpack | turbopack>
- **TypeScript**：<true | false>
- **UI 组件库**：<tailwind+shadcn-ui | antd-5 | mui-5 | chakra-ui-2 | mantine-7 | element-plus | naive-ui | antd-vue | primevue | angular-material | primeng | ng-zorro | none>
- **状态管理**：<zustand | jotai | redux-toolkit | pinia | ngrx | signals | context-only | none>
- **数据获取**：<tanstack-query | swr | server-actions | axios+context | vueuse-fetch | apollo>
- **测试框架**：<vitest+rtl | jest+rtl | vitest+vue-test-utils | karma | playwright>

### 自由说明（路径 3 或细节调整）

- **技术栈细节**：<可选。e.g. "需要 Spring Cloud Gateway + Resilience4j 做服务网关"，"前端必须支持 IE 11" 等>

> 留空字段 = 用 preset / framework 的默认值（参考 tech-stack-options.yaml::defaults）。

## 非目标（已知排除项）

- <排除项 1>
- <排除项 2>

## 参考资料

- <链接或文件路径>
