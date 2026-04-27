# 部署指南 · <项目名称>

> 版本：v1.0 · 作者：docs-agent · 日期：<YYYY-MM-DD>
> ⚠️ 所有脚本必须幂等：可重复执行，不产生副作用。

---

## 前置条件

| 依赖 | 最低版本 | 验证命令 |
|------|---------|---------|
| Node.js / Python / Go | <version> | `node -v` |
| Docker | <version> | `docker -v` |
| <其他依赖> | <version> | <验证命令> |

---

## 环境变量

```bash
# 复制模板后填写真实值（勿将 .env 提交到版本库）
cp .env.example .env
```

| 变量名 | 说明 | 示例值 |
|-------|------|-------|
| `DATABASE_URL` | 数据库连接串 | `postgres://<user>:<pass>@<host>:5432/<db>` |
| `JWT_SECRET` | JWT 签名密钥 | `<YOUR_JWT_SECRET>` |
| `PORT` | 服务监听端口 | `3000` |
| `<YOUR_ENV_VAR>` | <说明> | `<YOUR_VALUE>` |

---

## 一键部署（幂等）

```bash
# 首次部署与后续更新均可执行此命令
make bootstrap
```

等价手动步骤：

```bash
# 1. 安装依赖
<package-manager> install

# 2. 运行数据库迁移（幂等，已有迁移自动跳过）
<migrate-command>

# 3. 构建产物
<build-command>

# 4. 启动服务
<start-command>

# 5. 冒烟测试（验证服务正常）
<smoke-test-command>
```

---

## 分环境部署

### 本地开发

```bash
<local-dev-command>
```

### Staging

```bash
<staging-deploy-command>
```

### 生产

```bash
<prod-deploy-command>
```

---

## 回滚步骤

| 步骤 | 操作 | 验证命令 |
|------|------|---------|
| 1 | 停止当前版本 | `<stop-command>` |
| 2 | 切换到上一版本 | `<rollback-command>` |
| 3 | 回滚数据库迁移（若有） | `<rollback-migrate>` |
| 4 | 重启服务 | `<start-command>` |
| 5 | 冒烟测试确认 | `<smoke-test-command>` |

---

## Self-Check

- [ ] 部署脚本已验证幂等（重复执行无副作用）
- [ ] 所有敏感信息使用 `<YOUR_XXX>` 占位符
- [ ] 回滚步骤完整且逐步可操作
- [ ] 前置条件版本要求明确
