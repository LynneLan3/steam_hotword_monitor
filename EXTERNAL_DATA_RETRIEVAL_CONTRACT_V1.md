# EXTERNAL DATA RETRIEVAL CONTRACT V1

This project-level contract applies to external providers and resources in
`steam_hotword_monitor`. It is currently implemented only for Games
Popularity; it does not require migrating other providers in this iteration.

## Contract rules

1. **CACHE_FIRST**

   Before any external Provider request, check whether reusable successful data
   already exists.

2. **REFRESH_BY_POLICY_NOT_RUN**

   A normal program Run is never itself a refresh condition. Each resource must
   define a freshness/refresh policy, such as `ONCE`, `DAILY`, `WEEKLY`, or
   `MANUAL`. A Provider request is allowed only when data is missing or that
   policy is due.

3. **SUCCESS_IS_DURABLE**

   A successful collection result must be persisted and reusable by later
   independent Runs.

4. **FAILURE_NEVER_OVERWRITES_SUCCESS**

   HTTP 429, timeout, 403/5xx, network error, parse error, and empty/invalid
   response must not replace the Last Successful Value with `null`, empty data,
   or a failure state.

5. **OBSERVATION_APPEND_ONLY**

   Successful time-series observations are appended in principle. A new
   successful observation must not destroy an older successful record.

6. **ATTEMPT_IS_NOT_OBSERVATION**

   A Fetch Attempt must be distinct from a Successful Observation. A failed
   request must never be interpreted as a real external data value being empty.

7. **EXPLICIT_FORCE_REFRESH**

   Any future bypass of valid cache must use an explicit force-refresh action.
   The ordinary `runSteamHotword01B()` must not implicitly force-refresh every
   Provider.

8. **DEFAULT_POLICY**

   A new external Provider/resource defaults to `CACHE_FIRST`. An
   `EVERY_RUN`/`ALWAYS_FETCH` policy requires explicit configuration and a
   documented business reason; it must not be the default implementation.

## Current implementation coverage

The first Provider/resource covered by Contract V1 is:

- **Provider:** Games Popularity
- **Resources:** `latest` and `followers`
- **Refresh policy:** `DAILY` (one complete successful observation per
  business day and Steam App ID)
- **Durable success ledger:** `Steam_每日快照`
- **Attempt ledger:** `外部数据获取尝试`

For Games Popularity, only a complete result containing Followers, 7d
baseline, 7d gain, growth rate, and coverage days is a successful cache hit.
Latest-only or history-failed data remains a miss. Attempts retain Provider,
endpoint, App ID, Run ID, HTTP status, result, and a safe error summary; API
keys and request URLs are not persisted.

The existing P1/P2/1A/Today Action and `alreadyHandled` semantics are outside
this contract's change scope.

## Future audit / migration list

The following remain listed only for future audit or migration and are not
modified by Contract V1:

- Steam discovery/search sources (`popularcomingsoon`, `popularnew`)
- Steam Reviews (`appreviews`)
- Google Trends / other external evidence retrieval

This contract does not authorize a cross-provider refactor or migration.
