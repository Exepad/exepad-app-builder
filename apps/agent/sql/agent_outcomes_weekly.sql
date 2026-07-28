-- Weekly aggregation of agent_outcome events (Pattern G).
--
-- Source table is populated by Cloud Logging → BigQuery sink filtering on
-- `jsonPayload.event = "agent_outcome"` from the agent's structlog output.
-- Provisioning steps for the sink live in apps/agent/docs/latest/telemetry.md.
--
-- View answers the platform-team's weekly questions:
--   1. What's our success-vs-failure rate by workflow?
--   2. Which error_categories (forbidden_api ids) recurred the most?
--   3. Which skills / flow_skills concentrated the failures?
--   4. Median session cost per outcome class.
--
-- Run as a scheduled query (Mondays 09:00 UTC) and post to the platform
-- Slack channel via the standard Slack-from-BigQuery webhook.

CREATE OR REPLACE VIEW `exepad.agent_analytics.agent_outcomes_weekly` AS
WITH base AS (
  SELECT
    timestamp,
    jsonPayload.session_id     AS session_id,
    jsonPayload.workflow       AS workflow,
    jsonPayload.outcome        AS outcome,
    jsonPayload.component_count AS component_count,
    jsonPayload.fatal_failures AS fatal_failures,
    jsonPayload.recoverable_failures AS recoverable_failures,
    jsonPayload.failure_classes AS failure_classes,
    jsonPayload.error_categories AS error_categories,
    jsonPayload.auto_fix_categories AS auto_fix_categories,
    jsonPayload.cost_usd       AS cost_usd,
    jsonPayload.duration_seconds AS duration_seconds,
    jsonPayload.skill          AS skill,
    jsonPayload.flow_skill     AS flow_skill
  FROM `exepad.agent_logs.agent_outcomes_*`
  WHERE _TABLE_SUFFIX BETWEEN
        FORMAT_TIMESTAMP('%Y%m%d', TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 7 DAY))
    AND FORMAT_TIMESTAMP('%Y%m%d', CURRENT_TIMESTAMP())
)
SELECT
  workflow,
  outcome,
  COUNT(*) AS event_count,
  COUNTIF(outcome = 'success') AS success_count,
  COUNTIF(outcome = 'partial_ship') AS partial_ship_count,
  COUNTIF(outcome = 'abort') AS abort_count,
  APPROX_QUANTILES(cost_usd, 100)[OFFSET(50)] AS median_cost_usd,
  APPROX_QUANTILES(duration_seconds, 100)[OFFSET(50)] AS median_duration_s,
  ARRAY_AGG(DISTINCT skill IGNORE NULLS LIMIT 10) AS top_skills,
  ARRAY_AGG(DISTINCT flow_skill IGNORE NULLS LIMIT 10) AS top_flow_skills
FROM base
GROUP BY workflow, outcome
ORDER BY workflow, outcome;
