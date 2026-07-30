---
name: seed-data-csv
description: "Seed data CSV authoring — realistic faker-style values, FK consistency across rows, unique-column generation, owner_id scoping, date sequencing, status distributions for demo-able apps. Load when authoring seed:*.csv artifacts under SeedDataBuilder. Keywords: seed, fixture, demo-data, faker, csv, fixtures, sample-data, mock-data, populate, demo."
metadata:
  kind: backend-pattern
  applies_to: seed-data-builder
---
# Skill: Seed Data CSV Authoring

For SeedDataBuilder — generate realistic seed rows so a freshly-deployed
app demos meaningfully on first load. Boring CSV with `Name 1`,
`Name 2`, `Name 3` makes the user think the app is broken.

## Format

One CSV per model: `seed:applications.csv`. Header row is exact column
names from the model schema; one row per record:

```csv
id,name,email,status,position,applied_on
1,Sarah Chen,sarah.chen@example.com,reviewing,Senior Engineer,__TODAY__-30d
2,Marcus Rodriguez,m.rodriguez@example.com,accepted,Product Manager,__TODAY__-27d
```

The platform's deploy pipeline parses this into rows. The seeder
**injects the system columns for you** — `owner_id` (force-set to the
deploying user), `created_at`, and `updated_at` — so your CSV should
**not** include them. Provide `id` as a plain integer (see *IDs and
system columns* below) plus your business columns.

## Realistic data over Lorem Ipsum

| ✗ Boring | ✓ Realistic |
|---------|-------------|
| `John Doe` | `Marcus Rodriguez`, `Aisha Patel`, `Jennifer Martinez`, `Kenji Yamamoto` |
| `test@test.com` | `m.rodriguez@example.com` (use the `example.com` reserved TLD) |
| `Lorem ipsum dolor sit amet` | One sentence describing what the row IS in this app's domain |
| `123 Main St` | `2845 Castro St, Mountain View, CA 94043` |
| `100`, `200`, `300` | `1240`, `847`, `2103` (varied magnitudes) |
| `2024-01-01`, `2024-01-02`, ... | Spread across the last 60 days, weighted toward recent |

## Per-domain seed cookbook

### People (users, applicants, customers, members, students, doctors, employees)

Mix names by region. **Don't generate 50 anglo-saxon names** — apps
demo internationally.

```
Sarah Chen, Marcus Rodriguez, Aisha Patel, Kenji Yamamoto, Olivia Williams,
Liam O'Connor, Sofia García, Yuki Tanaka, Noah Cohen, Zara Ahmed,
Lucas Müller, Isabella Rossi, Wei Zhang, Amir Hossein, Layla Hassan,
Diego Fernández, Maya Krishnan, Ethan Park, Chloe Dubois, Alessandro Conti
```

Emails: `firstname.lastname@example.com` or `flastname@example.com`.

Phones: keep formatted to plausible regions; use the documentation
range `+1-555-0100` to `+1-555-0199` (officially reserved by NANP).

### Companies / orgs (jobs, deals, accounts, vendors)

```
Acme Logistics, Beacon Health, Cascade Robotics, Delta Capital,
Evergreen Studios, Foundry Labs, Grove Foods, Helix Biotech,
Ironside Security, Junction Analytics, Kinetic Sports, Lighthouse Media
```

### Products

Tied to the app's apparent domain. For an e-commerce app:

```
Stainless Steel Insulated Bottle, Wireless Noise-Cancelling Headphones,
Ergonomic Office Chair, Mechanical Keyboard - Tactile Switches,
Organic Cotton Bedsheet Set, Hand-Crafted Ceramic Pour-Over
```

For a SaaS plan / subscription:

```
Starter, Pro, Team, Enterprise
```

### Cities / addresses

Pick real cities matching the demo persona's locale:

```
San Francisco, CA · Berlin, Germany · Tokyo, Japan · São Paulo, Brazil ·
Cairo, Egypt · Mumbai, India · Toronto, ON · Stockholm, Sweden
```

## FK consistency

Every FK column must reference an existing parent row **by its integer
`id`**. Order seed CSVs by dependency so parents exist before children:

1. `seed:users.csv` — users referenced by every other table
2. `seed:categories.csv` — referenced by posts, products
3. `seed:posts.csv` — references users, categories
4. `seed:comments.csv` — references posts, users

Seed `id`s are **integers starting at 1** (matching each table's
`INTEGER PRIMARY KEY AUTOINCREMENT`), and each FK column holds the
integer `id` of the parent row. A non-numeric value in the integer
`id` column raises a SQLite datatype mismatch that fails the whole
batch; a non-numeric value in an FK column breaks the join (and trips a
FOREIGN KEY constraint). Keep both numeric and eyeball-consistent:

```csv
id,user_id,post_id,body
1,2,1,Great write-up — thanks!
2,5,1,Disagree on the second point...
```

## Unique columns

For columns declared `isUnique: true` (email, slug, sku):

```
sarah.chen@example.com
marcus.rodriguez@example.com
aisha.patel@example.com
```

Don't repeat `john@example.com` 5×. The deploy fails on duplicate.

## Date sequencing

Spread your **business date columns** (`applied_on`, `published_at`,
`event_date`, `due_on`) across the last 30–60 days, weighted toward
recent so the "today" view of the dashboard isn't empty. (`created_at`
and `updated_at` are auto-filled with the deploy timestamp ONLY when you
omit them; omit them by default, but when a chart or trend view is keyed
on `created_at`, seed it with a spread — same relative-date approach —
so the time-series isn't a flat line at deploy time.)

```
2026-05-08T09:30:00Z   ← today (3 rows)
2026-05-07T...         ← yesterday (4 rows)
2026-05-05T...         ← 4 days ago (3 rows)
2026-05-01T...         ← 1 week ago (2 rows)
2026-04-22T...         ← 17 days ago (1 row)
2026-04-10T...         ← 1 month ago (1 row)
```

For a business date pair (e.g. `start_time` / `end_time`,
`ordered_on` / `shipped_on`), keep the later value ≥ the earlier one.

## Status distributions

Realistic distributions (not 50/50 across enum values):

| Domain | Distribution |
|--------|--------------|
| Job applications | 60 % new/reviewing, 25 % accepted, 15 % rejected |
| Tickets / issues | 70 % open, 20 % in_progress, 10 % resolved |
| Bookings | 80 % confirmed, 10 % cancelled, 10 % pending |
| Orders | 5 % pending, 5 % shipped, 80 % delivered, 10 % returned |
| Subscriptions | 90 % active, 7 % paused, 3 % cancelled |

Skewed real-world ratios make the dashboard reflect how the app
actually feels in use.

## Volume

| Dataset kind | Rows |
|--------------|------|
| Lookup / reference (categories, statuses, tags) | 3–8 |
| Simple single-entity form (contact/newsletter submissions) | 5–10 |
| Dashboard / list view (orders, applications, products, tasks) | 20–40 |
| Time-series / activity log (check-ins, audit trails, event history) | 30–50, spread across 7+ days |

Keep datasets under ~50 rows — seed data demonstrates layout, not
volume. Aim for the richer end (20–40) on the primary list/dashboard
entity so tables and charts look alive, fewer for simple forms and
lookups.

## IDs and system columns — what to put in the CSV

- **`id`** — a plain **integer starting at 1** (`1, 2, 3, …`), matching
  each table's `INTEGER PRIMARY KEY AUTOINCREMENT`. FK columns hold the
  integer `id` of the parent row. Do **not** use string/semantic ids
  (`app_001`) or UUIDs in `id` or FK columns — a string in an integer
  column raises a SQLite datatype mismatch that fails the entire seed
  batch. (Auth tables are the one exception where the pipeline manages
  string/UUID ids — you don't seed those.)
- **`owner_id`** — **omit it.** The seeder force-sets it to the deploying
  user, so any value you put there is overwritten.
- **`created_at`, `updated_at`** — omit them by default; the seeder fills
  them with the deploy timestamp ONLY when the column is absent, and keeps
  any value you DO provide. So when a chart or trend view is keyed on
  `created_at`, seed it with a date spread (see Date sequencing) so the
  time-series isn't a flat line — otherwise omit and let the seeder stamp it.

```csv
id,name,...
1,Sarah Chen,...
```

## Relative-date tokens (`__NOW__`, `__TODAY__`)

For demo data that should feel current regardless of when the app
deploys, use the platform's relative-date tokens. They expand at
deploy time to absolute timestamps so "today" always means today.

```
__TODAY__          → 2026-05-15 (date)
__TODAY__-7d       → 2026-05-08 (one week ago)
__TODAY__+1w       → 2026-05-22 (one week from now)
__TODAY__-1mo      → 2026-04-15 (one month ago)
__NOW__            → 2026-05-15T18:41:17.540Z (datetime)
__NOW__-2h         → today at -2 hours (datetime)
__NOW__+15m        → in 15 minutes (datetime)
```

**Unit rules — strict:**

- `__TODAY__` returns a **date** (`YYYY-MM-DD`). Only `d` / `w` / `mo`
  units are valid. **NEVER write `__TODAY__+8h` or `__TODAY__-15m`** —
  hours and minutes are illegal on `__TODAY__`. They throw a token
  error at deploy time. The runtime drops the row (per-row tolerance);
  with persistent mistakes the dataset can end up empty.
- `__NOW__` returns a **datetime** (ISO 8601). All units (`d/w/mo/h/m`)
  are valid. Use this whenever you need an hour/minute offset.

For a booking that starts today at 3 PM use `__NOW__+Nh` relative to a
deploy-time anchor — do NOT mix `__TODAY__` with hour offsets.

```csv
✓ start_time,end_time
✓ __NOW__-2h,__NOW__+1h            (single offset, OK)
✓ __TODAY__,__TODAY__+1w           (date + day-class unit, OK)
✗ __TODAY__,__TODAY__+8h           (h on __TODAY__ — illegal, row drops)
✗ __TODAY__-2d+9h                  (compound offset — illegal, row drops)
```

## JSON-typed columns (`type: "json"`)

Columns declared `type: "json"` in the model schema are stored as TEXT
in D1 but **auto-parsed by the app-backend** before reaching the
frontend. The frontend receives a JS array, object, or `null` —
**never a string**.

When a frontend component iterates the field with `.map`, the seed
CSV MUST contain a JSON **ARRAY**, not an object:

```csv
✓ features
✓ "[""access: 24/7"", ""wifi: high speed"", ""coffee: unlimited""]"
✗ "{""access"": ""24/7"", ""wifi"": ""high speed""}"  (object — .map() will crash)
```

The platform's auto-fixer can rescue the object case at runtime, but
the seed-time correct shape is an array of stringified key-value
labels (or whatever the component intends to render).

## Image columns

When a model has an image column (`image`, `photo`, `avatar`, `cover`,
`thumbnail`, `logo`, …), **NEVER invent an external CDN/stock URL**.
Hallucinated `images.unsplash.com/photo-<id>` / `pexels.com` /
`via.placeholder.com` / `wikimedia` URLs break at runtime: the photo id
usually does not exist (blank card), is semantically wrong (a "lager"
row pointing at a stock photo of a person), or gets blocked by the
browser (ORB/CORS). You cannot know a real, working stock URL — so
don't guess one.

There is **no runtime keyword resolution**: a per-row
`<ExepadImage keywords={row.x}>` (dynamic keywords) renders a blank
skeleton — the build resolver reads only *static literal* keywords, and
the `component.image.dynamic_keywords_no_src` rule rejects that pattern.
So a `NULL` image column means **no image renders** for that row.

Decide by whether each row needs its OWN distinct image:

- **Decorative / shared image** (same vibe for every row): leave the
  column `NULL` and let the *component* show one build-resolved image via
  a STATIC literal `<ExepadImage keywords="five literal words ...">` (not
  bound to the row). The column is genuinely unused — empty is correct.
- **Distinct image per row** (product catalog, gallery, recommender):
  the image MUST come from the column as a **deployed app asset** value
  the platform owns — an `__ASSET_IMG:assets/images/<file>__` placeholder
  the deploy pipeline rewrites to `/a/{appId}/repo/...`. A `NULL` here
  ships placeholder boxes on the payoff screen. If you have no deployed
  assets to point at, prefer a small shared/category image over leaving
  rows imageless — do **not** expect keywords to fill them in at runtime.

**NEVER** put a third-party URL in an image column.

```csv
✓ id,name,style,abv,image
✓ 1,Amber & Grain Lager,Helles Lager,4.8,          (empty — decorative, component uses a static-keyword image)
✓ 1,Amber & Grain Lager,Helles Lager,4.8,__ASSET_IMG:assets/images/amber-lager.jpg__   (distinct per-row asset)
✗ 1,Amber & Grain Lager,Helles Lager,4.8,https://images.unsplash.com/photo-1550928431-ee0ec6db30d3
```

## Anti-patterns

- ✗ External/stock image URLs in image columns (`unsplash.com`,
  `pexels.com`, `via.placeholder.com`, `wikimedia`). The photo id is
  hallucinated → broken or mismatched image. Leave the column empty.
- ✗ `John Doe`, `Jane Doe`, `Test User`. Use real-feeling names.
- ✗ All rows on the same date. Spread across the last 30–60 days.
- ✗ All rows in the same status. Mirror real distributions.
- ✗ Lorem ipsum descriptions. Write 1-sentence domain-specific text.
- ✗ Repeated emails / SKUs / slugs in unique columns. Deploy fails.
- ✗ FK to a non-existent parent row. Deploy fails.
- ✗ Including an `owner_id` column — the seeder force-overwrites it; omit
  it. (`created_at`/`updated_at`: omit by default, but seed `created_at`
  with a date spread when a chart/trend view needs it — see Date sequencing.)
- ✗ String / UUID / semantic ids (`app_001`, `user_005`) in `id` or FK
  columns. Use integer ids starting at 1 — a string in the `id` column
  raises a SQLite datatype mismatch that fails the seed, and in an FK
  column it breaks the join.

## Compatibility

CSV parsing is RFC 4180. Quote fields containing commas or newlines
with `"`. Escape internal quotes by doubling (`""`). Empty fields are
SQL `NULL` (not empty string). The platform deploys CSVs in dependency
order based on FK declarations in the model schema — see
[`database-schema-design`](../database-schema-design/SKILL.md).
