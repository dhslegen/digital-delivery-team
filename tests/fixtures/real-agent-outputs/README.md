# Real Agent Outputs Fixtures

> v0.9 B1：把"真实 product-agent / pm-agent / architect-agent / design-brief-agent 产出"
> 作为解析器测试的 golden fixture，避免合成测试与真实 agent 输出脱节
> （v0.8.0 D5 / v0.8.1 D5 / v0.8.2 D15 三轮 EARS 解析回归的根本原因）。

## 目录结构

```
real-agent-outputs/
├── README.md                     ← 本文件（来源标注 + 使用说明）
├── prd/                          ← product-agent 产出
│   ├── team-admin-v0.8.md       (团队成员管理后台 / v0.8 实战 / 5 故事 EARS `As an`)
│   └── ...
├── wbs/                          ← pm-agent 产出
├── arch/                         ← architect-agent 产出（arch.md / api-contract.yaml / data-model.md）
├── design-brief/                 ← design-brief-agent 产出
└── tech-stack/                   ← resolve-tech-stack.mjs 产出
```

## 来源标注

每个 fixture 必须在文件首行加注释或在本 README 表格里标注：
- 来源项目（如 `true-test/ddt-team-admin-v0.8.1/`）
- 实战时间
- agent 版本（DDT 版本）
- 触发的回归 ID（如有）

| 文件 | 来源项目 | 时间 | DDT 版本 | 触发回归 |
|---|---|---|---|---|
| `prd/team-admin-v0.8.md` | ddt-team-admin-v0.8 | 2026-05-06 | v0.8.0 → v0.8.1 实战 | D5（中文表格） |
| `prd/team-admin-v0.8.1.md` | ddt-team-admin-v0.8.1 | 2026-05-06 | v0.8.1 → v0.8.2 实战 | D15（`As an` vowel） |
| `tech-stack/team-admin-v0.8.1.json` | 同上 | 同上 | 同上 | (frontend.type=spa + libraries) |
| `design-brief/team-admin-v0.8.1.md` | 同上 | 同上 | 同上 | D6 雏形（多 tags + 多行 rationale） |

## 使用方式

### 解析器测试

```js
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { extractUserStories } from '../../bin/compile-design-brief.mjs';

test('extractUserStories 对所有真实 PRD fixture 都能抽到 ≥ 1 条', () => {
  const fixtureDir = 'tests/fixtures/real-agent-outputs/prd';
  for (const f of readdirSync(fixtureDir)) {
    if (!f.endsWith('.md')) continue;
    const text = readFileSync(join(fixtureDir, f), 'utf8');
    const stories = extractUserStories(text);
    assert.ok(stories.length >= 1, `${f}: 实战 PRD 必须能抽出至少 1 条 user story`);
  }
});
```

### 自动收集（DDT_COLLECT_FIXTURE=1）

跑命令时若设置了环境变量，命令会提示用户是否提交本次 PRD/brief/tech-stack
作为新 fixture（v0.9 B1-T3 实现）。

## 添加新 fixture 的流程

1. 真实跑过命令的项目里有 docs/prd.md（或其他产物）
2. 复制到 `tests/fixtures/real-agent-outputs/<type>/<project-name>-<DDT 版本>.md`
3. 文件首行加 `<!-- 来源: <project>, 时间: <date>, DDT: <version>, 回归: <id-或-none> -->`
4. 更新本 README 的表格
5. 跑 `yarn test` 确保所有解析器仍能处理新 fixture

## 不应放进 fixture 的内容

- 任何含真实姓名 / 邮箱 / 公司机密的产物
- 体积超 100KB 单文件（用真实片段截取，不必全文）
- 不是真实 agent 产出（合成数据请放 inline test）
