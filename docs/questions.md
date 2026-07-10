# Working with questions

How to change, add, remove, and reorder the hide-and-seek questions in this
app. Read the [Overview](#overview) once, then jump to the [recipe](#recipes)
you need.

## Overview

There are **5 top-level question types**: Radius, Thermometer, Tentacles,
Matching, Measuring. Matching, Measuring and Tentacles each have many
**sub-types** chosen from a dropdown (e.g. "Same Administration District",
"Greggs Question", "Coastline Question"). Radius and Thermometer have no
sub-type dropdown.

Everything about a question lives in four places:

| Concern                      | File(s)                                                                           | What it does                                                                            |
| ---------------------------- | --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| **Shape + dropdown options** | [`src/maps/schema.ts`](../src/maps/schema.ts)                                     | Zod schemas define each type/sub-type. **The dropdown labels come straight from here.** |
| **The card UI**              | [`src/components/cards/*.tsx`](../src/components/cards)                           | The form shown for each question (inputs, dropdowns, result toggle).                    |
| **The answer / map logic**   | [`src/maps/questions/*.ts`](../src/maps/questions)                                | Computes the map carve and the hider's answer, usually via a `switch` on the sub-type.  |
| **The "Add question" menu**  | [`src/components/AddQuestionDialog.tsx`](../src/components/AddQuestionDialog.tsx) | The 5 "Add …" buttons and their default data.                                           |

Cards are matched to a question by `question.id` in
[`src/components/QuestionSidebar.tsx`](../src/components/QuestionSidebar.tsx).

### How the sub-type dropdowns are built

For Matching / Measuring / Tentacles, the dropdown is generated **from the
schema** — you don't edit the card to add an option. Each sub-type is a
`z.literal(...)` with a `.describe("Label shown in the dropdown")`:

```ts
// src/maps/schema.ts
z.literal("coastline").describe("Coastline Question"),
z.literal("theme_park").describe("Greggs Question"),
```

- The **value** stored on the question is the literal (`"coastline"`).
- The **dropdown label** is the `.describe(...)` text (`"Coastline Question"`).

Sub-types are collected into the dropdown by grouping the schema's union
variants using each variant's own `.describe(...)`:

- `.describe(NO_GROUP)` → ungrouped options shown at the top level.
- `.describe("Some Heading")` → the options appear under a **group heading**
  in the dropdown (e.g. `"Hiding Zone Mode"`, `"15 Miles (Typically)"`).

So the union hierarchy in the schema **is** the dropdown structure.

---

## Recipes

### Remove a question (sub-type) from a dropdown

This is the most common change — e.g. hiding sub-types that don't make sense
for Tyne & Wear (Coastline, McDonald's, 7-Eleven, High-Speed Rail, Major City,
Commercial Airport, Foreign Consulate…).

1. Open [`src/maps/schema.ts`](../src/maps/schema.ts).
2. Find the sub-type's `z.literal(...)` inside the relevant schema
   (`measuringQuestionSchema`, `matchingQuestionSchema`, or
   `tentacleQuestionSchema` and their building blocks like
   `ordinaryMeasuringQuestionSchema`).
3. Delete that line (or comment it out).

```ts
// Before
z.literal("coastline").describe("Coastline Question"),
z.literal("mcdonalds").describe("McDonald's Question"),

// After — coastline removed from the dropdown
z.literal("mcdonalds").describe("McDonald's Question"),
```

4. Run `npx tsc --noEmit -p tsconfig.json`. TypeScript will flag any `switch`
   `case "coastline":` in [`src/maps/questions/measuring.ts`](../src/maps/questions/measuring.ts)
   (etc.) that references the now-removed type. You can leave those cases
   (harmless dead code) or delete them — either compiles, but deleting is
   tidier.

> A removed sub-type can no longer be **selected or created**, so its logic is
> unreachable. You don't have to touch the answer logic to remove it from the
> UI — only the schema controls the dropdown.

**Removing a whole group** (e.g. the entire "Hiding Zone Mode" set): remove that
variant from the top-level union instead. For example, in
`measuringQuestionSchema`:

```ts
export const measuringQuestionSchema = z.union([
    ordinaryMeasuringQuestionSchema.describe(NO_GROUP),
    customMeasuringQuestionSchema.describe(NO_GROUP),
    hidingZoneMeasuringQuestionsSchema.describe("Hiding Zone Mode"), // ← delete
    homeGameMeasuringQuestionsSchema.describe("Hiding Zone Mode"), // ← delete
]);
```

### Rename a question / change its dropdown label

Change the `.describe(...)` text. Nothing else needs to change — the stored
value stays the same, so existing saved games keep working.

```ts
// src/maps/schema.ts
z.literal("zone").describe("Same Administration District"), // renamed label
```

For the **top-level 5** (Radius/Thermometer/…), the menu label is the button
text in [`AddQuestionDialog.tsx`](../src/components/AddQuestionDialog.tsx)
(`Add Radius`, etc.).

### Reorder dropdown options

Default order follows the order of the `z.literal(...)`s in the union. The
Matching and Measuring cards additionally **sort `-full` (Small+Medium Games)
variants to the top** — see the `.sort(...)` in
[`src/components/cards/matching.tsx`](../src/components/cards/matching.tsx) and
[`measuring.tsx`](../src/components/cards/measuring.tsx). Adjust or remove that
sort to change ordering, or reorder the literals in the schema.

### Add a new sub-type to an existing question

Example: add a new Measuring sub-type "Petrol Station Question".

1. **Schema** — add the literal to the right union in `schema.ts`:

    ```ts
    z.literal("petrol").describe("Petrol Station Question"),
    ```

2. **Logic** — handle it in [`src/maps/questions/measuring.ts`](../src/maps/questions/measuring.ts).
   Add a `case "petrol":` wherever the file `switch`es on `question.type`
   (`determineMeasuringBoundary`, and check `adjustPerMeasuring` /
   `hiderifyMeasuring`). Model it on an existing similar case.

3. **Data** — if it's a place-based question, it needs points to measure to.
   Either add it to the pre-generated POI pipeline (see below) or have the
   logic query Overpass live.

4. Run `npx tsc`, `npx eslint <files>`, and test in the browser.

### Category / POI-backed questions and their data

The `-full` matching/measuring variants, the home-game category variants, and
the tentacle location types (Greggs, Zoos, Museums, …) are answered from
**pre-generated local data**, not live Overpass:

- Data files: [`public/data/pois/<location>.geojson`](../public/data/pois).
- Generator: [`scripts/generate-spoons-pois.mjs`](../scripts/generate-spoons-pois.mjs),
  run with `pnpm generate:spoons-pois`.
- Add a category to `POI_SELECTORS` in that script (an OSM `key=value` tag),
  regenerate, and it becomes available to the questions that use that
  `location`.
- Human-readable names (used in hider answers / "nearest X") come from
  `prettifyLocation` in [`src/maps/api/geo.ts`](../src/maps/api/geo.ts).

> **Greggs** is the `theme_park` slot repurposed: the internal value stays
> `theme_park` (so all plumbing works), but the schema `.describe(...)`, the
> POI selector (`brand=Greggs`), and `prettifyLocation` all present it as
> "Greggs". To repurpose another slot, follow the same three edits.

**Administration District** (Council / Ward) is a similar local-data question:

- Data: [`public/data/admin-councils.geojson`](../public/data/admin-councils.geojson)
    - [`admin-districts.geojson`](../public/data/admin-districts.geojson), from
      [`scripts/generate-admin-districts.mjs`](../scripts/generate-admin-districts.mjs)
      (`pnpm generate:admin-districts`, sourced from ONS).
- Loaded by `loadAdminBoundaries` in [`src/maps/api/overpass.ts`](../src/maps/api/overpass.ts).
- Level is `cat.adminLevel` (`8` = council, `10` = district/ward); the dropdown
  lives in [`matching.tsx`](../src/components/cards/matching.tsx).

### Add a whole new top-level question type (advanced)

Rarely needed. You must touch all four areas:

1. **Schema** — add a new `<name>QuestionSchema` and add it to the
   `questionSchema` union at the bottom of `schema.ts` as
   `{ id: z.literal("<name>"), key, data: <name>QuestionSchema }`.
2. **Card** — create `src/components/cards/<name>.tsx` and export a
   `<Name>QuestionComponent`.
3. **Wire the card** — add a `case "<name>":` in
   [`QuestionSidebar.tsx`](../src/components/QuestionSidebar.tsx).
4. **Logic** — create `src/maps/questions/<name>.ts` with the map-carve and
   hiderify functions, and hook it into the question-processing pipeline in
   [`src/maps/index.ts`](../src/maps/index.ts).
5. **Add menu** — add a `runAdd<Name>` + button in
   [`AddQuestionDialog.tsx`](../src/components/AddQuestionDialog.tsx).

---

## After any change

```bash
npx tsc --noEmit -p tsconfig.json      # types (catches broken switch cases)
npx eslint <changed files>
npx prettier --write <changed files>
pnpm build                             # full check before committing
```

Saved games store the literal **value** (not the label), so renaming labels is
safe. **Removing** a value that someone has already saved will drop or fail to
parse that question — fine for local dev, worth noting if the site has users.
