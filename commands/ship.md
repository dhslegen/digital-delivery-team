---
description: 交付出包 · 串行跑 /package → /report，并打包所有交付产物。
argument-hint: ""
---

# /ship

---

## 执行步骤

1. 跑 `/package`
   - 若前置校验失败（测试覆盖率 < 70%、存在阻塞级评审项或 `/impl` 校验失败未修复）→ 停止

2. 跑 `/report`
   - 若基线文件缺失 → 停止并按 `/report` 指引在项目根目录封盘
   - 若失败 → 停止

3. 打包交付产物：

```bash
tar czf "delivery-${DDT_PROJECT_ID:-unknown}-$(date +%Y%m%d%H%M).tar.gz" \
  README.md docs/ tests/test-report.md \
  $(test -d web/dist    && echo web/dist)    \
  $(test -d server/dist && echo server/dist) \
  2>/dev/null || true
```

4. 汇总输出：

```
/ship 完成

交付包:     delivery-<id>-<ts>.tar.gz
总提效:     <+n>%
质量守门:   ✅ 通过 / ⚠️ <n> 项劣化

包含产物:
  README.md
  docs/
  tests/test-report.md
  web/dist/     （若存在）
  server/dist/  （若存在）
```

若质量守门有劣化项：

> ❌ **存在质量劣化，禁止交付出包，请修复后重跑 `/verify`、`/report` 与 `/ship`**

否则：

> ✅ 交付完成！

$ARGUMENTS
