# Payload Structure Documentation

This directory documents the payload structure for the `/r` endpoint.

## Request Payload Structure

```json
{
    "operation_mode": "create|edit",
    "user_id": "string",
    "session_id": "string",
    "payload": "JSON string containing mode-specific data"
}
```

## Creation Mode Payload (`operation_mode: "create"`)

```json
{
    "app_name": "My App",
    "app_type": "website|form|dataapp|custom",
    "app_language_code": "en",
    "initial_description": "Description of the app to create",
    "current_prompt": "Same as initial_description for creation"
}
```

## Edit Mode Payload (`operation_mode: "edit"`)

```json
{
    "app_config": "JSON string of the current app configuration",
    "app_uuid": "UUID of the app being edited",
    "app_name": "Current app name",
    "app_language_code": "en",
    "current_prompt": "User's edit request",
    "current_page_uuid": "UUID of the page being viewed (optional)",
    "selected_component": "UUID of selected component (optional)",
    "action_label": "Direct action label (optional)",
    "action_payload": "Payload for direct action (optional)"
}
```

## Direct Actions (`action_label`)

| Action Label | Action Payload | Description |
|--------------|----------------|-------------|
| `set_blogging_status` | `enable` or `disable` | Enable/disable blog functionality |
| `add_blog_post` | - | Create a new blog post |
| `add_contact_info` | - | Add contact information section |

## SSE Response Events

The endpoint returns Server-Sent Events (SSE) with these event types:

- `progress`: Progress updates during workflow execution
- `chat_message`: Final chat response to user
- `page_reload`: Instruction to reload the page
- `app_config_updated`: Notification that app config was updated
