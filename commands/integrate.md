---
description: 集成验证 · 起 db/redis + db migrate + 启前后端 + smoke 测试。/impl 与 /verify 之间的"栈跑起来"环节（v0.9.11 D28；v0.9.12 D29 实战调优）。
argument-hint: "[--dry-run] [--tear-down] [--reuse-stack] [--skip-smoke] [--skip-server] [--skip-web]"
---

# /integrate

**为什么有这个命令**：v0.9.11 之前 /impl → /verify 直接跑 unit 测试 + 代码评审，但**前后端从未真正联调过**——数据库没起、Redis 没起、server 进程没启动、API 路径前后端是否对齐未知。`/integrate` 填补这一环。

**输入**：$ARGUMENTS

---

## Phase 1 — 前置校验

```bash
test -f docs/api-contract.yaml || { echo "❌ 请先运行 /design"; exit 1; }
test -f .ddt/tech-stack.json || { echo "❌ 缺 .ddt/tech-stack.json，先 /design"; exit 1; }

[ -f "$DDT_PLUGIN_ROOT/bin/aggregate.mjs" ] || DDT_PLUGIN_ROOT=$(cat "${HOME}/.claude/delivery-metrics/.ddt-plugin-root" 2>/dev/null)
[ -f "$DDT_PLUGIN_ROOT/bin/aggregate.mjs" ] || DDT_PLUGIN_ROOT="${HOME}/.claude/plugins/marketplaces/digital-delivery-team"
[ -f "$DDT_PLUGIN_ROOT/bin/aggregate.mjs" ] || { echo "❌ DDT plugin root 未解析"; exit 1; }
export DDT_PLUGIN_ROOT

if printf '%s' "$ARGUMENTS" | grep -q -- '--dry-run'; then
  node "$DDT_PLUGIN_ROOT/bin/integrate-up.mjs" --dry-run
  exit 0
fi
node "$DDT_PLUGIN_ROOT/bin/emit-phase.mjs" --phase integrate --action start
```

## Phase 2 — 派发 integrate-up

跑核心起栈脚本：

```bash
node "$DDT_PLUGIN_ROOT/bin/integrate-up.mjs" $ARGUMENTS
INTEGRATE_EXIT=$?
```

`bin/integrate-up.mjs` 执行 8 个阶段（每步 emit 子状态到 stdout）：

| Phase | 动作 | 失败退出码 |
|---|---|---|
| 1 | 环境侦测：docker / docker-compose / 端口占用 / tech-stack | 2 |
| 2 | docker-compose 准备：用户配置 OR plugin 模板复制（按 preset） | — |
| 3 | docker compose up -d --wait（mysql/postgres + redis + healthcheck） | 3 |
| 4 | db migration（按 preset：mvn flyway / npx prisma migrate / alembic upgrade） | 4 |
| 5 | 启 server 后台（mvn spring-boot:run / npm run start:dev），等 health 60s | 5 |
| 6 | 启 web 后台（npm run dev），等端口 :5173 30s | 6 |
| 7 | smoke：GET health + OpenAPI 第一个 GET endpoint + web 端口监听 | 7 |
| 8 | 报告 → `docs/integrate-report.md`；可选 --tear-down 拆环境 | — |

## Phase 3 — 失败处理

```bash
if [ "$INTEGRATE_EXIT" -ne 0 ]; then
  echo "❌ /integrate 失败（exit $INTEGRATE_EXIT）；详见 docs/integrate-report.md"
  echo ""
  echo "常见原因 + 自助："
  echo "  exit 2: docker / docker-compose 不可用 → 装 Docker Desktop"
  echo "  exit 3: docker compose up 失败 → docker compose -f docker-compose.yml logs"
  echo "  exit 4: db migration 失败 → 检查 server/{db,prisma,alembic} 配置"
  echo "  exit 5: server 未就绪 → cat .ddt/integrate/server.log"
  echo "  exit 6: web 未就绪 → cat .ddt/integrate/web.log"
  echo "  exit 7: smoke 失败 → curl 验证 endpoint；检查 api-contract.yaml 路径"
  echo ""
  echo "修好后重跑 /integrate；保留 stack 时手动 docker compose down 清理"
  exit "$INTEGRATE_EXIT"
fi
```

## Phase 4 — 汇总输出

```
/integrate 完成

栈状态:
  基础组件: <docker compose ps 状态>
  server:   :8080 ✅ / ❌
  web:      :5173 ✅ / ❌

smoke 通过率: <n>/<m>
报告: docs/integrate-report.md

✅ 建议下一步：/verify
```

## Phase 决策门 — M6.2

按 `skills/decision-gate/SKILL.md` 标准模板：

```bash
if ! printf '%s' "$ARGUMENTS" | grep -q -- '--auto'; then
  node "$DDT_PLUGIN_ROOT/bin/emit-decision.mjs" --phase integrate --action point \
    --options "accept|modify|add|regenerate"
fi
```

```typescript
{
  questions: [{
    question: "栈联调已完成（基础组件 + server + web + smoke），如何继续？",
    header: "Integrate review",
    multiSelect: false,
    options: [
      { label: "接受并继续 (Recommended)",
         description: "进入 /verify（test + review）",
         preview: "<docs/integrate-report.md 摘要>" },
      { label: "修改某条具体内容",
         description: "如 db migration 漏迁某表 / smoke 路径错误" },
      { label: "新增内容",
         description: "需要补 health endpoint / 加 smoke 用例" },
      { label: "重新生成（带说明）",
         description: "整体不对 / 换 preset" }
    ]
  }]
}
```

## --tear-down

`/integrate --tear-down` 起栈 → smoke → 自动拆环境。适合 CI / 演示一次性运行。  
默认 **保留栈**（`/verify` 阶段可复用），手动 `docker compose down` 清理。

## --reuse-stack（v0.9.12 D29 新增）

`/integrate --reuse-stack` 假设基础组件（MySQL/Postgres/Redis）已经在跑——直接跳过 Phase 2/3 的 docker compose 准备/启动，进入 Phase 4 db migration → 5/6 启 server/web → 7 smoke。

**典型场景**：
- 用 Colima / Docker Desktop / 物理机已起 db
- 团队共享开发数据库
- 多项目复用同一 MySQL 实例

**自动触发**：当 docker compose（v2 plugin）和 docker-compose（standalone v5）都不可用时，如果检测到 :3306 / :5432 / :6379 已 listen，会**自动启用** --reuse-stack 模式（不需要手动加参数）。

## v0.9.12 D29 行为要点

- **环境侦测放宽**：docker compose 多路径 fallback（v2 plugin → v1 standalone → 已运行栈）；端口 8080/5173 已占用从 fail 改 warning
- **db migration 多路径**：除 flyway/prisma/alembic 外，识别 Spring Boot 原生 `schema.sql` + `data.sql`（hint 不强跑——Spring Boot 启动时会自动执行）
- **失败时 dump log 尾**：server/web 启动失败时，最近 30 行日志输出到 stderr，让 LLM 直接看真实错误而非"60s 未就绪"
- **自动绕代理**：检测 `HTTP_PROXY`/`http_proxy` → smoke 阶段自动注入 `NO_PROXY=localhost,127.0.0.1`
- **报告必落**：用 try/finally 包主流程，无论中途哪个 phase fail，`docs/integrate-report.md` 都会写出
- **项目特定问题**留给 LLM 智能处理：utf8mb4 / RSA 公钥 / Java 版本切换 / 密码不匹配等不硬编码到 known issues，DDT 仅提供"看 log"和"重试"工具，LLM 看完 stderr/server.log 自己决定改哪个 application.yml

## --skip-server / --skip-web / --skip-smoke

仅起部分组件（用于增量调试）：

- `--skip-server`：跳过 Phase 5（适合纯前端调试，但 Phase 7 smoke 也会跳过 server health）
- `--skip-web`：跳过 Phase 6（适合 API-only 项目）
- `--skip-smoke`：跳过 Phase 7（仅起栈不验证）

## Phase 末 — 标记阶段完成

```bash
node "$DDT_PLUGIN_ROOT/bin/emit-phase.mjs" --phase integrate --action end
```

$ARGUMENTS

## 设计原则

- **stage-appropriate**：/integrate 只做"代码 → 跑起来"的桥接；不做单元测试（/test 范围）/ 代码评审（/review 范围）
- **保留 stack 默认**：让 /verify 阶段直接复用栈，避免重复 1 分钟启动开销
- **preset 渐进支持**：v0.9.11 自动支持 java-modern / node-modern；其他 preset（go-modern / python-fastapi）输出 checklist 让用户手动跑
- **失败可重入**：每 phase 独立，挂在哪一步修哪一步重跑；不强制从头来
- **soft over hard**：/verify 不强制依赖 /integrate（仅软提醒），让别个单元/未部署项目仍能用 /verify
