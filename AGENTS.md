## 멀티 에이전트 운영 (luckyzz)

여러 에이전트(claude, codex 등)가 워크트리 단위로 병렬 작업하고, coord가 병합을 전담한다. 운영 문서는 `/Users/illheon/agent-ops/luckyzz/`:

- `RULES.md` — 반드시 지킬 규칙 (안전 규칙 4절 포함)
- `board.md` — 워크트리 ↔ 에이전트 매핑, 공용 파일 점유, 로그
- `roster.md` — 역할 배정 / `STATUS.md` — 사람이 읽는 보고 창구
- `ops.conf` — 빌드·테스트·포트 등 설정 / `units.conf` — 병렬 작업 단위
- `tasks/`, `handoff/`, `reviews/` — 작업 지시, 완료 보고, 리뷰 결과

요약: 워크트리 1개당 쓰기 에이전트 1개 · 저장소 루트는 병합 전용(coord만) · 공용 파일 동시 작업 금지 · 합성 데이터만 · 교차 리뷰(다른 회사 모델) · `pkill -f` 금지 · 격리 포트 쓰기 전 주인 확인.
역할별 절차: Claude Code라면 `herdr-agent-ops` 플러그인의 `ops-coord` / `ops-worker` / `ops-reviewer` 스킬, 아니면 `/Users/illheon/agent-ops/luckyzz/prompts/`의 같은 이름 문서.
