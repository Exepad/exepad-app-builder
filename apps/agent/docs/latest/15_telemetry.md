# Failure Telemetry

**Status:** Implemented (Phase 4 / Pattern G)
**Default state:** ON (`ENABLE_FAILURE_TELEMETRY=true`)
**Schema stability:** Backward-compatible additions allowed; renames require coordinated sink updates.

The agent emits one structured event per workflow termination so that
agent health can be measured across many sessions. The events are
non-PII and written via `structlog` to **stdout**.

> **In self-host, stdout is the whole story.** The events land in the
> container's log stream — `docker compose logs -f exepad | grep agent_outcome`
> — and nothing ships them anywhere. Sections 6–7 below describe an *optional*
> Google Cloud Logging → BigQuery aggregation pipeline for operators who
> already run on GCP; the self-hosted container never touches it. Everything
> in Sections 1–5 and 8–10 applies regardless of where you run.

This doc is the reference for what gets emitted, how to query it, and
how to extend the schema.

---

## 1. Why this exists

Per-session debug artifacts (`debug/agent_errors.json`, `agent_io/*.json`,
`debug/metrics_summary.json`) are written by the test-run exporter
(`main_agent/testing/run_exporter.py`) to a local output directory, and
nothing aggregates them. You can debug ONE failure forensically, but not
answer questions like:

- Did Pattern E actually reduce `addEventListener` failures?
- Is the platform getting better or worse week over week?
- Which skill bundles are most reliable?
- What's our $/successful-build trend?

`agent_outcome` events are the aggregation-friendly layer. They do NOT
replace the per-session debug artifacts — those remain the place to look
when forensically debugging one bad run.

---

## 2. Architecture

```
ComponentBuilder save fails
   ↓
artifact_tools.py records attempt in RetryContext
   ↓
ValidatorBatch may run (skipped on fatal failures — RC3)
   ↓
creation_workflow.py / editing_workflow.py terminal block
   ↓
partial_ship_service.decide() → fatal | partial | abort
   ↓
emit_outcome(...)                 ← single structlog INFO line
   ↓
stdout  ──────────────────────────── self-host stops here
   ↓                                 (docker compose logs / your log driver)
   │
   └─ [OPTIONAL, managed GCP only]
        Cloud Logging → BigQuery sink (one-time gcloud setup)
          ↓
        agent_outcomes table
          ↓
        SQL view at apps/agent/sql/agent_outcomes_weekly.sql
          ↓
        Scheduled query → Slack/email digest
```

Everything down to stdout works with no infrastructure at all — events
appear in the log stream as soon as the agent restarts. The optional
branch is additive, one-time setup, and only relevant if you are already
running on GCP.

---

## 3. Schema reference

The emitter is `main_agent/agents/utils/failure_telemetry.py:emit_outcome`.

### Stable identifier

| Field | Type | Required | Notes |
|---|---|---|---|
| `event` | str (literal `"agent_outcome"`) | Yes | Cloud Logging filter routes on this. **Do not rename without updating the BigQuery sink config.** |

### Always-populated fields

| Field | Type | Notes |
|---|---|---|
| `session_id` | str | ADK session ID (`Session_xxx`). Correlates multiple events from the same session if e.g. partial-ship is followed by a regenerate-failed-component edit. |
| `workflow` | enum | `creation` \| `editing` (`Workflow` literal in `agents/utils/failure_telemetry.py`) |
| `outcome` | enum | `success` \| `partial_ship` \| `abort` |
| `component_count` | int | Total components ComponentBuilder attempted in this run. 0 for editing workflow (delta operation, not whole-app). |

### Failure detail (populated on `abort` and `partial_ship`)

| Field | Type | Notes |
|---|---|---|
| `fatal_failures` | list[str] | Component names with a fatal failure class. Empty on `partial_ship`. |
| `recoverable_failures` | list[str] | Component names with a recoverable class (validation_failed, contrast, forbidden API). |
| `failure_classes` | dict[str, str] | `{component_name: class_name}`. Class enum from `component_failure_service.FATAL_FAILURE_CLASSES` and validation_failure_classification. |

### Optional / future-populated fields

These are accepted by the emitter but **not yet populated by any caller**.
See [Section 8 — How to extend](#8-how-to-extend) for how to wire each one up.

| Field | Type | Status | Notes |
|---|---|---|---|
| `error_categories` | dict[str, int] | NOT POPULATED | Counts of `forbidden_api_registry` api_id occurrences across the session. Aggregates Pattern A's per-attempt categorisation. **Highest-value field to add next.** |
| `auto_fix_categories` | dict[str, int] | NOT POPULATED | Counts of categorised auto-fixes applied. Source: `RetryContext.attempts[*].auto_fixes_categorized`. |
| `cost_usd` | float \| None | NOT POPULATED | Total session cost. Source: `MetricsTracker`. |
| `duration_seconds` | float \| None | NOT POPULATED | Total workflow duration. Source: `MetricsTracker`. |

`None` values are filtered out at emit time so the BigQuery schema stays compact —
absent keys are easier to evolve than always-null columns.

### Example payload

```json
{
  "event": "agent_outcome",
  "session_id": "Session_0cc92875b321be23f14b518d7afbc393",
  "workflow": "creation",
  "outcome": "abort",
  "component_count": 3,
  "fatal_failures": ["HomeContent"],
  "recoverable_failures": ["MainFooter"],
  "failure_classes": {
    "HomeContent": "validation_failed",
    "MainFooter": "validation_failed"
  }
}
```

---

## 4. Emit points

Maintain this table when adding new emit sites — keeps the BigQuery view
in sync with what the agent actually produces.

| Workflow | Outcome | Source file:line | Trigger |
|---|---|---|---|
| creation | `abort` | `creation_workflow.py` (in `if all_stubs:` → `decision.should_abort`) | Any fatal failure class, OR `ENABLE_PARTIAL_SHIP=false` and recoverable failures exist |
| creation | `partial_ship` | `creation_workflow.py` (in `if all_stubs:` → `decision.ship_partial`) | Only recoverable failures AND `ENABLE_PARTIAL_SHIP=true` |
| creation | `success` | `creation_workflow.py` (end of `execute()`, guarded by `is_partial_ship_run`) | Clean build, no failures |
| editing | `abort` | `editing_workflow.py` `_record_terminal_component_failure` | Any unresolved component (editing has no partial-ship — see ADR below) |

### ADR: editing has no partial-ship

Edits are delta operations: the user asked for X. Shipping a partial
delta with placeholder TSX for the user's just-requested change is
more confusing than rolling back. So:

- `editing` workflow always emits `outcome="abort"` on failure.
- Pattern G telemetry still fires so the BigQuery view shows edit
  failure rates alongside creation rates.
- If product later wants partial-ship for edits, the analogous
  `partial_ship_service.decide` integration would go in
  `editing_workflow.py:_record_terminal_component_failure`. The
  6 caller sites of that method all `await ... ; return`
  unconditionally, so they'd need to switch to checking
  `state.terminal_failure_summary` after the call to honor
  partial-ship's "don't abort" intent.

### Gaps to fill

- **Editing success** has no event. Adding one would make the
  success-rate dashboard accurate for edits. Easy fix: emit at the
  end of `editing_workflow.py:execute()` in the success path.

---

## 5. Operational gates

Both gates live in `apps/agent/config.py`:

```python
# Pattern G — Failure telemetry. Defaults on.
ENABLE_FAILURE_TELEMETRY = (
    os.environ.get("ENABLE_FAILURE_TELEMETRY", "true").lower() == "true"
)

# Pattern C — Partial-Ship mode. Defaults off pending UI work.
ENABLE_PARTIAL_SHIP = os.environ.get("ENABLE_PARTIAL_SHIP", "false").lower() == "true"
```

Disabling telemetry is a fast no-op kill switch — the emitter checks
the flag first and returns immediately. Useful if the extra log volume
is in your way.

Toggle it by setting the env var and restarting:

```bash
# Self-host: add to your .env, then
docker compose up -d          # ENABLE_FAILURE_TELEMETRY=false
```

---

## 6. Reading the events

Self-host: the events are plain JSON lines on stdout.

```bash
docker compose logs -f exepad | grep agent_outcome
# from source:  ./run.sh local   → the runtime/agent log stream
```

### Optional — Cloud Logging (managed GCP deployments only)

If you run the agent on Cloud Run, events land in Cloud Logging with no
extra configuration. The first useful query:

**GCP Console → Logging → Logs Explorer**

```
resource.type="cloud_run_revision"
resource.labels.service_name="exepad-agent"
jsonPayload.event="agent_outcome"
```

Sort by timestamp, drill into individual sessions, filter by outcome.

**CLI alternative:**

```bash
gcloud logging read 'jsonPayload.event="agent_outcome"' --freshness=24h --format=json
```

---

## 7. Optional — BigQuery sink (managed GCP only, one-time, ~10 minutes)

> Not applicable to the self-hosted container. Skip this section unless you
> already run the agent on GCP and want cross-session aggregation. The project
> id `exepad` in the commands below is a placeholder — substitute your own.

### 7.1 Create the dataset

```bash
bq --project_id=exepad mk --dataset --location=US agent_logs
```

### 7.2 Create the sink

```bash
gcloud logging sinks create agent-outcomes-sink \
  bigquery.googleapis.com/projects/exepad/datasets/agent_logs \
  --log-filter='jsonPayload.event="agent_outcome"'
```

The command prints a service account name like
`p123456789-xxxxxx@gcp-sa-logging.iam.gserviceaccount.com`.

### 7.3 Grant the sink write access

```bash
SINK_SA=$(gcloud logging sinks describe agent-outcomes-sink \
  --format='value(writerIdentity)' | sed 's/serviceAccount://')
bq --project_id=exepad add-iam-policy-binding \
  --member="serviceAccount:$SINK_SA" \
  --role=roles/bigquery.dataEditor \
  agent_logs
```

### 7.4 Apply the SQL view

```bash
bq --project_id=exepad query --nouse_legacy_sql \
  < apps/agent/sql/agent_outcomes_weekly.sql
```

After 5–10 minutes, BigQuery will have one row per emitted event in
`exepad.agent_logs.agent_outcomes_*` (date-suffixed tables) and the
weekly view at `exepad.agent_analytics.agent_outcomes_weekly` will
return aggregations.

### 7.5 Verify the sink

Force one outcome event:
```bash
# Trigger any creation in dev — even a successful build emits.
# Then:
bq --project_id=exepad query --nouse_legacy_sql \
  'SELECT timestamp, jsonPayload.session_id, jsonPayload.outcome
   FROM `exepad.agent_logs.agent_outcomes_*`
   ORDER BY timestamp DESC LIMIT 5'
```

---

## 8. How to extend

The current emit is intentionally minimal. Here's the suggested order
for adding the optional fields, with code-level pointers.

### 8.1 Add `cost_usd` and `duration_seconds` (~30 min total)

Cost and duration unlock the "is the platform getting cheaper?" line of
questions. `MetricsTracker` already computes both; just wire them into
the call sites.

In `creation_workflow.py`, `MetricsTracker` is in scope as
`metrics_tracker`. At each `emit_outcome(...)` call, add:

```python
emit_outcome(
    ...,
    cost_usd=metrics_tracker.total_cost_usd if metrics_tracker else None,
    duration_seconds=metrics_tracker.total_duration_seconds if metrics_tracker else None,
)
```

(Confirm the exact attribute names against
`main_agent/agents/orchestrator/models/timing_tracker.py` —
they may be `total_cost`, `duration`, or accessible via a method.)

### 8.2 Add per-turn skill activations (~30 min)

ADK's `SkillToolset` writes activated skills to session state under
`_adk_activated_skill_<agent_name>`. Reading those at workflow terminal
gives "which skills produced the most aborts?" segmentation. Worth
adding a `skills_activated: dict[str, list[str]]` field to
`emit_outcome` once we want that view.

```python
activated = {
    agent: ctx.session.state.get(f"_adk_activated_skill_{agent}", [])
    for agent in ("ComponentBuilder", "ComponentBuilderMultiple", "Surveyor")
}
```

### 8.3 Add `error_categories` and `auto_fix_categories` (~1 hour)

This is the **highest-leverage** field to add. It directly answers "did
our fix work?" by surfacing a daily count of each
`forbidden_api_registry.api_id`. Source: `RetryContext.attempts`.

```python
def _aggregate_categories(retry_context_state: dict) -> tuple[dict[str, int], dict[str, int]]:
    """Walk every component's RetryContext and count categories across all attempts."""
    error_counts: dict[str, int] = {}
    fix_counts: dict[str, int] = {}
    for record in (retry_context_state or {}).values():
        for attempt in record.get("attempts", []):
            for cat, errs in (attempt.get("errors_categorized") or {}).items():
                error_counts[cat] = error_counts.get(cat, 0) + len(errs)
            for cat, n in (attempt.get("auto_fixes_categorized") or {}).items():
                fix_counts[cat] = fix_counts.get(cat, 0) + n
    return error_counts, fix_counts
```

Then at each `emit_outcome` call:

```python
err_cats, fix_cats = _aggregate_categories(
    ctx.session.state.get(StateKeys.COMPONENT_RETRY_CONTEXT, {})
)
emit_outcome(
    ...,
    error_categories=err_cats or None,
    auto_fix_categories=fix_cats or None,
)
```

After this lands, the regression-detection query becomes:

```sql
SELECT
  DATE(timestamp) AS day,
  SUM(CAST(JSON_EXTRACT(error_categories, '$.addEventListener') AS INT64)) AS adde_count
FROM `exepad.agent_logs.agent_outcomes_*`
WHERE _TABLE_SUFFIX BETWEEN '20260420' AND '20260520'
GROUP BY day
ORDER BY day;
```

### 8.4 Add `app_uuid` (~15 min)

Correlates events to specific user-published apps so you can:
- Identify a single app failing repeatedly across sessions
- Surface "top failing apps" to the platform team
- Cross-reference with the existing dashboard's app-uuid filter

```python
emit_outcome(
    ...,
    app_uuid=ctx.session.state.get(StateKeys.APP_UUID),
)
```

Requires adding `app_uuid: str | None = None` to the `emit_outcome`
signature.

### 8.5 Per-component or per-attempt granularity

The current emit is at workflow granularity (one event per workflow
termination). Adding finer granularity:

| Granularity | Pros | Cons |
|---|---|---|
| Workflow (current) | Low volume; clean dashboards | Hides per-component variation |
| Per-component | "Which components fail most?" | ~3-10× event volume |
| Per-attempt | Retry funnel analysis | ~30× event volume; may exceed Cloud Logging quotas |

Recommendation: stay at workflow granularity. Per-component data is
ALREADY in `failure_classes` and `recoverable_failures` — derivable in
SQL. Per-attempt data is in `RetryContext` — surface it via aggregated
`error_categories` rather than one-event-per-attempt.

### 8.6 Surveyor runtime probe stats (Phase 2 — already collected, BigQuery TBD)

`SURVEYOR_RUNTIME_PROBES_ENABLED=true` causes each Class B tool wrapper
in `surveyor_tools.py` to append a record to `runtime_probe_log` in
session state via `_record_probe(tool_context, name, result)`. Per-tool
calls / total-ms / errors / bytes are aggregated by
`MetricsTracker.format_summary` into a `RUNTIME PROBES SUMMARY` block of
the per-workflow human-readable log:

```
RUNTIME PROBES SUMMARY
  --------------------------------------------------------------------
  Tool                             Calls   Total ms   Errors      Bytes
  --------------------------------------------------------------------
  execute_handler_tool                 2        139        1          0
  query_db_tool                        1         12        0          0
  screenshot_preview_tool              1        812        0     14,321
  --------------------------------------------------------------------
    Total probe overhead: 0.96s
```

This is what the cost-vs-baseline soak rides on while the flag is at
10%. To roll into the BigQuery `agent_outcome` stream as a future
extension, add to `emit_outcome`:

```python
probe_log = ctx.session.state.get("runtime_probe_log") or []
emit_outcome(
    ...,
    runtime_probe_count=len(probe_log),
    runtime_probe_total_ms=sum(e.get("duration_ms") or 0 for e in probe_log),
    runtime_probe_errors=sum(1 for e in probe_log if e.get("error")),
)
```

Skip until cost telemetry justifies the extra columns — the human-
readable summary is sufficient for the dark-ship → 10% rollout window.

---

## 9. Querying patterns

### 9.1 Self-host — jq over the log stream

```bash
# Outcome distribution from the current log buffer
docker compose logs --no-log-prefix exepad \
  | grep agent_outcome \
  | jq -rs '[.[] | .outcome] | group_by(.) | map({outcome: .[0], count: length})'

# One specific session
docker compose logs --no-log-prefix exepad \
  | grep agent_outcome | jq -c 'select(.session_id=="Session_xxx")'
```

### 9.2 Cloud Logging (managed GCP only)

```bash
# Outcome distribution last 24h
gcloud logging read 'jsonPayload.event="agent_outcome"' \
  --freshness=24h --format=json \
  | jq -r '[.[] | .jsonPayload.outcome] | group_by(.)
           | map({outcome: .[0], count: length})'

# Find a specific user's session
gcloud logging read \
  'jsonPayload.event="agent_outcome"
   jsonPayload.session_id="Session_xxx"' \
  --format=json | jq '.[].jsonPayload'

# All aborts in last week
gcloud logging read \
  'jsonPayload.event="agent_outcome"
   jsonPayload.outcome="abort"' \
  --freshness=7d --format=json | jq '.[].jsonPayload.fatal_failures'
```

### 9.3 BigQuery — after sink setup (managed GCP only)

```sql
-- Weekly success rate trend
SELECT
  DATE_TRUNC(DATE(timestamp), WEEK) AS wk,
  COUNT(*) AS total,
  COUNTIF(jsonPayload.outcome = 'success') AS wins,
  COUNTIF(jsonPayload.outcome = 'partial_ship') AS partials,
  COUNTIF(jsonPayload.outcome = 'abort') AS aborts,
  SAFE_DIVIDE(COUNTIF(jsonPayload.outcome = 'success'), COUNT(*)) AS success_rate
FROM `exepad.agent_logs.agent_outcomes_*`
WHERE _TABLE_SUFFIX >= FORMAT_DATE('%Y%m%d', DATE_SUB(CURRENT_DATE(), INTERVAL 60 DAY))
GROUP BY wk ORDER BY wk;

-- Top failing components
SELECT
  failed_component,
  COUNT(*) AS occurrence_count
FROM `exepad.agent_logs.agent_outcomes_*`,
     UNNEST(jsonPayload.fatal_failures) AS failed_component
WHERE _TABLE_SUFFIX >= FORMAT_DATE('%Y%m%d', DATE_SUB(CURRENT_DATE(), INTERVAL 7 DAY))
GROUP BY failed_component
ORDER BY occurrence_count DESC
LIMIT 20;

-- Failure classes by frequency
SELECT
  fc.value AS failure_class,
  COUNT(*) AS occurrences
FROM `exepad.agent_logs.agent_outcomes_*`,
     UNNEST(JSON_EXTRACT_KEYS_AND_VALUES(jsonPayload.failure_classes)) AS fc
WHERE _TABLE_SUFFIX >= FORMAT_DATE('%Y%m%d', DATE_SUB(CURRENT_DATE(), INTERVAL 7 DAY))
GROUP BY failure_class
ORDER BY occurrences DESC;
```

### 9.3 The pre-built weekly view

`apps/agent/sql/agent_outcomes_weekly.sql` aggregates by `(workflow, outcome)`
with median cost / duration and top skills. Schedule this as a
recurring query (BigQuery → Schedule → Mondays 09:00 UTC) and pipe to
a Slack webhook for a passive Monday-morning health digest.

---

## 10. Privacy / PII guarantees

Hard rule: **no raw user content in telemetry**.

The schema accepts only:
- Enumerated category keys (`addEventListener`, `validation_failed`)
- Counts (integers)
- Component names (control-plane identifiers)
- Cost/duration numbers
- Skill bundle names

The schema rejects:
- Raw TSX (component source code)
- Raw user prompts
- Raw error message strings
- User input fields

Enforcement is at code-review time via
`tests/unit/test_failure_telemetry.py:test_schema_does_not_carry_raw_tsx_or_prompts`,
which inspects `emit_outcome`'s parameter names and fails CI if any
suggestive name (`tsx`, `prompt`, `raw_error`, `user_input`,
`error_message`) is added.

If you ever need to debug ONE specific session in detail, use the
per-session debug artifacts written by the test-run exporter
(`main_agent/testing/run_exporter.py` → `tests/e2e/output/`) — they have
the full context but are NOT part of the telemetry firehose.

---

## 11. Privacy review checklist (when adding new fields)

When adding a new field to `emit_outcome`, verify ALL of:

- [ ] The field name does not match any forbidden token (covered by the test).
- [ ] The field's value is enumerated, numeric, or a control-plane ID — never free-form text from the user or the LLM.
- [ ] The field is documented in Section 3 of this doc.
- [ ] If optional, default is `None` so it's filtered out of the emit when not populated.
- [ ] A new SQL example is added to Section 9 if the field unlocks a new analytic question.

---

## 12. Roadmap

Suggested implementation order if you want to actually use this:

| Week | Task | Effort | Unlocks |
|---|---|---|---|
| 1 | Read the raw events off stdout (Section 9.1) for a week. Get a feel for volume. | 0 | Familiarity |
| 2 | *(GCP only)* Set up the BigQuery sink (Section 7). Apply the SQL view. Run it manually. | 30 min | Aggregation queries |
| 3 | Populate `cost_usd` and `error_categories` (Sections 8.1 + 8.3). | 90 min | "Did our fix work?" answerable |
| 4 | Schedule the SQL view. Pipe to Slack. | 1 hour | Passive weekly digest |
| 5+ | Add `skill`, `flow_skill`, `app_uuid` per Section 8 as questions arise. | As needed | Segmentation |

---

## 13. Troubleshooting

### Events don't appear in the logs

1. Check `ENABLE_FAILURE_TELEMETRY` env var — defaults `true` but may have been disabled.
2. Verify the agent is actually executing — events only fire on workflow termination, not on `/health` or other endpoints.
3. Check your filter matches exactly (`agent_outcome`; in Cloud Logging, `jsonPayload.event="agent_outcome"`).
4. Cloud Logging has a small ingestion delay (~10 seconds typical, up to 1 minute under load). Container stdout is immediate.

### Events don't appear in BigQuery (managed GCP only)

1. Verify the sink with `gcloud logging sinks describe agent-outcomes-sink`.
2. Check the sink's writer service account has `roles/bigquery.dataEditor` on the dataset.
3. Look for sink-level errors in Cloud Logging itself: search for `protoPayload.serviceName="logging.googleapis.com"` and the sink name.
4. New tables for new days are created lazily on the first event — if no events have been emitted yet today, today's table won't exist.

### Schema mismatch errors in BigQuery

If you add a new field to `emit_outcome` that produces a type BigQuery
hasn't seen before (e.g., a new `dict[str, list[str]]`), the sink will
auto-update the schema but may take a few minutes. Forced refresh:

```bash
bq update --project_id=exepad agent_logs.agent_outcomes_<DATE>
```

### Telemetry is producing noise / errors crash the workflow

If the emit itself fails (shouldn't happen — structlog is robust), wrap
the call in try/except defensively in the caller. Telemetry MUST NOT
break the actual workflow. If you observe this, file as a bug.

---

## 14. Related references

| File | Purpose |
|---|---|
| `main_agent/agents/utils/failure_telemetry.py` | The emitter |
| `tests/unit/test_failure_telemetry.py` | Schema + flag-gate tests |
| `apps/agent/sql/agent_outcomes_weekly.sql` | Pre-built weekly view (BigQuery; optional) |
| `main_agent/agents/orchestrator/app_types/webapp/services/partial_ship_service.py` | Decision logic that drives `outcome` selection |
| `main_agent/agents/orchestrator/app_types/webapp/services/component_failure_service.py` | `FATAL_FAILURE_CLASSES` taxonomy |
| `main_agent/agents/orchestrator/app_types/webapp/services/retry_context_service.py` | Source for future `error_categories` / `auto_fix_categories` |
| `apps/agent/docs/latest/11_error-handling.md` | Failure-class taxonomy detail |
| `apps/agent/docs/latest/13_deployment.md` | How the agent ships inside the container |
| External: ADK observability skill (`adk-observability-guide`) | Cloud Trace / BigQuery Agent Analytics integrations |
