"""Unified plan models shared by all app types.

These models define the structure for logic, backend, security, and data plans
used by the Code Focus (TSX) build mode.
Previously duplicated as App*Plan / CodeFocus*Plan with trivial differences.
"""

from typing import Literal, Optional

from pydantic import BaseModel, Field

# =============================================================================
# Logic Plan Models
# =============================================================================


class StatePlan(BaseModel):
    """Plan for a single state variable."""

    name: str = Field(description="Programmatic camelCase name (e.g., 'isContactFormSubmitting').")
    initial_value: str = Field(
        description="Initial value as a JSON literal string (e.g., 'false', '\"\"', '[]', '0')."
    )
    purpose: str = Field(description="What this state variable tracks.")


class LogicPlan(BaseModel):
    """Plan for frontend.logic -- state only.

    Actions and computed values have been removed. Code components handle
    all logic directly via SDK hooks (useModel, useHandler, navigate, toast).
    """

    state_variables: list[StatePlan] = Field(
        default=[], description="State variables needed by the app."
    )


# =============================================================================
# Backend Plan Models
# =============================================================================


class ColumnPlan(BaseModel):
    """Plan for a single column in a backend data model."""

    name: str = Field(
        description="Column name in lowercase_snake_case (e.g., 'first_name', 'due_date')."
    )
    type: Literal["text", "integer", "real", "blob", "json"] = Field(
        default="text",
        description="D1/SQLite column type. Use 'text' for strings and dates (ISO 8601), 'integer' for whole numbers and booleans, 'real' for decimals, 'json' for nested objects/arrays.",
    )
    required: bool = Field(
        default=False,
        description="Whether this column is NOT NULL.",
    )
    is_unique: bool = Field(
        default=False,
        description="Whether this column has a UNIQUE constraint (e.g., email, slug).",
    )
    default_value: Optional[str] = Field(
        default=None,
        description="Default value as a string literal (e.g., '0', 'active', 'false'). Must match the column type.",
    )
    references: Optional[str] = Field(
        default=None,
        description="Foreign key: name of the referenced model (e.g., 'projects'). Links to that model's 'id' column with cascade delete.",
    )
    enum_values: Optional[list[str]] = Field(
        default=None,
        description=(
            "Closed vocabulary of allowed values for text columns that represent a "
            "status, priority, tier, category, stage, or state. When set, seed data "
            "MUST use exactly these values and frontend components MUST render every "
            "value explicitly. All values lowercase, e.g. "
            "['draft','pending approval','in review','finalized']. Leave null for "
            "free-text columns."
        ),
    )


class ModelPlan(BaseModel):
    """Plan for a single backend data model."""

    name: str = Field(
        description="SQL table name in lowercase_snake_case (e.g., 'contact_submissions')."
    )
    columns: list[ColumnPlan] = Field(
        description="Columns for this table. System columns (id, owner_id, created_at, updated_at) are added automatically — do not include them."
    )
    owner_scope: Literal["user", "shared"] = Field(
        default="user",
        description="'user' = each user sees own data, 'shared' = all users see all data.",
    )
    seed_hint: str = Field(
        default="",
        description="Hint for generating realistic sample data (e.g., 'Include 5-10 products with realistic prices and categories').",
    )


class HandlerPlan(BaseModel):
    """Plan for a single backend handler."""

    name: str = Field(
        description=(
            "Handler name in camelCase matching the action name " "(e.g., 'submitContactForm')."
        )
    )
    auth_level: str = Field(
        default="authenticated",
        description=(
            "AccessLevel required to call this handler: "
            "'public', 'authenticated', or 'role:X' (e.g., 'role:admin', 'role:editor')."
        ),
    )
    handler_type: Literal["read", "write"] = Field(
        default="write", description="Whether the handler reads or writes data."
    )
    inputs: list[str] = Field(
        description="Input parameter descriptions (e.g., 'name: text, required')."
    )
    outputs: list[str] = Field(description="Output field descriptions (e.g., 'success: boolean').")
    logic: list[str] = Field(default=[], description="Handler logic steps in plain English.")


class StaticDatasetPlan(BaseModel):
    """Plan for a static dataset (hardcoded display data, not backed by a D1 model)."""

    name: str = Field(description="Dataset name (e.g., 'pricing_tiers', 'feature_list').")
    schema_fields: list[str] = Field(
        default=[],
        description="Field descriptions for the dataset items (e.g., 'name: text', 'price: number').",
    )
    generation_hint: str = Field(
        default="", description="Hint for generating realistic sample data."
    )


class StoragePlan(BaseModel):
    """Plan for file storage configuration."""

    enabled: bool = Field(
        default=False,
        description="Whether the app needs file storage for user-uploaded content.",
    )
    allowed_mime_types: list[str] = Field(
        default_factory=lambda: ["image/*", "application/pdf"],
        description=(
            "MIME types users can upload. Use wildcards: 'image/*' for all images, "
            "'application/pdf' for PDFs, 'text/*' for text files. "
            "Choose based on app needs: photo gallery → ['image/*'], "
            "document manager → ['image/*', 'application/pdf', 'text/*'], "
            "general file sharing → ['image/*', 'application/pdf', 'text/*', 'application/zip']."
        ),
    )
    max_file_size_mb: int = Field(
        default=10,
        description=(
            "Maximum file size in MB. Default 10. "
            "Use 5 for avatars/thumbnails, 10 for general uploads, "
            "25 for documents, 50 for media files."
        ),
    )
    public_access: bool = Field(
        default=False,
        description=(
            "Whether files are publicly accessible without login. "
            "True for public portfolios, galleries, shared media. "
            "False for private documents, internal tools, authenticated apps."
        ),
    )


class BackendPlan(BaseModel):
    """Plan for backend config -- models, handlers, static datasets, and storage."""

    backend_type: Literal["none", "static", "dynamic"] = Field(
        default="none",
        description=(
            "Backend mode matching the runtime's BackendProps discriminant. "
            "'none'    — Frontend-only app, no backend at all (pure landing pages, portfolios). "
            "'static'  — Self-contained inline datasets for display data (pricing tiers, feature lists) but no D1 tables. "
            "'dynamic' — Full D1 backend with models, handlers, and CRUD. "
            "Use 'none' for content-only sites and sites with only data-collection forms "
            "(contact, feedback, survey) -- these use built-in form storage. "
            "Use 'dynamic' for apps that manage user-created content or data entities "
            "(notes, tasks, documents, bookings, products, inventory, messages) "
            "or custom business logic. "
            "NEVER rely on localStorage/$persist for primary data storage of user content "
            "-- always use 'dynamic' with backend models."
        ),
    )
    models: list[ModelPlan] = Field(default=[], description="Data models (D1 tables) needed.")
    handlers: list[HandlerPlan] = Field(default=[], description="Custom API handlers needed.")
    static_datasets: list[StaticDatasetPlan] = Field(
        default=[],
        description="Static datasets for hardcoded display data (pricing tiers, feature lists, option labels). Seed data for D1 models is configured via ModelPlan.seed_hint instead.",
    )
    storage: StoragePlan = Field(
        default_factory=StoragePlan,
        description=(
            "File storage configuration. Set storage.enabled=true when the app "
            "involves user-uploaded files: profile pictures, document uploads, "
            "photo galleries, file attachments, receipts, or any user-uploaded content. "
            "The platform provisions R2 storage and provides useFileUpload() SDK hook. "
            "Do NOT create models for file metadata — the platform manages a _files system table. "
            "Storage is independent of backend_type — a 'none' app can still have storage."
        ),
    )


# =============================================================================
# Security Plan Model
# =============================================================================


class SecurityPlan(BaseModel):
    """Plan for authentication and authorization configuration."""

    needs_auth: bool = Field(
        default=False,
        description=(
            "Whether the app needs authentication. Set true when: "
            "login/signup/roles/admin/permissions are mentioned, "
            "user-scoped dataapps, or any page requires access control."
        ),
    )
    auth_providers: list[str] = Field(
        default=["email"],
        description="Authentication providers to enable: 'email', 'google', 'exepad'.",
    )
    roles: list[str] = Field(
        default=[],
        description=(
            "Role names if role-based access is needed " "(e.g., ['admin', 'editor', 'viewer'])."
        ),
    )
    role_hierarchy: dict[str, list[str]] = Field(
        default={},
        description=(
            "Parent-to-children role mapping "
            "(e.g., {'admin': ['editor'], 'editor': ['viewer']})."
        ),
    )
    default_role: str = Field(
        default="",
        description="Role assigned to new users on signup. Must be in roles[].",
    )
    default_access: str = Field(
        default="authenticated",
        description=(
            "Default AccessLevel for pages without explicit access. "
            "One of: 'public', 'authenticated', 'role:X'. Cannot be 'owner' or 'none'."
        ),
    )
    page_access: dict[str, str] = Field(
        default={},
        description=(
            "Per-page access overrides as {slug: AccessLevel} "
            "(e.g., {'/admin': 'role:admin', '/': 'public'})."
        ),
    )
    allow_signup: bool = Field(
        default=True,
        description="Whether to allow self-registration.",
    )
    scaffold_layout: Optional[str] = Field(
        default="centered",
        description="Auth page layout: 'centered', 'split', or 'fullscreen'.",
    )
