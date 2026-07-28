"""
D1: Config size reduction benchmark.

Compares scaffold config sizes vs equivalent manual component configs.
Each scaffold config is the compact JSON that the scaffold system accepts;
the manual config is the equivalent hand-written component tree that would
produce similar UI.

All test cases use hardcoded data (no LLM calls).

Asserts that each scaffold config is at least 70% smaller than the manual
equivalent.
"""

import json

import pytest

# ---------------------------------------------------------------------------
# Helper
# ---------------------------------------------------------------------------


def _byte_size(obj: dict) -> int:
    """Return the byte size of a JSON-serialized object."""
    return len(json.dumps(obj, separators=(",", ":")))


def _reduction_pct(scaffold: dict, manual: dict) -> float:
    """Return the percentage reduction: 1 - (scaffold / manual)."""
    s = _byte_size(scaffold)
    m = _byte_size(manual)
    if m == 0:
        return 0.0
    return 1.0 - (s / m)


# ===========================================================================
# 1. CRUD table with 5 columns
# ===========================================================================

CRUD_TABLE_SCAFFOLD = {
    "uuid": "scaffold_abc1",
    "componentType": "CrudScaffoldProps",
    "model": "products",
    "title": "Products",
    "layout": "table",
    "features": {"create": True, "edit": True, "delete": True},
    "table": {
        "columns": ["name", "sku", "price", "category", "status"],
        "searchable": True,
        "pageSize": 25,
    },
}

CRUD_TABLE_MANUAL = {
    "uuid": "page-products",
    "pageType": "WebPageProps",
    "title": "Products",
    "slug": "/products",
    "content": [
        {
            "uuid": "products-header",
            "componentType": "FlexProps",
            "direction": "row",
            "justify": "between",
            "align": "center",
            "classes": "mb-6",
            "content": [
                {
                    "uuid": "products-title",
                    "componentType": "TextProps",
                    "content": "Products",
                    "classes": "text-2xl font-bold",
                },
                {
                    "uuid": "products-add-btn",
                    "componentType": "ButtonProps",
                    "text": "Add Product",
                    "icon": {"uuid": "icon-plus", "componentType": "IconProps", "name": "Plus"},
                    "action": {"action": "openCreateModal"},
                },
            ],
        },
        {
            "uuid": "products-search",
            "componentType": "TextFieldProps",
            "label": "Search products...",
            "bindTo": "searchQuery",
            "classes": "mb-4",
        },
        {
            "uuid": "products-table",
            "componentType": "DataTableProps",
            "data": "model.products",
            "searchable": True,
            "sortable": True,
            "pagination": True,
            "pageSize": 25,
            "columns": [
                {"key": "name", "label": "Name", "sortable": True},
                {"key": "sku", "label": "SKU", "sortable": True},
                {"key": "price", "label": "Price", "sortable": True, "format": "currency"},
                {"key": "category", "label": "Category", "sortable": True},
                {"key": "status", "label": "Status", "sortable": True},
            ],
            "actions": [
                {"label": "Edit", "action": {"action": "openEditModal", "payload": "$row"}},
                {"label": "Delete", "action": {"action": "openDeleteDialog", "payload": "$row"}},
            ],
        },
        {
            "uuid": "create-modal",
            "componentType": "ModalProps",
            "title": "Add Product",
            "open": "$createModalOpen",
            "onClose": "closeCreateModal",
            "size": "md",
            "content": [
                {
                    "uuid": "create-name",
                    "componentType": "TextFieldProps",
                    "label": "Name",
                    "bindTo": "createForm.name",
                },
                {
                    "uuid": "create-sku",
                    "componentType": "TextFieldProps",
                    "label": "SKU",
                    "bindTo": "createForm.sku",
                },
                {
                    "uuid": "create-price",
                    "componentType": "TextFieldProps",
                    "label": "Price",
                    "bindTo": "createForm.price",
                    "type": "number",
                },
                {
                    "uuid": "create-category",
                    "componentType": "TextFieldProps",
                    "label": "Category",
                    "bindTo": "createForm.category",
                },
                {
                    "uuid": "create-status",
                    "componentType": "TextFieldProps",
                    "label": "Status",
                    "bindTo": "createForm.status",
                },
            ],
            "footer": [
                {
                    "uuid": "create-cancel",
                    "componentType": "ButtonProps",
                    "text": "Cancel",
                    "variant": "outline",
                    "action": "closeCreateModal",
                },
                {
                    "uuid": "create-submit",
                    "componentType": "ButtonProps",
                    "text": "Create",
                    "action": "submitCreate",
                },
            ],
        },
        {
            "uuid": "edit-modal",
            "componentType": "ModalProps",
            "title": "Edit Product",
            "open": "$editModalOpen",
            "onClose": "closeEditModal",
            "size": "md",
            "content": [
                {
                    "uuid": "edit-name",
                    "componentType": "TextFieldProps",
                    "label": "Name",
                    "bindTo": "editForm.name",
                },
                {
                    "uuid": "edit-sku",
                    "componentType": "TextFieldProps",
                    "label": "SKU",
                    "bindTo": "editForm.sku",
                },
                {
                    "uuid": "edit-price",
                    "componentType": "TextFieldProps",
                    "label": "Price",
                    "bindTo": "editForm.price",
                    "type": "number",
                },
                {
                    "uuid": "edit-category",
                    "componentType": "TextFieldProps",
                    "label": "Category",
                    "bindTo": "editForm.category",
                },
                {
                    "uuid": "edit-status",
                    "componentType": "TextFieldProps",
                    "label": "Status",
                    "bindTo": "editForm.status",
                },
            ],
            "footer": [
                {
                    "uuid": "edit-cancel",
                    "componentType": "ButtonProps",
                    "text": "Cancel",
                    "variant": "outline",
                    "action": "closeEditModal",
                },
                {
                    "uuid": "edit-submit",
                    "componentType": "ButtonProps",
                    "text": "Save",
                    "action": "submitEdit",
                },
            ],
        },
        {
            "uuid": "delete-dialog",
            "componentType": "ModalProps",
            "title": "Delete Product",
            "open": "$deleteDialogOpen",
            "onClose": "closeDeleteDialog",
            "size": "sm",
            "content": [
                {
                    "uuid": "delete-msg",
                    "componentType": "TextProps",
                    "content": "Are you sure you want to delete this product?",
                },
            ],
            "footer": [
                {
                    "uuid": "delete-cancel",
                    "componentType": "ButtonProps",
                    "text": "Cancel",
                    "variant": "outline",
                    "action": "closeDeleteDialog",
                },
                {
                    "uuid": "delete-confirm",
                    "componentType": "ButtonProps",
                    "text": "Delete",
                    "variant": "destructive",
                    "action": "confirmDelete",
                },
            ],
        },
    ],
    "state": {
        "searchQuery": "",
        "createModalOpen": False,
        "editModalOpen": False,
        "deleteDialogOpen": False,
        "selectedItem": None,
        "createForm": {"name": "", "sku": "", "price": 0, "category": "", "status": ""},
        "editForm": {"name": "", "sku": "", "price": 0, "category": "", "status": ""},
    },
    "actions": {
        "openCreateModal": [{"set": "createModalOpen", "to": True}],
        "closeCreateModal": [{"set": "createModalOpen", "to": False}],
        "openEditModal": [
            {"set": "editModalOpen", "to": True},
            {"set": "editForm", "to": "$payload"},
        ],
        "closeEditModal": [{"set": "editModalOpen", "to": False}],
        "openDeleteDialog": [
            {"set": "deleteDialogOpen", "to": True},
            {"set": "selectedItem", "to": "$payload"},
        ],
        "closeDeleteDialog": [{"set": "deleteDialogOpen", "to": False}],
        "submitCreate": [
            {"api": "sys_create", "model": "products", "data": "$createForm"},
            {"set": "createModalOpen", "to": False},
        ],
        "submitEdit": [
            {"api": "sys_update", "model": "products", "data": "$editForm"},
            {"set": "editModalOpen", "to": False},
        ],
        "confirmDelete": [
            {"api": "sys_delete", "model": "products", "id": "$selectedItem.id"},
            {"set": "deleteDialogOpen", "to": False},
        ],
    },
}


# ===========================================================================
# 2. CRUD grid with cards
# ===========================================================================

CRUD_GRID_SCAFFOLD = {
    "uuid": "scaffold_abc2",
    "componentType": "CrudScaffoldProps",
    "model": "listings",
    "title": "Listings",
    "layout": "grid",
    "card": {"image": "photo", "title": "name", "subtitle": "location", "badge": "status"},
    "features": {"create": True, "edit": True, "delete": True},
}

CRUD_GRID_MANUAL = {
    "uuid": "page-listings",
    "pageType": "WebPageProps",
    "title": "Listings",
    "slug": "/listings",
    "content": [
        {
            "uuid": "listings-header",
            "componentType": "FlexProps",
            "direction": "row",
            "justify": "between",
            "align": "center",
            "classes": "mb-6",
            "content": [
                {
                    "uuid": "listings-title",
                    "componentType": "TextProps",
                    "content": "Listings",
                    "classes": "text-2xl font-bold",
                },
                {
                    "uuid": "listings-add-btn",
                    "componentType": "ButtonProps",
                    "text": "Add Listing",
                    "action": {"action": "openCreateModal"},
                },
            ],
        },
        {
            "uuid": "listings-search",
            "componentType": "TextFieldProps",
            "label": "Search listings...",
            "bindTo": "searchQuery",
            "classes": "mb-4",
        },
        {
            "uuid": "listings-grid",
            "componentType": "GridProps",
            "columns": 3,
            "gap": "md",
            "content": [
                {
                    "uuid": "listing-card-template",
                    "componentType": "CardProps",
                    "loopData": "model.listings",
                    "loopVariable": "item",
                    "content": [
                        {
                            "uuid": "card-image",
                            "componentType": "ImageProps",
                            "src": "$item.photo",
                            "alt": "$item.name",
                            "classes": "w-full h-48 object-cover",
                        },
                        {
                            "uuid": "card-body",
                            "componentType": "FlexProps",
                            "direction": "column",
                            "classes": "p-4",
                            "content": [
                                {
                                    "uuid": "card-title",
                                    "componentType": "TextProps",
                                    "content": "$item.name",
                                    "classes": "font-semibold text-lg",
                                },
                                {
                                    "uuid": "card-subtitle",
                                    "componentType": "TextProps",
                                    "content": "$item.location",
                                    "classes": "text-muted-foreground text-sm",
                                },
                                {
                                    "uuid": "card-badge",
                                    "componentType": "BadgeProps",
                                    "text": "$item.status",
                                },
                            ],
                        },
                        {
                            "uuid": "card-actions",
                            "componentType": "FlexProps",
                            "direction": "row",
                            "gap": "sm",
                            "classes": "p-4 pt-0",
                            "content": [
                                {
                                    "uuid": "card-edit",
                                    "componentType": "ButtonProps",
                                    "text": "Edit",
                                    "variant": "outline",
                                    "size": "sm",
                                    "action": {"action": "openEditModal", "payload": "$item"},
                                },
                                {
                                    "uuid": "card-delete",
                                    "componentType": "ButtonProps",
                                    "text": "Delete",
                                    "variant": "destructive",
                                    "size": "sm",
                                    "action": {"action": "openDeleteDialog", "payload": "$item"},
                                },
                            ],
                        },
                    ],
                },
            ],
        },
        {
            "uuid": "create-modal-grid",
            "componentType": "ModalProps",
            "title": "Add Listing",
            "open": "$createModalOpen",
            "onClose": "closeCreateModal",
            "size": "md",
            "content": [
                {
                    "uuid": "g-create-name",
                    "componentType": "TextFieldProps",
                    "label": "Name",
                    "bindTo": "createForm.name",
                },
                {
                    "uuid": "g-create-location",
                    "componentType": "TextFieldProps",
                    "label": "Location",
                    "bindTo": "createForm.location",
                },
                {
                    "uuid": "g-create-photo",
                    "componentType": "TextFieldProps",
                    "label": "Photo URL",
                    "bindTo": "createForm.photo",
                },
                {
                    "uuid": "g-create-status",
                    "componentType": "TextFieldProps",
                    "label": "Status",
                    "bindTo": "createForm.status",
                },
            ],
            "footer": [
                {
                    "uuid": "g-create-cancel",
                    "componentType": "ButtonProps",
                    "text": "Cancel",
                    "variant": "outline",
                    "action": "closeCreateModal",
                },
                {
                    "uuid": "g-create-submit",
                    "componentType": "ButtonProps",
                    "text": "Create",
                    "action": "submitCreate",
                },
            ],
        },
        {
            "uuid": "edit-modal-grid",
            "componentType": "ModalProps",
            "title": "Edit Listing",
            "open": "$editModalOpen",
            "onClose": "closeEditModal",
            "size": "md",
            "content": [
                {
                    "uuid": "g-edit-name",
                    "componentType": "TextFieldProps",
                    "label": "Name",
                    "bindTo": "editForm.name",
                },
                {
                    "uuid": "g-edit-location",
                    "componentType": "TextFieldProps",
                    "label": "Location",
                    "bindTo": "editForm.location",
                },
                {
                    "uuid": "g-edit-photo",
                    "componentType": "TextFieldProps",
                    "label": "Photo URL",
                    "bindTo": "editForm.photo",
                },
                {
                    "uuid": "g-edit-status",
                    "componentType": "TextFieldProps",
                    "label": "Status",
                    "bindTo": "editForm.status",
                },
            ],
            "footer": [
                {
                    "uuid": "g-edit-cancel",
                    "componentType": "ButtonProps",
                    "text": "Cancel",
                    "variant": "outline",
                    "action": "closeEditModal",
                },
                {
                    "uuid": "g-edit-submit",
                    "componentType": "ButtonProps",
                    "text": "Save",
                    "action": "submitEdit",
                },
            ],
        },
        {
            "uuid": "delete-dialog-grid",
            "componentType": "ModalProps",
            "title": "Delete Listing",
            "open": "$deleteDialogOpen",
            "onClose": "closeDeleteDialog",
            "size": "sm",
            "content": [
                {
                    "uuid": "g-delete-msg",
                    "componentType": "TextProps",
                    "content": "Are you sure you want to delete this listing?",
                },
            ],
            "footer": [
                {
                    "uuid": "g-delete-cancel",
                    "componentType": "ButtonProps",
                    "text": "Cancel",
                    "variant": "outline",
                    "action": "closeDeleteDialog",
                },
                {
                    "uuid": "g-delete-confirm",
                    "componentType": "ButtonProps",
                    "text": "Delete",
                    "variant": "destructive",
                    "action": "confirmDelete",
                },
            ],
        },
    ],
    "state": {
        "searchQuery": "",
        "createModalOpen": False,
        "editModalOpen": False,
        "deleteDialogOpen": False,
        "selectedItem": None,
        "createForm": {"name": "", "location": "", "photo": "", "status": ""},
        "editForm": {"name": "", "location": "", "photo": "", "status": ""},
    },
    "actions": {
        "openCreateModal": [{"set": "createModalOpen", "to": True}],
        "closeCreateModal": [{"set": "createModalOpen", "to": False}],
        "openEditModal": [
            {"set": "editModalOpen", "to": True},
            {"set": "editForm", "to": "$payload"},
        ],
        "closeEditModal": [{"set": "editModalOpen", "to": False}],
        "openDeleteDialog": [
            {"set": "deleteDialogOpen", "to": True},
            {"set": "selectedItem", "to": "$payload"},
        ],
        "closeDeleteDialog": [{"set": "deleteDialogOpen", "to": False}],
        "submitCreate": [
            {"api": "sys_create", "model": "listings", "data": "$createForm"},
            {"set": "createModalOpen", "to": False},
        ],
        "submitEdit": [
            {"api": "sys_update", "model": "listings", "data": "$editForm"},
            {"set": "editModalOpen", "to": False},
        ],
        "confirmDelete": [
            {"api": "sys_delete", "model": "listings", "id": "$selectedItem.id"},
            {"set": "deleteDialogOpen", "to": False},
        ],
    },
}


# ===========================================================================
# 3. CRUD master-detail
# ===========================================================================

CRUD_MASTER_DETAIL_SCAFFOLD = {
    "uuid": "scaffold_abc3",
    "componentType": "CrudScaffoldProps",
    "model": "tickets",
    "title": "Support Tickets",
    "layout": "masterDetail",
    "card": {"title": "subject", "subtitle": "requester", "badge": "priority"},
    "features": {"create": True, "edit": True, "delete": True},
}

CRUD_MASTER_DETAIL_MANUAL = {
    "uuid": "page-tickets",
    "pageType": "WebPageProps",
    "title": "Support Tickets",
    "slug": "/tickets",
    "content": [
        {
            "uuid": "tickets-header",
            "componentType": "FlexProps",
            "direction": "row",
            "justify": "between",
            "align": "center",
            "classes": "mb-6",
            "content": [
                {
                    "uuid": "tickets-title",
                    "componentType": "TextProps",
                    "content": "Support Tickets",
                    "classes": "text-2xl font-bold",
                },
                {
                    "uuid": "tickets-add",
                    "componentType": "ButtonProps",
                    "text": "New Ticket",
                    "action": {"action": "openCreateModal"},
                },
            ],
        },
        {
            "uuid": "tickets-split",
            "componentType": "FlexProps",
            "direction": "row",
            "gap": "md",
            "classes": "h-[calc(100vh-200px)]",
            "content": [
                {
                    "uuid": "tickets-list-panel",
                    "componentType": "FlexProps",
                    "direction": "column",
                    "classes": "w-1/3 border-r overflow-y-auto",
                    "content": [
                        {
                            "uuid": "tickets-search",
                            "componentType": "TextFieldProps",
                            "label": "Search...",
                            "bindTo": "searchQuery",
                            "classes": "p-2",
                        },
                        {
                            "uuid": "ticket-list-card",
                            "componentType": "CardProps",
                            "loopData": "model.tickets",
                            "loopVariable": "item",
                            "classes": "cursor-pointer hover:bg-accent m-2 p-3",
                            "action": {"action": "selectItem", "payload": "$item"},
                            "content": [
                                {
                                    "uuid": "tl-title",
                                    "componentType": "TextProps",
                                    "content": "$item.subject",
                                    "classes": "font-medium",
                                },
                                {
                                    "uuid": "tl-subtitle",
                                    "componentType": "TextProps",
                                    "content": "$item.requester",
                                    "classes": "text-sm text-muted-foreground",
                                },
                                {
                                    "uuid": "tl-badge",
                                    "componentType": "BadgeProps",
                                    "text": "$item.priority",
                                },
                            ],
                        },
                    ],
                },
                {
                    "uuid": "tickets-detail-panel",
                    "componentType": "FlexProps",
                    "direction": "column",
                    "classes": "w-2/3 p-4",
                    "showWhen": "$selectedItem",
                    "content": [
                        {
                            "uuid": "td-subject",
                            "componentType": "TextFieldProps",
                            "label": "Subject",
                            "bindTo": "editForm.subject",
                        },
                        {
                            "uuid": "td-requester",
                            "componentType": "TextFieldProps",
                            "label": "Requester",
                            "bindTo": "editForm.requester",
                        },
                        {
                            "uuid": "td-priority",
                            "componentType": "TextFieldProps",
                            "label": "Priority",
                            "bindTo": "editForm.priority",
                        },
                        {
                            "uuid": "td-description",
                            "componentType": "TextAreaProps",
                            "label": "Description",
                            "bindTo": "editForm.description",
                        },
                        {
                            "uuid": "td-actions",
                            "componentType": "FlexProps",
                            "direction": "row",
                            "gap": "sm",
                            "classes": "mt-4",
                            "content": [
                                {
                                    "uuid": "td-save",
                                    "componentType": "ButtonProps",
                                    "text": "Save",
                                    "action": "submitEdit",
                                },
                                {
                                    "uuid": "td-delete",
                                    "componentType": "ButtonProps",
                                    "text": "Delete",
                                    "variant": "destructive",
                                    "action": {
                                        "action": "openDeleteDialog",
                                        "payload": "$selectedItem",
                                    },
                                },
                            ],
                        },
                    ],
                },
                {
                    "uuid": "tickets-empty-detail",
                    "componentType": "FlexProps",
                    "direction": "column",
                    "align": "center",
                    "justify": "center",
                    "classes": "w-2/3 text-muted-foreground",
                    "showWhen": "!$selectedItem",
                    "content": [
                        {
                            "uuid": "empty-msg",
                            "componentType": "TextProps",
                            "content": "Select a ticket to view details",
                        },
                    ],
                },
            ],
        },
        {
            "uuid": "create-modal-md",
            "componentType": "ModalProps",
            "title": "New Ticket",
            "open": "$createModalOpen",
            "onClose": "closeCreateModal",
            "content": [
                {
                    "uuid": "md-create-subject",
                    "componentType": "TextFieldProps",
                    "label": "Subject",
                    "bindTo": "createForm.subject",
                },
                {
                    "uuid": "md-create-requester",
                    "componentType": "TextFieldProps",
                    "label": "Requester",
                    "bindTo": "createForm.requester",
                },
                {
                    "uuid": "md-create-priority",
                    "componentType": "TextFieldProps",
                    "label": "Priority",
                    "bindTo": "createForm.priority",
                },
            ],
            "footer": [
                {
                    "uuid": "md-create-cancel",
                    "componentType": "ButtonProps",
                    "text": "Cancel",
                    "variant": "outline",
                    "action": "closeCreateModal",
                },
                {
                    "uuid": "md-create-submit",
                    "componentType": "ButtonProps",
                    "text": "Create",
                    "action": "submitCreate",
                },
            ],
        },
        {
            "uuid": "delete-dialog-md",
            "componentType": "ModalProps",
            "title": "Delete Ticket",
            "open": "$deleteDialogOpen",
            "onClose": "closeDeleteDialog",
            "size": "sm",
            "content": [
                {
                    "uuid": "md-del-msg",
                    "componentType": "TextProps",
                    "content": "Are you sure you want to delete this ticket?",
                },
            ],
            "footer": [
                {
                    "uuid": "md-del-cancel",
                    "componentType": "ButtonProps",
                    "text": "Cancel",
                    "variant": "outline",
                    "action": "closeDeleteDialog",
                },
                {
                    "uuid": "md-del-confirm",
                    "componentType": "ButtonProps",
                    "text": "Delete",
                    "variant": "destructive",
                    "action": "confirmDelete",
                },
            ],
        },
    ],
    "state": {
        "searchQuery": "",
        "selectedItem": None,
        "createModalOpen": False,
        "deleteDialogOpen": False,
        "createForm": {"subject": "", "requester": "", "priority": ""},
        "editForm": {"subject": "", "requester": "", "priority": "", "description": ""},
    },
    "actions": {
        "selectItem": [
            {"set": "selectedItem", "to": "$payload"},
            {"set": "editForm", "to": "$payload"},
        ],
        "openCreateModal": [{"set": "createModalOpen", "to": True}],
        "closeCreateModal": [{"set": "createModalOpen", "to": False}],
        "openDeleteDialog": [{"set": "deleteDialogOpen", "to": True}],
        "closeDeleteDialog": [{"set": "deleteDialogOpen", "to": False}],
        "submitCreate": [
            {"api": "sys_create", "model": "tickets", "data": "$createForm"},
            {"set": "createModalOpen", "to": False},
        ],
        "submitEdit": [{"api": "sys_update", "model": "tickets", "data": "$editForm"}],
        "confirmDelete": [
            {"api": "sys_delete", "model": "tickets", "id": "$selectedItem.id"},
            {"set": "deleteDialogOpen", "to": False},
        ],
    },
}


# ===========================================================================
# 4. Dashboard with 4 stats + 2 charts
# ===========================================================================

DASHBOARD_SCAFFOLD = {
    "uuid": "scaffold_abc4",
    "componentType": "DashboardScaffoldProps",
    "title": "Sales Dashboard",
    "models": {"orders": {"fetchOnLoad": True}, "products": {"fetchOnLoad": True}},
    "stats": [
        {
            "label": "Total Orders",
            "value": {"fn": "count", "model": "orders"},
            "icon": "ShoppingCart",
        },
        {
            "label": "Revenue",
            "value": {"fn": "sum", "model": "orders", "of": "total"},
            "format": "currency",
            "icon": "DollarSign",
        },
        {"label": "Products", "value": {"fn": "count", "model": "products"}, "icon": "Package"},
        {
            "label": "Avg Order",
            "value": {"fn": "avg", "model": "orders", "of": "total"},
            "format": "currency",
            "icon": "TrendingUp",
        },
    ],
    "charts": [
        {
            "title": "Revenue Trend",
            "type": "line",
            "model": "orders",
            "groupBy": "created_at",
            "yAxis": {"fn": "sum", "of": "total"},
        },
        {
            "title": "Orders by Status",
            "type": "donut",
            "model": "orders",
            "groupBy": "status",
            "value": {"fn": "count"},
        },
    ],
    "filters": {"dateRange": {"enabled": True, "defaultPeriod": "30d"}},
}

DASHBOARD_MANUAL = {
    "uuid": "page-dashboard",
    "pageType": "WebPageProps",
    "title": "Sales Dashboard",
    "slug": "/dashboard",
    "content": [
        {
            "uuid": "dash-header",
            "componentType": "FlexProps",
            "direction": "row",
            "justify": "between",
            "align": "center",
            "classes": "mb-6",
            "content": [
                {
                    "uuid": "dash-title",
                    "componentType": "TextProps",
                    "content": "Sales Dashboard",
                    "classes": "text-2xl font-bold",
                },
                {
                    "uuid": "dash-date-filter",
                    "componentType": "SelectProps",
                    "label": "Period",
                    "bindTo": "dateRange",
                    "options": [
                        {"label": "7 days", "value": "7d"},
                        {"label": "30 days", "value": "30d"},
                        {"label": "90 days", "value": "90d"},
                    ],
                },
            ],
        },
        {
            "uuid": "dash-stats-grid",
            "componentType": "GridProps",
            "columns": 4,
            "gap": "md",
            "classes": "mb-6",
            "content": [
                {
                    "uuid": "stat-orders",
                    "componentType": "CardProps",
                    "content": [
                        {
                            "uuid": "stat-orders-body",
                            "componentType": "FlexProps",
                            "direction": "column",
                            "classes": "p-4",
                            "content": [
                                {
                                    "uuid": "stat-orders-icon",
                                    "componentType": "IconProps",
                                    "name": "ShoppingCart",
                                    "classes": "text-muted-foreground mb-2",
                                },
                                {
                                    "uuid": "stat-orders-label",
                                    "componentType": "TextProps",
                                    "content": "Total Orders",
                                    "classes": "text-sm text-muted-foreground",
                                },
                                {
                                    "uuid": "stat-orders-value",
                                    "componentType": "TextProps",
                                    "content": "$computed.totalOrders",
                                    "classes": "text-2xl font-bold",
                                },
                            ],
                        },
                    ],
                },
                {
                    "uuid": "stat-revenue",
                    "componentType": "CardProps",
                    "content": [
                        {
                            "uuid": "stat-revenue-body",
                            "componentType": "FlexProps",
                            "direction": "column",
                            "classes": "p-4",
                            "content": [
                                {
                                    "uuid": "stat-revenue-icon",
                                    "componentType": "IconProps",
                                    "name": "DollarSign",
                                    "classes": "text-muted-foreground mb-2",
                                },
                                {
                                    "uuid": "stat-revenue-label",
                                    "componentType": "TextProps",
                                    "content": "Revenue",
                                    "classes": "text-sm text-muted-foreground",
                                },
                                {
                                    "uuid": "stat-revenue-value",
                                    "componentType": "TextProps",
                                    "content": "$computed.totalRevenue",
                                    "classes": "text-2xl font-bold",
                                },
                            ],
                        },
                    ],
                },
                {
                    "uuid": "stat-products",
                    "componentType": "CardProps",
                    "content": [
                        {
                            "uuid": "stat-products-body",
                            "componentType": "FlexProps",
                            "direction": "column",
                            "classes": "p-4",
                            "content": [
                                {
                                    "uuid": "stat-products-icon",
                                    "componentType": "IconProps",
                                    "name": "Package",
                                    "classes": "text-muted-foreground mb-2",
                                },
                                {
                                    "uuid": "stat-products-label",
                                    "componentType": "TextProps",
                                    "content": "Products",
                                    "classes": "text-sm text-muted-foreground",
                                },
                                {
                                    "uuid": "stat-products-value",
                                    "componentType": "TextProps",
                                    "content": "$computed.totalProducts",
                                    "classes": "text-2xl font-bold",
                                },
                            ],
                        },
                    ],
                },
                {
                    "uuid": "stat-avg-order",
                    "componentType": "CardProps",
                    "content": [
                        {
                            "uuid": "stat-avg-body",
                            "componentType": "FlexProps",
                            "direction": "column",
                            "classes": "p-4",
                            "content": [
                                {
                                    "uuid": "stat-avg-icon",
                                    "componentType": "IconProps",
                                    "name": "TrendingUp",
                                    "classes": "text-muted-foreground mb-2",
                                },
                                {
                                    "uuid": "stat-avg-label",
                                    "componentType": "TextProps",
                                    "content": "Avg Order",
                                    "classes": "text-sm text-muted-foreground",
                                },
                                {
                                    "uuid": "stat-avg-value",
                                    "componentType": "TextProps",
                                    "content": "$computed.avgOrder",
                                    "classes": "text-2xl font-bold",
                                },
                            ],
                        },
                    ],
                },
            ],
        },
        {
            "uuid": "dash-charts-grid",
            "componentType": "GridProps",
            "columns": 2,
            "gap": "md",
            "content": [
                {
                    "uuid": "chart-revenue",
                    "componentType": "CardProps",
                    "content": [
                        {
                            "uuid": "chart-revenue-title",
                            "componentType": "TextProps",
                            "content": "Revenue Trend",
                            "classes": "text-lg font-semibold p-4 pb-0",
                        },
                        {
                            "uuid": "chart-revenue-chart",
                            "componentType": "ChartProps",
                            "type": "line",
                            "data": "handler.ordersByDate",
                            "xKey": "created_at",
                            "yKey": "total",
                            "height": 300,
                        },
                    ],
                },
                {
                    "uuid": "chart-status",
                    "componentType": "CardProps",
                    "content": [
                        {
                            "uuid": "chart-status-title",
                            "componentType": "TextProps",
                            "content": "Orders by Status",
                            "classes": "text-lg font-semibold p-4 pb-0",
                        },
                        {
                            "uuid": "chart-status-chart",
                            "componentType": "ChartProps",
                            "type": "donut",
                            "data": "handler.ordersByStatus",
                            "nameKey": "status",
                            "valueKey": "count",
                            "height": 300,
                        },
                    ],
                },
            ],
        },
    ],
    "state": {
        "dateRange": "30d",
        "isLoading": True,
    },
    "computed": {
        "totalOrders": "count(orders)",
        "totalRevenue": "sum(orders, total)",
        "totalProducts": "count(products)",
        "avgOrder": "avg(orders, total)",
    },
}


# ===========================================================================
# 5. Settings with 3 sections
# ===========================================================================

SETTINGS_SCAFFOLD = {
    "uuid": "scaffold_abc5",
    "componentType": "SettingsScaffoldProps",
    "model": "user_settings",
    "title": "Settings",
    "saveMode": "button",
    "layout": "sidebar",
    "sections": [
        {
            "id": "profile",
            "title": "Profile",
            "icon": "User",
            "fields": ["display_name", "email", "avatar_url"],
        },
        {
            "id": "notifications",
            "title": "Notifications",
            "icon": "Bell",
            "fields": ["email_notifications", "push_notifications", "digest_frequency"],
        },
        {
            "id": "security",
            "title": "Security",
            "icon": "Shield",
            "fields": ["two_factor_enabled", "session_timeout"],
        },
    ],
}

SETTINGS_MANUAL = {
    "uuid": "page-settings",
    "pageType": "WebPageProps",
    "title": "Settings",
    "slug": "/settings",
    "content": [
        {
            "uuid": "settings-header",
            "componentType": "FlexProps",
            "direction": "column",
            "gap": "xs",
            "classes": "mb-6",
            "content": [
                {
                    "uuid": "settings-title",
                    "componentType": "TextProps",
                    "content": "Settings",
                    "classes": "text-2xl font-bold",
                },
            ],
        },
        {
            "uuid": "settings-layout",
            "componentType": "FlexProps",
            "direction": "row",
            "gap": "lg",
            "content": [
                {
                    "uuid": "settings-nav",
                    "componentType": "FlexProps",
                    "direction": "column",
                    "classes": "w-64 shrink-0",
                    "content": [
                        {
                            "uuid": "nav-profile",
                            "componentType": "ButtonProps",
                            "text": "Profile",
                            "variant": "ghost",
                            "icon": {
                                "uuid": "i-user",
                                "componentType": "IconProps",
                                "name": "User",
                            },
                            "action": {"action": "setActiveSection", "payload": "profile"},
                        },
                        {
                            "uuid": "nav-notif",
                            "componentType": "ButtonProps",
                            "text": "Notifications",
                            "variant": "ghost",
                            "icon": {
                                "uuid": "i-bell",
                                "componentType": "IconProps",
                                "name": "Bell",
                            },
                            "action": {"action": "setActiveSection", "payload": "notifications"},
                        },
                        {
                            "uuid": "nav-security",
                            "componentType": "ButtonProps",
                            "text": "Security",
                            "variant": "ghost",
                            "icon": {
                                "uuid": "i-shield",
                                "componentType": "IconProps",
                                "name": "Shield",
                            },
                            "action": {"action": "setActiveSection", "payload": "security"},
                        },
                    ],
                },
                {
                    "uuid": "settings-content",
                    "componentType": "FlexProps",
                    "direction": "column",
                    "classes": "flex-1",
                    "content": [
                        {
                            "uuid": "section-profile",
                            "componentType": "FlexProps",
                            "direction": "column",
                            "gap": "md",
                            "showWhen": "$activeSection === 'profile'",
                            "content": [
                                {
                                    "uuid": "profile-title",
                                    "componentType": "TextProps",
                                    "content": "Profile",
                                    "classes": "text-lg font-semibold",
                                },
                                {
                                    "uuid": "f-display-name",
                                    "componentType": "TextFieldProps",
                                    "label": "Display Name",
                                    "bindTo": "settingsData.display_name",
                                },
                                {
                                    "uuid": "f-email",
                                    "componentType": "TextFieldProps",
                                    "label": "Email",
                                    "bindTo": "settingsData.email",
                                },
                                {
                                    "uuid": "f-avatar",
                                    "componentType": "TextFieldProps",
                                    "label": "Avatar URL",
                                    "bindTo": "settingsData.avatar_url",
                                },
                            ],
                        },
                        {
                            "uuid": "section-notif",
                            "componentType": "FlexProps",
                            "direction": "column",
                            "gap": "md",
                            "showWhen": "$activeSection === 'notifications'",
                            "content": [
                                {
                                    "uuid": "notif-title",
                                    "componentType": "TextProps",
                                    "content": "Notifications",
                                    "classes": "text-lg font-semibold",
                                },
                                {
                                    "uuid": "f-email-notif",
                                    "componentType": "SwitchProps",
                                    "label": "Email Notifications",
                                    "bindTo": "settingsData.email_notifications",
                                },
                                {
                                    "uuid": "f-push-notif",
                                    "componentType": "SwitchProps",
                                    "label": "Push Notifications",
                                    "bindTo": "settingsData.push_notifications",
                                },
                                {
                                    "uuid": "f-digest",
                                    "componentType": "SelectProps",
                                    "label": "Digest Frequency",
                                    "bindTo": "settingsData.digest_frequency",
                                    "options": [
                                        {"label": "Daily", "value": "daily"},
                                        {"label": "Weekly", "value": "weekly"},
                                    ],
                                },
                            ],
                        },
                        {
                            "uuid": "section-security",
                            "componentType": "FlexProps",
                            "direction": "column",
                            "gap": "md",
                            "showWhen": "$activeSection === 'security'",
                            "content": [
                                {
                                    "uuid": "security-title",
                                    "componentType": "TextProps",
                                    "content": "Security",
                                    "classes": "text-lg font-semibold",
                                },
                                {
                                    "uuid": "f-2fa",
                                    "componentType": "SwitchProps",
                                    "label": "Two-Factor Auth",
                                    "bindTo": "settingsData.two_factor_enabled",
                                },
                                {
                                    "uuid": "f-session",
                                    "componentType": "TextFieldProps",
                                    "label": "Session Timeout (min)",
                                    "bindTo": "settingsData.session_timeout",
                                    "type": "number",
                                },
                            ],
                        },
                    ],
                },
            ],
        },
        {
            "uuid": "settings-save-bar",
            "componentType": "FlexProps",
            "direction": "row",
            "justify": "end",
            "gap": "sm",
            "classes": "mt-6 pt-4 border-t",
            "content": [
                {
                    "uuid": "settings-reset",
                    "componentType": "ButtonProps",
                    "text": "Reset",
                    "variant": "outline",
                    "action": "resetSettings",
                },
                {
                    "uuid": "settings-save",
                    "componentType": "ButtonProps",
                    "text": "Save Changes",
                    "action": "saveSettings",
                },
            ],
        },
    ],
    "state": {
        "activeSection": "profile",
        "isLoading": True,
        "isDirty": False,
        "settingsData": {
            "display_name": "",
            "email": "",
            "avatar_url": "",
            "email_notifications": True,
            "push_notifications": False,
            "digest_frequency": "daily",
            "two_factor_enabled": False,
            "session_timeout": 30,
        },
    },
    "actions": {
        "setActiveSection": [{"set": "activeSection", "to": "$payload"}],
        "saveSettings": [
            {"api": "sys_update", "model": "user_settings", "data": "$settingsData"},
            {"set": "isDirty", "to": False},
        ],
        "resetSettings": [{"api": "sys_read", "model": "user_settings"}],
    },
}


# ===========================================================================
# 6. Auth with login + signup + forgot-password
# ===========================================================================

AUTH_SCAFFOLD = {
    "uuid": "scaffold_abc6",
    "componentType": "AuthScaffoldProps",
    "pages": ["login", "signup", "forgot-password"],
    "redirectAfterLogin": "/dashboard",
    "theme": {"layout": "split"},
}

AUTH_MANUAL = {
    "uuid": "page-auth",
    "pageType": "WebPageProps",
    "title": "Authentication",
    "slug": "/auth",
    "content": [
        {
            "uuid": "auth-container",
            "componentType": "FlexProps",
            "direction": "row",
            "classes": "min-h-screen",
            "content": [
                {
                    "uuid": "auth-branding",
                    "componentType": "FlexProps",
                    "direction": "column",
                    "align": "center",
                    "justify": "center",
                    "classes": "w-1/2 bg-primary text-primary-foreground p-12 hidden lg:flex",
                    "content": [
                        {
                            "uuid": "brand-logo",
                            "componentType": "TextProps",
                            "content": "MyApp",
                            "classes": "text-4xl font-bold mb-4",
                        },
                        {
                            "uuid": "brand-tagline",
                            "componentType": "TextProps",
                            "content": "Welcome back! Log in to continue.",
                            "classes": "text-lg opacity-80",
                        },
                    ],
                },
                {
                    "uuid": "auth-form-panel",
                    "componentType": "FlexProps",
                    "direction": "column",
                    "align": "center",
                    "justify": "center",
                    "classes": "w-full lg:w-1/2 p-8",
                    "content": [
                        {
                            "uuid": "login-form",
                            "componentType": "FlexProps",
                            "direction": "column",
                            "gap": "md",
                            "classes": "w-full max-w-md",
                            "showWhen": "$authView === 'login'",
                            "content": [
                                {
                                    "uuid": "login-title",
                                    "componentType": "TextProps",
                                    "content": "Sign In",
                                    "classes": "text-2xl font-bold text-center",
                                },
                                {
                                    "uuid": "login-email",
                                    "componentType": "TextFieldProps",
                                    "label": "Email",
                                    "bindTo": "loginForm.email",
                                    "type": "email",
                                },
                                {
                                    "uuid": "login-password",
                                    "componentType": "TextFieldProps",
                                    "label": "Password",
                                    "bindTo": "loginForm.password",
                                    "type": "password",
                                },
                                {
                                    "uuid": "login-submit",
                                    "componentType": "ButtonProps",
                                    "text": "Sign In",
                                    "action": "submitLogin",
                                    "classes": "w-full",
                                },
                                {
                                    "uuid": "login-forgot",
                                    "componentType": "ButtonProps",
                                    "text": "Forgot Password?",
                                    "variant": "link",
                                    "action": {
                                        "action": "setAuthView",
                                        "payload": "forgot-password",
                                    },
                                },
                                {
                                    "uuid": "login-signup-link",
                                    "componentType": "ButtonProps",
                                    "text": "Don't have an account? Sign Up",
                                    "variant": "link",
                                    "action": {"action": "setAuthView", "payload": "signup"},
                                },
                            ],
                        },
                        {
                            "uuid": "signup-form",
                            "componentType": "FlexProps",
                            "direction": "column",
                            "gap": "md",
                            "classes": "w-full max-w-md",
                            "showWhen": "$authView === 'signup'",
                            "content": [
                                {
                                    "uuid": "signup-title",
                                    "componentType": "TextProps",
                                    "content": "Create Account",
                                    "classes": "text-2xl font-bold text-center",
                                },
                                {
                                    "uuid": "signup-name",
                                    "componentType": "TextFieldProps",
                                    "label": "Full Name",
                                    "bindTo": "signupForm.name",
                                },
                                {
                                    "uuid": "signup-email",
                                    "componentType": "TextFieldProps",
                                    "label": "Email",
                                    "bindTo": "signupForm.email",
                                    "type": "email",
                                },
                                {
                                    "uuid": "signup-password",
                                    "componentType": "TextFieldProps",
                                    "label": "Password",
                                    "bindTo": "signupForm.password",
                                    "type": "password",
                                },
                                {
                                    "uuid": "signup-confirm",
                                    "componentType": "TextFieldProps",
                                    "label": "Confirm Password",
                                    "bindTo": "signupForm.confirmPassword",
                                    "type": "password",
                                },
                                {
                                    "uuid": "signup-submit",
                                    "componentType": "ButtonProps",
                                    "text": "Create Account",
                                    "action": "submitSignup",
                                    "classes": "w-full",
                                },
                                {
                                    "uuid": "signup-login-link",
                                    "componentType": "ButtonProps",
                                    "text": "Already have an account? Sign In",
                                    "variant": "link",
                                    "action": {"action": "setAuthView", "payload": "login"},
                                },
                            ],
                        },
                        {
                            "uuid": "forgot-form",
                            "componentType": "FlexProps",
                            "direction": "column",
                            "gap": "md",
                            "classes": "w-full max-w-md",
                            "showWhen": "$authView === 'forgot-password'",
                            "content": [
                                {
                                    "uuid": "forgot-title",
                                    "componentType": "TextProps",
                                    "content": "Reset Password",
                                    "classes": "text-2xl font-bold text-center",
                                },
                                {
                                    "uuid": "forgot-desc",
                                    "componentType": "TextProps",
                                    "content": "Enter your email and we'll send you a reset link.",
                                    "classes": "text-center text-muted-foreground",
                                },
                                {
                                    "uuid": "forgot-email",
                                    "componentType": "TextFieldProps",
                                    "label": "Email",
                                    "bindTo": "forgotForm.email",
                                    "type": "email",
                                },
                                {
                                    "uuid": "forgot-submit",
                                    "componentType": "ButtonProps",
                                    "text": "Send Reset Link",
                                    "action": "submitForgotPassword",
                                    "classes": "w-full",
                                },
                                {
                                    "uuid": "forgot-back",
                                    "componentType": "ButtonProps",
                                    "text": "Back to Sign In",
                                    "variant": "link",
                                    "action": {"action": "setAuthView", "payload": "login"},
                                },
                            ],
                        },
                    ],
                },
            ],
        },
    ],
    "state": {
        "authView": "login",
        "loginForm": {"email": "", "password": ""},
        "signupForm": {"name": "", "email": "", "password": "", "confirmPassword": ""},
        "forgotForm": {"email": ""},
        "isSubmitting": False,
        "errorMessage": "",
    },
    "actions": {
        "setAuthView": [{"set": "authView", "to": "$payload"}, {"set": "errorMessage", "to": ""}],
        "submitLogin": [{"set": "isSubmitting", "to": True}],
        "submitSignup": [{"set": "isSubmitting", "to": True}],
        "submitForgotPassword": [{"set": "isSubmitting", "to": True}],
    },
}


# ===========================================================================
# 7. Chat with agent mode
# ===========================================================================

CHAT_SCAFFOLD = {
    "uuid": "scaffold_abc7",
    "componentType": "ChatScaffoldProps",
    "title": "AI Assistant",
    "agent": "support_agent",
    "layout": "full-height",
    "features": {
        "streaming": True,
        "typingIndicator": True,
        "connectionStatus": True,
        "suggestedPrompts": ["How can you help me?", "What can you do?"],
    },
}

CHAT_MANUAL = {
    "uuid": "page-chat",
    "pageType": "WebPageProps",
    "title": "AI Assistant",
    "slug": "/chat",
    "content": [
        {
            "uuid": "chat-container",
            "componentType": "FlexProps",
            "direction": "column",
            "classes": "h-[calc(100vh-64px)]",
            "content": [
                {
                    "uuid": "chat-header",
                    "componentType": "FlexProps",
                    "direction": "row",
                    "justify": "between",
                    "align": "center",
                    "classes": "p-4 border-b",
                    "content": [
                        {
                            "uuid": "chat-title",
                            "componentType": "TextProps",
                            "content": "AI Assistant",
                            "classes": "text-lg font-semibold",
                        },
                        {
                            "uuid": "chat-status",
                            "componentType": "FlexProps",
                            "direction": "row",
                            "align": "center",
                            "gap": "xs",
                            "content": [
                                {
                                    "uuid": "status-dot",
                                    "componentType": "TextProps",
                                    "content": "Connected",
                                    "classes": "text-sm text-green-500",
                                    "showWhen": "$isConnected",
                                },
                                {
                                    "uuid": "status-dot-off",
                                    "componentType": "TextProps",
                                    "content": "Disconnected",
                                    "classes": "text-sm text-red-500",
                                    "showWhen": "!$isConnected",
                                },
                            ],
                        },
                        {
                            "uuid": "chat-clear",
                            "componentType": "ButtonProps",
                            "text": "Clear Chat",
                            "variant": "ghost",
                            "size": "sm",
                            "action": "clearChat",
                        },
                    ],
                },
                {
                    "uuid": "chat-messages",
                    "componentType": "FlexProps",
                    "direction": "column",
                    "classes": "flex-1 overflow-y-auto p-4",
                    "content": [
                        {
                            "uuid": "msg-template",
                            "componentType": "FlexProps",
                            "direction": "column",
                            "loopData": "$messages",
                            "loopVariable": "msg",
                            "content": [
                                {
                                    "uuid": "msg-bubble",
                                    "componentType": "CardProps",
                                    "classes": "$msg.role === 'user' ? 'ml-auto bg-primary text-primary-foreground' : 'mr-auto'",
                                    "content": [
                                        {
                                            "uuid": "msg-text",
                                            "componentType": "TextProps",
                                            "content": "$msg.content",
                                            "classes": "p-3",
                                        },
                                    ],
                                },
                            ],
                        },
                        {
                            "uuid": "typing-indicator",
                            "componentType": "TextProps",
                            "content": "AI is typing...",
                            "classes": "text-sm text-muted-foreground animate-pulse",
                            "showWhen": "$isStreaming",
                        },
                    ],
                },
                {
                    "uuid": "chat-suggested",
                    "componentType": "FlexProps",
                    "direction": "row",
                    "gap": "sm",
                    "classes": "px-4 py-2",
                    "showWhen": "$messages.length === 0",
                    "content": [
                        {
                            "uuid": "suggest-1",
                            "componentType": "ButtonProps",
                            "text": "How can you help me?",
                            "variant": "outline",
                            "size": "sm",
                            "action": {"action": "sendMessage", "payload": "How can you help me?"},
                        },
                        {
                            "uuid": "suggest-2",
                            "componentType": "ButtonProps",
                            "text": "What can you do?",
                            "variant": "outline",
                            "size": "sm",
                            "action": {"action": "sendMessage", "payload": "What can you do?"},
                        },
                    ],
                },
                {
                    "uuid": "chat-input-bar",
                    "componentType": "FlexProps",
                    "direction": "row",
                    "gap": "sm",
                    "align": "center",
                    "classes": "p-4 border-t",
                    "content": [
                        {
                            "uuid": "chat-input",
                            "componentType": "TextFieldProps",
                            "label": "",
                            "placeholder": "Type a message...",
                            "bindTo": "inputValue",
                            "classes": "flex-1",
                        },
                        {
                            "uuid": "chat-send",
                            "componentType": "ButtonProps",
                            "text": "Send",
                            "action": "sendMessage",
                            "disabled": "$isStreaming || !$inputValue",
                        },
                    ],
                },
            ],
        },
    ],
    "state": {
        "messages": [],
        "inputValue": "",
        "isStreaming": False,
        "isConnected": False,
    },
    "actions": {
        "sendMessage": [
            {"push": "messages", "value": {"role": "user", "content": "$inputValue"}},
            {"set": "inputValue", "to": ""},
            {"set": "isStreaming", "to": True},
        ],
        "clearChat": [{"set": "messages", "to": []}],
    },
}


# ===========================================================================
# Test cases
# ===========================================================================

TEST_CASES = [
    ("CRUD table with 5 columns", CRUD_TABLE_SCAFFOLD, CRUD_TABLE_MANUAL),
    ("CRUD grid with cards", CRUD_GRID_SCAFFOLD, CRUD_GRID_MANUAL),
    ("CRUD master-detail", CRUD_MASTER_DETAIL_SCAFFOLD, CRUD_MASTER_DETAIL_MANUAL),
    ("Dashboard with 4 stats + 2 charts", DASHBOARD_SCAFFOLD, DASHBOARD_MANUAL),
    ("Settings with 3 sections", SETTINGS_SCAFFOLD, SETTINGS_MANUAL),
    ("Auth with login + signup + forgot-password", AUTH_SCAFFOLD, AUTH_MANUAL),
    ("Chat with agent mode", CHAT_SCAFFOLD, CHAT_MANUAL),
]

MIN_REDUCTION = 0.70  # 70%


@pytest.mark.benchmark
class TestScaffoldConfigSizeReduction:
    """Benchmark: scaffold configs must be at least 70% smaller than manual configs."""

    @pytest.mark.parametrize("name,scaffold,manual", TEST_CASES, ids=[t[0] for t in TEST_CASES])
    def test_config_size_reduction(self, name: str, scaffold: dict, manual: dict):
        scaffold_bytes = _byte_size(scaffold)
        manual_bytes = _byte_size(manual)
        reduction = _reduction_pct(scaffold, manual)

        # Diagnostic output
        print(
            f"\n  {name}:"
            f"\n    scaffold = {scaffold_bytes:,} bytes"
            f"\n    manual   = {manual_bytes:,} bytes"
            f"\n    reduction = {reduction:.1%}"
        )

        assert reduction >= MIN_REDUCTION, (
            f"Scaffold config for '{name}' is only {reduction:.1%} smaller than manual. "
            f"Expected at least {MIN_REDUCTION:.0%}. "
            f"Scaffold={scaffold_bytes}B, Manual={manual_bytes}B."
        )

    def test_all_scaffold_types_covered(self):
        """Verify that test cases cover all 5 scaffold types."""
        scaffold_types = {tc[1]["componentType"] for tc in TEST_CASES}
        expected = {
            "CrudScaffoldProps",
            "DashboardScaffoldProps",
            "SettingsScaffoldProps",
            "AuthScaffoldProps",
            "ChatScaffoldProps",
        }
        assert scaffold_types == expected, f"Missing scaffold types: {expected - scaffold_types}"

    def test_summary_stats(self):
        """Print summary statistics across all test cases."""
        reductions = []
        for name, scaffold, manual in TEST_CASES:
            reductions.append((_reduction_pct(scaffold, manual), name))

        reductions.sort()
        avg = sum(r for r, _ in reductions) / len(reductions)
        worst = reductions[0]
        best = reductions[-1]

        print(
            f"\n  === Config Size Reduction Summary ==="
            f"\n    Average reduction: {avg:.1%}"
            f"\n    Best:   {best[1]} ({best[0]:.1%})"
            f"\n    Worst:  {worst[1]} ({worst[0]:.1%})"
        )

        assert (
            avg >= MIN_REDUCTION
        ), f"Average reduction {avg:.1%} is below target of {MIN_REDUCTION:.0%}."
