# 2026-07-22 — Widget property help texts (Go doc comments → inspector UI)

## Goal

Every widget property gets a Golang doc comment (styled like the TypeScript
chart-prop docs in `frontend/chart/*.ts`). These comments already flow into the
Explore inspector via the existing pipeline; the UI is changed to show the
**first sentence** as an inline help label and the **full text** on hover of a
`?` icon.

## Existing pipeline (no changes needed)

1. `cmd/dashica-gen/load.go` `harvestDocs()` reads the doc comment of every
   widget struct field → `fieldInfo.Doc`.
2. `cmd/dashica-gen/emit.go` emits it into `zz_generated.dashica.go` as
   `FieldDescriptor.Help` (`lib/dashboard/widget/formmodel.go`).
3. `/explore/api/formmodel` serves it; `frontend/explore/controls.ts`
   `labelled()` renders `field.help` below the label.

So the work is: **write the comments** (A) and **change the rendering** (B).
`zz_generated.dashica.go` is gitignored and regenerated on build — do NOT edit
it; do NOT run the frontend build.

## Doc comment style rules

- First sentence: short (≤ ~90 chars), self-contained, ends with a period.
  It becomes the inline label in the inspector. Example:
  `// Fill is the series to stack, bound to the color scale.`
- Optional further sentences: detail, defaults, links (e.g. Observable Plot
  docs URLs). Shown only on `?` hover.
- Go convention: comment starts with the field name (`// height is …` for
  unexported fields is fine; match existing style in `time_bar.go`
  StackOptions).
- Mirror/adapt the wording of the corresponding TS chart-prop docs where they
  exist (`frontend/chart/timeBar.ts`, `timeLine.ts`, `barVertical.ts`,
  `barHorizontal.ts`, `timeHeatmap*.ts`, `stats.ts`, `table.ts`,
  `alertOverview.ts`) — don't invent divergent semantics.
- Fields tagged `dashica-gen:"skip"` and purely internal fields (`id`) still
  get a one-liner, but keep it minimal ("id is the stable widget id; assigned
  automatically when empty.").
- Do not change any field types, tags, ordering, or methods — comments only.

## Work packages

### A. Go doc comments (per file, parallel subagents)

| Batch | Files (lib/dashboard/widget/) | TS reference (frontend/chart/) |
|---|---|---|
| A1 | time_bar.go, time_line.go | timeBar.ts, timeLine.ts |
| A2 | bar_vertical.go, bar_horizontal.go | barVertical.ts, barHorizontal.ts |
| A3 | timeHeatmap.go, timeHeatmapOrdinal.go | timeHeatmap.ts, timeHeatmapOrdinal.ts |
| A4 | table.go, stats.go, schema_table.go | table.ts, stats.ts |
| A5 | alert_detail.go, alert_overview.go, speedscope_link.go | alertOverview.ts |
| A6 | text_input.go, checkbox_group.go, markdown.go | — (parameter/content widgets) |
| A7 | grid.go, collapsible_group.go, multi_column.go, widget_common.go | — (container widgets) |

Each batch agent: read the Go file(s) + TS reference(s), add doc comments to
every struct field of the widget struct(s) (and any option/group structs
without docs), following the style rules above. Verify with
`mise exec go -- go vet ./lib/dashboard/widget/` (compile check only — no
build, no commits).

### B. Frontend rendering split (one subagent)

`frontend/explore/controls.ts` `labelled()` (+ `explore.css`):

- Split `field.help` at the first sentence boundary (`. ` / end of string).
- Inline: first sentence in the existing `.explore-field__help` div.
- If a remainder exists: append a small `?` icon (e.g.
  `<span class="explore-field__hint" title="…full help text…">?</span>`)
  next to the label; native `title` tooltip is sufficient (no JS tooltip lib).
- Group sub-fields (StackOptions) go through the same `labelled()` path —
  should work automatically; verify.
- CSS: subtle, small, circle-bordered `?`, cursor: help.
- Do NOT run the frontend build.

### C. Verification (one subagent, after A)

- `cd lib/dashboard/widget && mise exec go -- go run github.com/sandstorm/dashica/cmd/dashica-gen -dry-run`
  → generator still parses everything; no field errors.
- `mise exec go -- go vet ./lib/dashboard/widget/ ./cmd/dashica-gen/` passes.
- Spot-check: every widget struct field has a doc comment (grep for adjacent
  lines without `//` above fields).

## TODO

- [x] A1–A7 doc comments written
- [x] B frontend split + ? icon
- [ ] C verification passed
- [ ] User: build + E2E check help texts appear in inspector
