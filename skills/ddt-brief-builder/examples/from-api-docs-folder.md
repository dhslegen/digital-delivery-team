# 示例：第三方 API 文档 → brief §11 集成依赖

> 输入类型 J（v0.9.8 D25）实战。覆盖两种形态：
> - **A. Markdown 目录树**（爬下来的 SDK 文档 / 开放平台离线副本）
> - **B. OpenAPI YAML 单文件**（标准 OpenAPI 3.x 规范）

## 何时识别为类型 J

详细信号见 `references/integration-detection.md`。speed cheat：

| 强信号 | 例子 |
|---|---|
| 目录名含 `API` / `开放平台` / `SDK` / `OpenAPI` / `swagger` / `集成规约` / `对接文档` | `项目资料/无人车开放平台API/` |
| 单文件 `*.openapi.yaml` / `*.openapi.yml` / `swagger.json` / `openapi.json` | `api-spec/petstore.openapi.yaml` |
| 单 markdown 含 `## GET /xxx` / `## POST /xxx` 章节 | `api-docs/orders.md` |
| 用户对话："对接 X 平台" / "调用 Y 开放平台" + 给文档路径 | "请把 项目资料/无人车开放平台API/ 加到 brief" |

---

## 示例 A：Markdown 目录树（alv-ops 实战）

### 用户输入

```
项目资料/无人车开放平台API/ 是新石器无人车的 API 文档，请加到 brief 让 product-agent
在 /prd 阶段不再产生"接口未确认"的 BLK
```

### LLM 第一步：识别 + 告知用户

```
识别到第三方 API 文档目录（输入类型 J）。将跑 dump-api-docs.mjs 解析后注入 brief §11。
```

### 跑脚本

```bash
PR="${DDT_PLUGIN_ROOT:-$(cat "${HOME}/.claude/delivery-metrics/.ddt-plugin-root" 2>/dev/null)}"
PR="${PR:-${HOME}/.claude/plugins/marketplaces/digital-delivery-team}"

node "$PR/skills/ddt-brief-builder/scripts/dump-api-docs.mjs" \
  "项目资料/无人车开放平台API"
```

### 输出（markdown 片段，可直接 append 到 brief §11）

```markdown
### 第三方系统：新石器无人车开放平台 API 文档（离线版）

| 项目 | 值 |
|---|---|
| 契约文档 | `项目资料/无人车开放平台API` |
| 基础 URL | https://scapi.neolix.net/openapi-platform/api |
| 鉴权方式 | OAuth2 client_credentials, 凭据见个人中心-应用管理 |
| Endpoint 数 | 19 个（3 组（如 Cloud + Video）） |
| 关键能力 | 获取访问凭证 / 获取车辆列表 / 获取车辆站点信息 / 获取车辆已规划路线列表 / 批量获取车辆实时信息 |
| 错误码 | 见 `05-错误码.md` |
| 接入流程 | 见 `01-接入流程/01-开发者认证流程.md` |

**Endpoint 样本**（前 5 个）：
- `DOC 02-鉴权说明/01-获取访问凭证.md`
- `DOC 03-Cloud-API/01-获取车辆列表.md`
- `DOC 03-Cloud-API/02-获取车辆站点信息.md`
- `DOC 03-Cloud-API/03-获取车辆已规划路线列表.md`
- `DOC 03-Cloud-API/04-批量获取车辆实时信息.md`
```

### 注入 brief §11 后的下游效果

`/prd` 阶段 product-agent 读到 §11 后：
- 用户故事 US-BIM-03（车辆管理）直接引用 `GET /vehicleList`（具体路径来自 `03-Cloud-API/01-获取车辆列表.md`）
- 用户故事 US-BIM-04（路线管理）引用 `GET /vehiclePlannedRoute`（来自 `03-Cloud-API/03-获取车辆已规划路线列表.md`）
- **不再产生 BLK-001（接口协议未确认）**

---

## 示例 B：OpenAPI YAML 单文件

### 用户输入

```
api-spec/petstore.openapi.yaml 是 petstore 标准 OpenAPI 文件，请加到 brief
```

### 输入文件（节选）

```yaml
openapi: 3.0.3
info:
  title: Pet Store API
  version: 1.0.0
servers:
  - url: https://petstore.example.com/v1
paths:
  /pets:
    get:
      summary: List pets
    post:
      summary: Create pet
  /pets/{id}:
    get:
      summary: Get pet by ID
    delete:
      summary: Delete pet
components:
  securitySchemes:
    apiKey:
      type: apiKey
      in: header
      name: X-API-Key
```

### 输出

```markdown
### 第三方系统：Pet Store API

| 项目 | 值 |
|---|---|
| 契约文档 | `api-spec/petstore.openapi.yaml` |
| 基础 URL | https://petstore.example.com/v1 |
| 鉴权方式 | apiKey (apiKey) |
| Endpoint 数 | 4 个 |
| 关键能力 | pets / {id} |
| 安全 | **敏感字段已脱敏**（client_secret/api_key 等） |

**Endpoint 样本**（前 5 个）：
- `GET /pets`
- `POST /pets`
- `GET /pets/{id}`
- `DELETE /pets/{id}`
```

---

## 敏感字段脱敏（强制）

dump-api-docs 在读取过程中**必须**把以下字段值替换为 `***`：

| 输入文件含 | 脱敏后 |
|---|---|
| `client_secret: f6082eb7-1873-4af3-...` | `client_secret: ***` |
| `apiKey: AKIAIOSFODNN7EXAMPLE` | `apiKey: ***` |
| `Authorization: Bearer eyJhbGc...` | `Authorization: Bearer ***` |

`client_id` 不脱敏（公开标识，方便用户识别项目归属）。

> 用户后续要看明文，应去契约文档原文件读，不应从 brief 拷。

---

## 多系统并存（同一项目对接多个第三方）

§11 列表化：

```markdown
## 集成依赖

### 第三方系统：新石器无人车开放平台
| ... |（dump-api-docs 输出 1）

### 第三方系统：高德地图 API
| ... |（dump-api-docs 输出 2）

### 第三方系统：阿里云短信网关
| ... |（dump-api-docs 输出 3）
```

操作方式：对每个系统独立跑 dump-api-docs.mjs，把输出依次 append 到 brief §11。

---

## 与 §10 参考资料的区别（重要）

| 维度 | §10 参考资料 | §11 集成依赖 |
|---|---|---|
| **形态** | URL / 文件路径 / 竞品名称 | endpoint 摘要 + 鉴权 + 错误码契约 |
| **下游消费** | product-agent **被动**浏览（不一定读） | product-agent **主动**消费（用户故事引用 endpoint） |
| **示例** | "竞品参考：阿里物流 https://..."  | "对接新石器：14 endpoint + OAuth2 + ..." |
| **何时填** | 用户给链接 / 设计灵感来源 | 用户给真正要对接的第三方 API 文档 |

> 把"对接的 API"放 §10 是错误用法 → product-agent 看不见 → 又会出 BLK。  
> 把"竞品参考链接"放 §11 是错误用法 → product-agent 误以为要消费契约。
