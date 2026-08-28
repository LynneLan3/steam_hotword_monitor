# External Data Retrieval Contract V1

This is the project-level contract for time-sensitive external providers in
`steam_hotword_monitor`. It is first implemented for Games Popularity.

## Contract

1. **Cache First** — a normal run reads a durable successful observation before
   creating provider requests.
2. **Refresh by Policy, Never by Run** — the Games Popularity policy is one
   complete successful observation per business day and App ID. A new run does
   not itself invalidate that observation.
3. **Success Is Durable** — complete successful observations are written to the
   append-only `Steam_每日快照` ledger and can serve later runs.
4. **Failure Never Overwrites Success** — failed or incomplete provider data is
   recorded as an attempt and does not replace successful fields in
   `候选主表`, nor turn a raw observation into an enriched observation.
5. **Observation Is Append-Only** — source observations and provider attempts
   retain their run identity and are not updated in place.
6. **Fetch Attempt and Successful Observation Are Separate** —
   `外部数据获取尝试` records every GP endpoint attempt; only a complete
   latest-plus-history result is eligible for the successful GP cache.
7. **Forced Refresh Is Explicit** — `forceRefreshGamesPopularity()` (also
   exposed in the menu) consumes a one-shot force flag. `runSteamHotword01B()`
   does not force-refresh by default.

## Games Popularity V1 boundary

- The normal run uses the current business-day successful observation for an
  App ID and requests only policy misses.
- The successful cache requires Followers, 7d baseline, 7d gain, growth rate,
  and coverage days; a latest-only or history-failed result is not a hit.
- Endpoint attempts record provider, endpoint, App ID, run ID, HTTP status,
  result, and a safe error summary. API keys and request URLs are never stored.
- This contract does not change the existing P1/P2/1A/Today Action or
  `alreadyHandled` semantics.

Future providers must adopt this contract individually; V1 does not authorize
a cross-provider refactor.
