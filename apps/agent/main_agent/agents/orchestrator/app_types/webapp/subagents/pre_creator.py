"""
PreCreator Agent — lightweight app type classifier.

Runs before the Creator agent to determine app_secondary_type from the user's
description. This classification drives conditional loading of the correct
app type documentation into the Creator's instruction context.
"""

from __future__ import annotations

from typing import Literal

from google.adk.agents import LlmAgent
from google.adk.agents.readonly_context import ReadonlyContext
from google.adk.planners import BuiltInPlanner
from google.genai import types
from pydantic import BaseModel, Field

from config import AgentName, get_agent_model
from main_agent.agents.utils.agent_docs_loader import InstructionBuilder


class PreCreatorInput(BaseModel):
    """Input for the PreCreatorAgent."""

    app_name: str = Field(description="The name of the app.")
    app_description: str = Field(
        description="The user's description of what app they want to build."
    )
    app_language_code: str = Field(
        default="en",
        description="The requested language code. If 'auto', detect from app_description.",
    )
    creation_source: str = Field(
        default="",
        description=(
            "Slug of the landing page the user arrived from, e.g. "
            "'convert-excel-to-crm' or 'convert-pdf-to-website'. Empty string "
            "when the app was not created from an onboarding landing page. "
            "Treat as a soft tie-breaker for classification; the prompt text "
            "is always authoritative."
        ),
    )
    bundle_domain_hints: str = Field(
        default="",
        description=(
            "Digest of a user-uploaded design bundle (Stitch/Claude Design) "
            "that was imported before this turn. Concatenated brand name, page slugs, "
            "nav labels, headlines, image alts, and body sample — authored by a human "
            "designer. TRUST THIS OVER app_name when both conflict: the bundle is "
            "direct evidence of what the user wants built. Empty when no bundle was "
            "uploaded."
        ),
    )
    bundle_page_slugs: list[str] = Field(
        default_factory=list,
        description=(
            "Canonical page slugs present in the uploaded design bundle. Empty when "
            "no bundle was uploaded. Purely informational for PreCreator; the Creator "
            "uses this to enforce a strict page set."
        ),
    )


class PreCreatorOutput(BaseModel):
    """Output containing the classified app type and language."""

    app_secondary_type: Literal["website", "form", "dataapp", "custom"] = Field(
        description=(
            "The classified app type: 'website' for content/marketing sites "
            "(including sites that contain a lead-gen, contact, or booking form), "
            "'form' for standalone form/survey/quiz apps, 'dataapp' for data-heavy "
            "dashboards that MANAGE records across time, or 'custom' for other app types."
        )
    )
    app_language_code: str = Field(
        default="en",
        description="The resolved language code in ISO 639-1 format.",
    )
    user_language_code: str = Field(
        default="en",
        description="The language the user wrote in, in ISO 639-1 format.",
    )
    reasoning: str = Field(description="Brief explanation of why this app type was chosen.")
    branch_label: Literal["proceed", "decline"] = Field(
        default="proceed",
        description=(
            "'proceed' to build the app; 'decline' if the request is a meta-request "
            "about Exepad's internals OR asks for unsafe/disallowed content "
            "(adult, hateful, harmful, fake/misleading, spam). See the safety rules "
            "loaded into the system instruction."
        ),
    )
    decline_category: Literal[
        "none", "meta", "adult", "hateful", "harmful", "fake_misleading", "spam"
    ] = Field(
        default="none",
        description=(
            "If branch_label='decline': which category triggered the refusal. "
            "'none' when proceeding (Vertex JSON-Schema disallows empty-string enum values)."
        ),
    )
    decline_reason: str = Field(
        default="",
        description=(
            "If branch_label='decline': a short product-level message shown to the user. "
            "Must not name any internal agent, workflow, or component, and must not "
            "produce any of the disallowed content."
        ),
    )


PRE_CREATOR_INSTRUCTION = """\
You are an app type classifier for the Exepad platform.

## Refusal cases (read first)

Before classifying, check the shared safety rules loaded after this prompt
(`# Safety — Refusal Rules`). If the request matches a refusal category there
(meta-request about Exepad's internals, or unsafe/disallowed content), set
`branch_label="decline"`, fill `decline_category` with the matching value
(`meta` / `adult` / `hateful` / `harmful` / `fake_misleading` / `spam`), and
write `decline_reason` per the guidance in § 4. Do NOT proceed with
`app_secondary_type` classification in that case — populate
`app_secondary_type` with your best guess (it will be ignored), and put the
real reasoning in `reasoning`.

When proceeding normally (not declining), set `branch_label="proceed"` and
`decline_category="none"`, and leave `decline_reason` empty.

Given an app name, user description, and (optionally) a digest of an
uploaded design bundle, determine the app type.

## Signal priority (authoritative order)

1. **`bundle_domain_hints`** (when non-empty) — this is the direct evidence
   from a human-authored design bundle (Stitch / Claude Design).
   The headlines, nav labels, and image alts describe the domain the user
   actually designed. **Trust this above `app_name`.** A name like
   "HappyDoods" could plausibly mean either a pet brand or a chicken farm;
   a bundle whose headlines say "The Soul of the Homestead" / "Latest
   Products: Pasture-Raised Heirloom Eggs" makes it an organic chicken
   farm — classify accordingly (typically "website"), and report the
   specific domain in `reasoning` so downstream agents see what you saw.
2. **`app_description`** (prompt text) — authoritative for classification
   when the bundle digest is silent or when the prompt explicitly
   overrides the bundle ("Use this design but make it into an admin
   dashboard").
3. **`app_name`** — weakest signal. Never classify the app from the name
   alone when a bundle or description exists. Name-based puns are the
   kind of heuristic that made the old pipeline classify "HappyDoods" as
   a pet-accessories brand.
4. **`creation_source`** — softest tie-breaker (see "Landing-page hint"
   below).

When the bundle digest is present, the domain narrative it implies should
flow into the `reasoning` field verbatim so the downstream Creator / backend
builder don't have to re-derive it from the same artifacts.

## Classification Rules

- Content sites, marketing pages, portfolios, blogs, landing pages, \
company websites, personal sites, restaurant/hotel/salon sites → "website"
- Forms, surveys, quizzes, registrations, applications, sign-up flows, \
multi-step wizards, intake forms, feedback forms → "form"
- Dashboards, admin panels, CRUD apps, inventory management, CRM, ERP, \
data management, analytics tools, project trackers, booking systems, \
any *management system* (scholarship, employee, order, asset, patient, etc.) → "dataapp"
- Apps that don't fit the above categories (games, interactive tools, \
calculators, visualizers, unique experiences) → "custom"
- If unclear, default to "website"

## Disambiguation — website vs dataapp

A "booking system" is NOT the same as "a booking form on a website".
Classify as "website" (not "dataapp") when the brief describes a public,
content-first site that happens to include a lead-gen/contact/booking form:

- "Build a website for a dog walking service with pricing tiers and booking form" → website
- "Build a salon landing page with contact form and appointment request" → website
- "Build a consulting site with service pages and a lead form" → website
- "Build a restaurant site with a reservation form" → website

Classify as "dataapp" ONLY when the brief requires MANAGEMENT of records:
create/edit/delete many bookings, assign staff, track status across time,
roles, admin dashboards, reports.

- "Build a booking management system where staff can view/edit appointments" → dataapp
- "Build an admin dashboard for managing walker assignments" → dataapp
- "Build a CRM to track leads and sales pipeline" → dataapp

Signal weights (tie-breakers):
- If the user explicitly says "website", "landing page", "marketing site", \
"homepage", or "public site" → strongly prefer "website".
- If the user says "dashboard", "admin", "manage", "CRUD", or "track" → prefer "dataapp".
- A single form on an otherwise content-heavy site is a website signal, \
not a data-app signal.

## Landing-page hint (`creation_source`)

`creation_source` is the slug of the onboarding landing page the user arrived
from. Use it only as a soft tie-breaker when the `app_description` is
ambiguous or sparse. Prompt text always wins over slug.

Slug → nudge map (read as a substring match on the lowercased slug):

- contains "dashboard", "crm", "erp", "management", "admin", "inventory", \
"tracker", or "analytics" → nudge "dataapp"
- contains "form", "survey", "quiz", "registration", or "intake" → nudge "form"
- contains "website", "landing", "homepage", "marketing", or "portfolio" \
→ nudge "website"
- empty string, unrecognized shape, or contradicts an explicit keyword in \
`app_description` → ignore the slug entirely

Examples:
- app_description "make it nice", creation_source "convert-excel-to-crm" → dataapp
- app_description "a simple product page", creation_source \
"convert-csv-to-dashboard" → website (prompt explicit → slug ignored)
- app_description "", creation_source "" → website (default fallback)

## Language Detection
- `user_language_code`: detect the language the user wrote `app_description` in (ISO 639-1).
- `app_language_code`:
  - If the input `app_language_code` is a valid ISO 639-1 code (not "auto"), keep it as-is.
  - If "auto": set to the same as `user_language_code`.

## Output

Return JSON only — no prose, no markdown. Populate every field.
"""


def pre_creator_instruction_provider(context: ReadonlyContext) -> str:
    """Compose the PreCreator instruction with the shared safety doc."""
    return (
        InstructionBuilder()
        .add(PRE_CREATOR_INSTRUCTION)
        .add_doc("common/docs/00_REFUSAL_RULES.md")
        .build()
    )


pre_creator_agent = LlmAgent(
    name=AgentName.PRE_CREATOR,
    model=get_agent_model(AgentName.PRE_CREATOR),
    description="Classifies app type from user description before planning.",
    instruction=pre_creator_instruction_provider,
    input_schema=PreCreatorInput,
    output_schema=PreCreatorOutput,
    output_key="pre_creator_output",
    planner=BuiltInPlanner(thinking_config=types.ThinkingConfig(thinking_budget=0)),
)
