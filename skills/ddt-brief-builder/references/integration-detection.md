# 集成依赖识别信号清单（D25 / v0.9.8）

> ddt-brief-builder 输入类型 J「第三方 API 文档」的识别准则。  
> 主索引：`SKILL.md` §"输入识别"。

## 何时把输入认成"集成依赖"（类型 J）

满足任意一条即可触发 dump-api-docs.mjs：

### 信号 1 — 目录名关键词

目录名（不区分大小写，含中文）含以下关键词之一：

| 关键词 | 例子 |
|---|---|
| `API` / `api` | `项目资料/无人车开放平台API/`、`api-docs/` |
| `开放平台` / `开放接口` | `合作伙伴开放平台/` |
| `SDK` / `sdk` | `iot-sdk-docs/` |
| `OpenAPI` / `openapi` | `openapi-spec/` |
| `Swagger` / `swagger` | `swagger-files/` |
| `集成规约` / `integration` | `integration-spec/`、`payment-integration/` |
| `对接文档` / `对接说明` | `银联对接文档/` |
| `接口规范` / `接口契约` | `三方接口规范/` |

### 信号 2 — 目录内容结构

目录内（递归）满足以下任一组合：

- 含 `README.md` + 至少 2 个 markdown 文件 + 文件名含 `endpoint` / `接口` / `API` / `auth` / `鉴权`
- 含 `*.openapi.yaml` / `*.openapi.yml` / `swagger.json` / `openapi.json`
- 含子目录名 `01-接入流程` / `02-鉴权说明` / `Cloud-API` / `errors` 等结构化命名

### 信号 3 — 单文件契约

单个文件命中以下之一即可作为 §11 来源：

| 文件名 / 后缀 | 处理 |
|---|---|
| `*.openapi.yaml` / `*.openapi.yml` | 零依赖 yaml 解析（抽 paths / info / servers / securitySchemes） |
| `swagger.json` / `openapi.json` | JSON.parse + 同上抽取 |
| `*.md` 含 `## Endpoint` 表格 / `### POST` `### GET` 章节 | Markdown 章节切分 + 标题抽取 |

### 信号 4 — 用户语言

用户对话明确含以下短语之一：

- "对接 X 接口"
- "集成 Y 系统"
- "调用 Z 开放平台"
- "X 的 API 文档" / "X 的 SDK 文档"
- "我已经爬了文档"
- "三方接口已确定"

## 何时**不**触发（避免误识别）

- 目录名含 `docs` / `documentation` 但内容是产品手册（无 endpoint / 鉴权章节） → 走 §10 参考资料
- 单 `.md` 含"接口介绍"但只是文字说明，无 endpoint 表 → 走 §10
- 用户给的是数据库 schema / SQL DDL → 不是集成依赖（属架构层，等 /design 阶段）
- 用户给的是会议纪要（含"对接 X 接口"提及但无文档） → 走类型 H 会议纪要 + 写软 blocker

## 多源混合处理（同一项目多个第三方系统）

§11 用列表：

```markdown
## 集成依赖

### 第三方系统：新石器无人车开放平台
| ... |

### 第三方系统：高德地图 API
| ... |

### 第三方系统：阿里云短信网关
| ... |
```

## 敏感字段处理（强制脱敏）

dump-api-docs 在读取过程中**必须**把以下字段值替换为 `***`，并在 brief §11 标注 "敏感字段已脱敏"：

| 字段 | 模式 | 处理 |
|---|---|---|
| `client_secret` | `client_secret\s*[:=]\s*[^\s]+` | 值 → `***` |
| `appSecret` / `app_secret` | 同上 | 值 → `***` |
| `api_key` / `apiKey` | 同上 | 值 → `***` |
| `secret_key` / `secretKey` | 同上 | 值 → `***` |
| `access_token`（**当作示例值出现时**） | 同上 | 值 → `***` |
| `Authorization: Bearer xxx` | header 值 | xxx → `***` |
| `password` | 同上 | 值 → `***` |
| `13位~16位连续数字`（**当紧邻 client_id 上下文**） | 数字串 | 保留前 4 位 + `****` |

> 注意：`client_id` 通常是公开标识，**不脱敏**（保留方便用户识别项目归属）。仅 `client_secret` 等敏感字段脱敏。
> 用户后续若想看明文，应去契约文档原文件读，不应从 brief 拷。

## 触发后的产出范式（→ brief §11）

参见 `field-rules.md` §11 段。dump-api-docs 输出 markdown 片段，可直接 append 到 brief §11。
