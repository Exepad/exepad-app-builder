# API Reference

The Exepad Agent exposes a FastAPI app whose supported client-facing endpoints are `POST /r` and `GET /health`. The running app also includes auxiliary Google ADK routes (sessions, artifacts, evals, dev UI, generated docs), and the checked-in `openapi.json` captures that full generated surface.

---

## Endpoints

### POST `/r` — Main SSE Endpoint

The primary endpoint for all agent operations. Accepts a JSON request and returns a streaming SSE response.

#### Request

**Content-Type:** `application/json`

**Headers:**
| Header | Required | Description |
|--------|----------|-------------|
| `Authorization` | Optional in development, required in production | IAM bearer token used to verify the trusted backend caller |
| `Content-Type` | Required | `application/json` |

**Body:**

```json
{
  "user_id": "user-123",
  "session_id": "session-abc-456",
  "operation_mode": "create",
  "payload": {
    "app_name": "My Portfolio",
    "app_description": "A personal portfolio website with projects and contact form",
    "app_type": "website",
    "app_language_code": "en",
    "correlation_id": "req-789",
    "app_uuid": "app-uuid-123",
    "image_catalog": [],
    "document_catalog": []
  }
}
```

**Required fields:**

| Field | Type | Description |
|-------|------|-------------|
| `user_id` | string | Unique user identifier |
| `session_id` | string | Session identifier (UUID recommended) |
| `operation_mode` | string | One of: `create`, `edit` |
| `payload` | object | Operation-specific data (see below) |

**Payload fields (varies by operation_mode):**

| Field | Modes | Description |
|-------|-------|-------------|
| `app_name` | create | Application name |
| `app_description` | create | Natural language description |
| `app_type` | create | Application type |
| `app_language_code` | create, edit | Language code (ISO 639-1) |
| `app_config` | edit | Current app JSON configuration |
| `user_prompt` | edit | Edit instruction in natural language |
| `current_page_uuid` | edit | UUID of the page being viewed |
| `selected_component` | edit | UUID of selected component |
| `selected_component_config` | edit | JSON config of selected component |
| `correlation_id` | all | Idempotency key (prevents duplicate processing) |
| `app_uuid` | all | Application UUID for backend tracking |
| `image_catalog` | create, edit | Array of available user images |
| `document_catalog` | create, edit | Array of available user documents |
| `action_label` | edit | Direct action identifier (bypasses help desk routing) |
| `action_payload` | edit | Data for direct actions |

#### Response

**Content-Type:** `text/event-stream`

**Headers:**
```
Cache-Control: no-cache
Connection: keep-alive
```

#### SSE Event Format

All events use the `message` event type:

```
event: message
data: {"type": "progress", "step_name": "Creating Pages", ...}

event: message
data: {"type": "chat_message", "message": "Your app is ready!", ...}
```

#### SSE Event Types

**`progress`** — Workflow progress update

```json
{
  "type": "progress",
  "event_id": "evt-123",
  "timestamp": "2026-02-12T10:30:00Z",
  "step_name": "Generating page components",
  "status": "in_progress",
  "progress_number": 65,
  "total_time_to_complete": 45
}
```

**`chat_message`** — User-facing message

```json
{
  "type": "chat_message",
  "event_id": "evt-456",
  "timestamp": "2026-02-12T10:31:00Z",
  "message": "I've created your portfolio with 3 pages: Home, Projects, and Contact."
}
```

**`page_reload`** — Signal frontend to refresh

```json
{
  "type": "page_reload",
  "event_id": "evt-789",
  "timestamp": "2026-02-12T10:31:05Z"
}
```

**`app_config_updated`** — Configuration change notification

```json
{
  "type": "app_config_updated",
  "event_id": "evt-012",
  "timestamp": "2026-02-12T10:31:10Z",
  "changed_component_uuid": "comp-abc",
  "change_type": "modify",
  "changed_page_uuid": "page-xyz",
  "goto_page_slug": "/projects"
}
```

**`backend_response`** — Final workflow result

```json
{
  "type": "backend_response",
  "timestamp": "2026-02-12T10:31:30Z",
  "callback_data": {
    "status": "success",
    "session_id": "session-abc-456",
    "correlation_id": "req-789",
    "app_uuid": "app-uuid-123",
    "workflow_type": "create",
    "app_config": { "...complete app JSON..." },
    "chat_response": "Your portfolio is ready!",
    "agent_metrics": { "...timing and token data..." },
    "execution_context": {
      "agent_version": "2.0.0",
      "environment": "production",
      "completed_at": "2026-02-12T10:31:30Z"
    }
  }
}
```

**`backend_response` (failure):**

```json
{
  "type": "backend_response",
  "timestamp": "2026-02-12T10:31:30Z",
  "callback_data": {
    "status": "failed",
    "session_id": "session-abc-456",
    "correlation_id": "req-789",
    "error": {
      "type": "RateLimitError",
      "message": "Rate limit exhausted after 5 retries",
      "timestamp": "2026-02-12T10:31:30Z"
    },
    "agent_errors": [
      {
        "error_type": "rate_limit_exhausted",
        "agent_name": "ComponentBuilder",
        "summary": "429 RESOURCE_EXHAUSTED after 5 retries"
      }
    ]
  }
}
```

#### Error Responses

| Status | Condition | Body |
|--------|-----------|------|
| 400 | Invalid JSON body | `{"error": "Invalid JSON in request body", "detail": "..."}` |
| 400 | Invalid payload JSON | `{"error": "Invalid JSON in payload field", "detail": "..."}` |
| 400 | Payload not an object | `{"error": "Payload must be a JSON object"}` |
| 402 | Insufficient credits | `{"error": "subscription_error", "message": "...", "subscription_required": true}` |
| 409 | Duplicate correlation_id | `{"error": "Duplicate request", "correlation_id": "..."}` |
| 422 | Missing required fields | `{"error": "Missing required fields", "missing": ["user_id", ...]}` |
| 429 | Rate limit exceeded | `{"error": "Rate limit exceeded. Please try again later."}` |

---

### GET `/health` — Health Check

Returns the service health status.

#### Response

```json
{
  "environment": "development",
  "session_service": "ok",
  "artifact_service": "ok",
  "status": "ok"
}
```

**Status values:**
- `"ok"` — All services available
- `"degraded"` — One or more services unavailable

---

### POST `/cancel` — Out-of-Band Cancellation

The runtime worker forwards the editor's Stop button to this endpoint to abort an
in-flight run without depending on the SSE connection. The handler writes a
process-local cancel marker keyed by the supplied `session_id`; the running
workflow's watchdog (`_iter_with_cancel`) polls that marker and aborts the
in-flight LLM call within ~1.5 seconds. The self-hosted container runs a single
agent instance, so an in-memory marker is sufficient. Without this path, Stop
did nothing until the workflow finished naturally.

**Request body:**

```json
{ "session_id": "Session_xxx" }
```

**Response:** `200 OK` with `{ "status": "cancel_requested", "written": true }`.

The marker is cleared at the start of the next run that reuses the same
`session_id`, so a fresh build is never aborted by a stale marker.

---

## CORS Configuration

CORS headers are managed by FastAPI's `CORSMiddleware`:

| Environment | Allowed Origins |
|-------------|----------------|
| **Production** | `https://backend.exepad.com`, `https://exepad-backend-*.run.app`, custom origins from `ALLOWED_ORIGINS` env |
| **Development** | `*` (all origins) |

Custom production origins can be set via the `ALLOWED_ORIGINS` environment variable (comma-separated).

---

## Rate Limiting

A sliding-window rate limiter protects the `/r` endpoint:

| Setting | Default | Env Var |
|---------|---------|---------|
| Max requests per window | 10 | `RATE_LIMIT_REQUESTS` |
| Window duration (seconds) | 60 | `RATE_LIMIT_WINDOW` |

Rate limiting is per client IP address. Only the `/r` endpoint is rate-limited.

---

## Idempotency

Requests include an optional `correlation_id` in the payload. If a request with the same `correlation_id` arrives within the idempotency window (60 seconds), it receives a `409 Conflict` response.

- **Window:** 60 seconds
- **Max tracked IDs:** 500 (oldest entries pruned first)
- **On success:** Lock released after session cleanup
- **On failure:** Lock released immediately (allows client retry)

---

## Subscription Pre-flight

Before processing any request, the agent validates the user's subscription:

```
Agent → POST {BACKEND_URL}/api/subscription/check-credits/
     ← 200 OK (proceed)
     ← 402 Payment Required (block with error message)
```

- **Timeout:** 10 seconds
- **Fail-closed:** Denies request if backend is unreachable
- **Skipped in test mode:** When `IS_TEST=true`
