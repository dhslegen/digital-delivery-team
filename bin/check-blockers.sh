#!/usr/bin/env bash
# M2-3: 共享的 blockers 门禁检查
# 退出码：0 = 无未解决阻塞；2 = 存在未解决阻塞
set -eu

if [ ! -f docs/blockers.md ]; then
  exit 0
fi

unresolved=$(awk '/^- \*\*resolved_at\*\*: null$/' docs/blockers.md | wc -l | tr -d ' ')
if [ "${unresolved:-0}" -gt 0 ]; then
  echo "❌ docs/blockers.md 中存在 $unresolved 条未解决阻塞，请先处理。"
  echo "   未解决项来自："
  awk '/^## /{h=$0} /^- \*\*resolved_at\*\*: null$/{print "   - "h}' docs/blockers.md
  exit 2
fi
exit 0
