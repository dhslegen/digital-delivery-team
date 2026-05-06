#!/usr/bin/env bash
# M2-3: 共享的 blockers 门禁检查
# v0.9 D18：区分硬 blocker（阻塞）vs 软 blocker（警告）
#
# 用法：
#   check-blockers.sh                # 仅检查硬 blocker（默认，向后兼容）
#   check-blockers.sh --soft         # 同时报告软 blocker（不阻塞）
#   check-blockers.sh --strict       # 软 blocker 也阻塞（最严格）
#
# 格式约定（详见 templates/blockers.template.md）：
#   硬 blocker：含 `- **resolved_at**: null` 完整 frontmatter
#   软 blocker：`- [BLOCK-XXX-NNN] <描述>` 列表条目（agent 业务严谨性提醒）
#
# 退出码：0 = 通过；2 = 存在硬 blocker（或 --strict 下的软 blocker）
set -eu

MODE="default"
case "${1:-}" in
  --soft)   MODE="soft" ;;
  --strict) MODE="strict" ;;
esac

if [ ! -f docs/blockers.md ]; then
  exit 0
fi

# 硬 blocker：含 `resolved_at: null` frontmatter
hard_count=$(awk '/^- \*\*resolved_at\*\*: null$/' docs/blockers.md | wc -l | tr -d ' ')
# 软 blocker：`- [BLOCK-XXX-NNN]` 列表条目
soft_count=$(grep -c '^- \[BLOCK-' docs/blockers.md 2>/dev/null || true)
soft_count=${soft_count:-0}

if [ "${hard_count:-0}" -gt 0 ]; then
  echo "❌ docs/blockers.md 中存在 ${hard_count} 条未解决【硬】阻塞，请先处理。"
  echo "   未解决项来自："
  awk '/^## /{h=$0} /^- \*\*resolved_at\*\*: null$/{print "   - "h}' docs/blockers.md
  exit 2
fi

if [ "${MODE}" = "soft" ] || [ "${MODE}" = "strict" ]; then
  if [ "${soft_count}" -gt 0 ]; then
    echo "⚠️  docs/blockers.md 含 ${soft_count} 条【软】blocker（业务严谨性提醒，不阻塞下游）："
    grep '^- \[BLOCK-' docs/blockers.md | head -10 | sed 's/^/   /'
    if [ "${MODE}" = "strict" ]; then
      echo "❌ --strict 模式下软 blocker 也阻塞"
      exit 2
    fi
  fi
fi
exit 0
