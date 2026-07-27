# backend_intent — worked examples

Companion reference for the "Backend intent" section of `SKILL.md`. Load via:

    load_skill_resource(skill_name='stitch-importer', file_path='references/backend-intent-examples.md')

## Co-working space manager (5 models)

The user-visible failure mode this example prevents: i9bm2ti4 (2026-05-16), a Stitch import of this same design shipped with only 3 models. `/plans` and `/billing` had no backing data and the components rendered hardcoded mock pricing tiers and invoice rows. `members.plan_type` had no `enum_values`; seed used `Hot Desk` but the PlansContent filter looked for `Part-time`, hiding 3 of 8 members from the Plans page entirely.

Pages: `Occupancy Dashboard`, `Member Directory`, `Resource Management`, `Booking Calendar`, `Plans & Subscriptions`, `Billing & Invoices` (6 pages). The Occupancy Dashboard aggregates across the others, so it adds no new model. Five distinct data domains → five models:

```json
{
  "models": [
    {
      "name": "members",
      "columns": [
        {"name": "full_name", "type": "text"},
        {"name": "company_name", "type": "text"},
        {"name": "email", "type": "text", "is_unique": true},
        {"name": "plan_id", "type": "integer", "references": "plans"},
        {"name": "status", "type": "text", "enum_values": ["active", "inactive", "pending"]}
      ]
    },
    {
      "name": "resources",
      "columns": [
        {"name": "name", "type": "text"},
        {"name": "type", "type": "text", "enum_values": ["desk", "meeting_room", "private_office"]},
        {"name": "capacity", "type": "integer"},
        {"name": "status", "type": "text", "enum_values": ["available", "occupied", "maintenance"]}
      ]
    },
    {
      "name": "bookings",
      "columns": [
        {"name": "member_id", "type": "integer", "references": "members"},
        {"name": "resource_id", "type": "integer", "references": "resources"},
        {"name": "start_time", "type": "text"},
        {"name": "end_time", "type": "text"},
        {"name": "status", "type": "text", "enum_values": ["confirmed", "pending", "cancelled"]}
      ]
    },
    {
      "name": "plans",
      "columns": [
        {"name": "name", "type": "text"},
        {"name": "tier", "type": "text", "enum_values": ["hot desk", "dedicated desk", "private office"]},
        {"name": "price_monthly", "type": "real"},
        {"name": "features", "type": "json"}
      ]
    },
    {
      "name": "invoices",
      "columns": [
        {"name": "member_id", "type": "integer", "references": "members"},
        {"name": "amount", "type": "real"},
        {"name": "issued_on", "type": "text"},
        {"name": "status", "type": "text", "enum_values": ["paid", "unpaid", "void"]}
      ]
    }
  ]
}
```

Things to notice:

- `members.plan_id` is a FK reference to `plans` — the Plans page can then count members per tier via the join, instead of relying on a free-text `plan_type` column.
- Every status/tier column carries `enum_values` lowercase. Seed CSVs MUST use these exact strings; PlansContent / BillingContent components filter by them.
- `Occupancy Dashboard` doesn't add a new model — it aggregates rows from `bookings` / `resources` / `members` for KPIs.
