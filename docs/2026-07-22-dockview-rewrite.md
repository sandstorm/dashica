# Dockview evaluation — Explore view and normal dashboards

**Date:** 2026-07-22 · **Status:** analysis only, nothing implemented.
Companion to `2026-07-21-dynamic-widget-dashboard-ui.md` (the Explore plan);
section references below point there.

## 1. What dockview is

[mathuo/dockview](https://github.com/mathuo/dockview) is a zero-dependency,
MIT-licensed layout manager: dockable tabbed panels, split-views, grid-views,
drag-and-drop rearranging, floating groups, popout browser windows, full
layout serialization (`toJSON`/`fromJSON`), CSS-theme based styling. It ships
a plain-JavaScript/TypeScript entry with no framework requirement (React/Vue/
Angular bindings are separate packages) — so it fits our no-framework,
esbuild + Alpine stack. It is a *runtime, client-side, imperative* library:
you hand it a container element, it owns that element's layout, and panels
receive DOM elements to render into.

That last sentence is the whole evaluation in miniature. Dockview is a
**workspace/IDE layout manager**. The question is which of our two surfaces
is a workspace.

## 2. Explore view — good fit, for the *editor chrome* only

Two very different places dockview could sit in Explore. They must be judged
separately.

### 2.1 Editor chrome (toolbar / tree / preview / inspector / drawer): fits

The Explore editor *is* an IDE: `EditorShell` in `lib/explore/editor.templ` is
a full-viewport static CSS grid with five mount points that
`frontend/explore/editor.ts` fills imperatively. Dockview would replace that
static grid with real panes:

- **Resizable panes** — tree/inspector width and drawer height are fixed
  today; the inspector especially pinches with nested query sections.
- **Collapsible/closable panes** — hide tree or inspector to give the preview
  the full width; "maximize group" for a full-screen preview.
- **Drawer as native tabs** — Data / Go code / JSON map 1:1 onto a dockview
  tabbed panel group; we currently hand-roll those tabs.
- **Floating/popout** — inspector as floating panel; preview popped out to a
  second monitor while editing. Free features we would never build ourselves.
- **Layout persistence** — `toJSON` into the existing localStorage autosave
  blob; the editor already persists state, this is one more key.

Integration fits the existing architecture unusually well, because the
frontend was *deliberately* written non-idiomatically (§2.3 of the Explore
doc): panes are already filled by imperative per-surface effects targeting
plain DOM elements. Dockview panels hand you exactly that — an element per
panel. Each existing effect (tree / inspector / drawer / preview) re-targets
its panel's element; the reactive design does not change. Two details to
watch:

- The preview pane's time-range strip (`explorePreviewControls` templ, an
  Alpine `searchBar`): make it **its own adopted panel** — a fixed-height,
  locked, header-less panel above the preview (`data-dock-panel=
  "preview-controls"`). That dissolves what would otherwise be the one awkward
  spot where server markup meets dockview ownership: the strip goes through
  the exact same adopt mechanism (§4.2) as every other pane, no hidden-
  container tricks, no JS rebuild. Locked and header-less because the strip
  *is* the previewed dashboard's state and must stay glued above it — it gets
  panel plumbing, not user-draggability. Same move applies to the dashboard
  `SearchBar` (§3.3), with a bonus there: as a separate panel it no longer
  needs `sticky` inside a scrolling content panel — the panel split solves
  the sticky-scroll question by construction.
- Alpine CSP build: irrelevant — dockview is a plain DOM library, no expression evaluation.

Cost: one dependency (~zero-dep, but a real chunk of JS + CSS for one view),
theming to match our daisyUI look, and rework of `explore.css`'s grid. And a
sober alternative exists: plain CSS `resize:` handles or a ~50-line splitter
give 80 % of the value (resizable panes) for 2 % of the surface area.

**Verdict:** genuine fit, nice-to-have. Do **not** schedule before Step 1
(E2E harness) and the B1–B10 fixes — a layout rewrite invalidates selectors
and screenshots, so the E2E suite must exist *first* and be written against
`data-explore` attributes (it is), not structure. Sensible slot: alongside
Step 8 (the other big editor-UI slice), or never, if CSS resize suffices.

### 2.2 Preview canvas (the widget cards): does not fit — protect the preview

The preview's core invariant (§2.3 "protect this"): the server renders the
widget's **real compiled markup**, the real `chart` component takes over —
one rendering implementation shared with compiled dashboards. The preview is
WYSIWYG *of a compiled dashboard*. If dockview owned the canvas, the preview
would show dockview panels while the compiled dashboard shows a CSS grid —
the preview would preview something that doesn't exist.

There is also a hard representational argument, see §3.1: dockview layouts
are split trees and cannot express every `grid-template-areas` layout, so it
could not even faithfully *display* all compiled dashboards opened in Explore
(Step 6).

**Verdict:** no. The planned WYSIWYG grid designer (Step 8:
`grid-template-areas` overlay on the real preview grid) is the right tool and
dockview is not a substitute for it.

## 3. Normal (compiled) dashboards — does not fit

### 3.1 The representational mismatch is fundamental, not cosmetic

Dashica layouts are CSS `grid-template-areas`
(`widget.Grid.Template("a a b", "c d b")`): arbitrary named rectangles on a
cell matrix. Dockview grid/dock layouts are **nested orthogonal split trees**
(branch/leaf, like a kd-tree). Split trees express only "guillotine"
partitions — every layout must be reachable by recursively slicing the space
fully horizontally or vertically. Grid-template-areas can express
non-sliceable layouts (the classic pinwheel: four panels around a center,
`"a a b" / "c e b" / "c d d"`) that **no** dockview tree can represent.
Migrating dashboards to dockview would silently shrink the layout vocabulary,
and a converter from existing templates would fail on valid dashboards.

### 3.2 Dashboards here are documents, not workspaces

Compiled dashboards are server-rendered templ, scroll vertically, and mix
charts with markdown prose, headings, collapsible groups, nested grids — the
`docsPage` layout is literally documentation with embedded charts. Dockview
layouts fill a fixed viewport; panels are equal-citizen tabbed panes with
their own scrollbars. That is Grafana/IDE ergonomics, not this product's:

- **SSR & progressive enhancement die.** Today the full dashboard HTML
  arrives from Go and Alpine enhances it. Dockview requires JS to construct
  the layout and mount each widget into a panel element — client-side
  assembly, blank page until JS runs, and a new widget-mounting indirection
  for every widget type.
- **Go stays the source of truth** (requirement #1 of the Explore work). A
  docking UI's entire point is end-user rearrangement at runtime. Either we
  disable the interactivity (then dockview is an expensive CSS grid) or we
  persist user layouts (then we've built per-user mutable state that
  contradicts compiled-dashboard-as-immutable-truth, plus the §3.1 conversion
  problem on every save).
- **Nothing is currently missing.** There is no open requirement for
  user-rearrangeable compiled dashboards; height/scroll behavior of the
  current grid is unproblematic.

**Verdict:** no rewrite. `grid-template-areas` + SSR stays.

### 3.3 Dashboard *chrome* — the widget grid's verdict does not apply

§3.1/§3.2 rule out dockview for the widget canvas. The chrome around it is a
different question, and the same chrome-vs-canvas split from §2 applies.
Today's chrome (`default_page.templ`): sidebar (`PageMenu`) · `SearchBar` ·
`DebugDrawer` wrapping the whole page. As dockview panels:

- **Debug drawer is the killer case.** The SQL/EXPLAIN/DOT-graph drawer
  popped out into its own browser window on a second monitor, staying live
  while the dashboard scrolls — popout windows are the one feature that is
  genuinely hard to hand-roll (moving live DOM across windows, style
  duplication, event wiring), and dockview ships it. Resizable drawer height
  comes along for free.
- **Sidebar**: resizable/collapsible pane — real but small; CSS alone gets
  there.
- **Dashboard content stays a single locked panel** (header hidden, no tabs,
  no drag — dockview supports locked groups). The SSR-rendered dashboard
  HTML is adopted into the panel's element; the rendering path and the grid
  verdict above are untouched. (Superseded by §3.4 if the tab workspace is
  built: same shell, content group unlocked and tabbed.)

Costs, honestly: the page shell becomes JS-assembled (SSR body reparented
into panels on init → reflow flash; without JS the page loses its layout —
today it is readable pre-JS); body scroll becomes panel scroll (sticky
search bar, anchors, print need re-checking); the `dashica-debugDrawer-toggle`
event that bubbles from the chart wrench needs explicit plumbing once the
drawer lives in another panel or window (same JS realm even in popouts, so
workable).

**Verdict:** sensible, but *conditional*: a docking library is too heavy for
two panes on its own. It pays off only bundled with the Explore editor-chrome
adoption (§2.1) — one dependency, one theme integration, amortized over both
surfaces. Adopt for both or for neither.

### 3.4 Dashboard tabs / workspace — wanted (promoted from back-pocket)

Confirmed as a real want: **dashboards open as tabs in a top bar**, and users
can combine two dashboards side by side (split a tab group). This uses
dockview for exactly what it is — a workspace shell around untouched SSR
dashboards — and it changes the shape of the dashboard-chrome integration:
the content group is no longer a single locked panel but a **tab group of
dashboard panels**.

Design sketch:

- **The shell**: `defaultPage` becomes sidebar (adopted panel) + a dockview
  tab group as the content area. Clicking a sidebar menu entry no longer
  navigates — it adds (or focuses) a panel for that dashboard. Users drag a
  tab sideways to see two dashboards at once; popout works too.
- **Each dashboard panel is an adopted HTML fragment, not an iframe.**
  The shell fetches a *bare* dashboard rendering (content only, no
  sidebar/layout — a fragment endpoint of the existing SSR page), inserts it
  into the panel and runs `Alpine.initTree` on it. This is not new
  machinery — it is exactly the **Explore preview pattern** (§2.3 of the
  Explore doc): server renders real dashboard markup, the client adopts it,
  the real `chart` component takes over. The workspace is that pattern, one
  level up.
  Iframes were considered and rejected: they buy isolation precisely by
  *preventing* interaction, and interaction is where this feature is headed —
  shared time range/filters across tabs, later cross-dashboard linking
  (click a value in one dashboard, filter another). In one DOM, the single
  global `$store.urlState` makes the shared time range the *default* rather
  than a feature to build: every adopted dashboard's charts already react to
  it, exactly like the Explore preview strip drives its cards. One search
  bar in the shell, N dashboards obeying it.
- **What sharing one DOM costs** (the spike must clear these):
  - the `urlState` global/per-panel split — decided below, the one real
    design task in here;
  - id collisions when two dashboards define same-named widgets (or one
    dashboard is open twice): data endpoints are per-dashboard absolute
    URLs and unaffected, but DOM ids / chart element lookups need
    container-scoped queries or a per-panel prefix;
  - memory + auto-refresh of N live dashboards: pause refresh in
    non-visible panels (`x-intersect` is already in the stack as the gate).
- **Deep-linking/back button**: the shell mirrors the focused tab into the
  URL via `history.replaceState`; a plain dashboard URL keeps rendering the
  classic single page — the workspace is additive, not a replacement.
- This *replaces* the "content = one locked panel" variant of §3.3 rather
  than adding to it: same shell, the tab group is simply not locked. The
  debug drawer panel (§4.5) belongs to the shell and shows the wrench output
  of whichever panel dispatched it.

**Tearing `urlState` apart: time state vs. query filters.** Today
`frontend/store.ts` is one flat global store. For the workspace it splits by
a simple question — *does this value mean the same thing on every open
dashboard?*

| Value (today in `urlState`) | Scope | Why |
|---|---|---|
| `timeRange`, `customDateRange` | **global** (workspace) | Comparing dashboards over the *same window* is the point of combining them. |
| `autoRefresh`, `refreshInterval`, `_refreshNonce` | **global** | One heartbeat; per-panel visibility gating handles the rest. |
| `logScale` | **global** | Display preference, dashboard-independent. |
| `sqlFilter` (search-bar SQL, filter buttons, `addFilter`) | **per-dashboard** | Filters reference *that* dashboard's tables/columns — `host_name = 'x'` is meaningless or wrong on the neighbouring tab. |
| `widgetParams` | **per-dashboard** | Parameter widgets belong to one dashboard's widgets. |

Mechanism, kept minimal:

- `urlState` becomes **`timeState`** (global Alpine store, the top rows) plus
  a **`FilterScope`** (the bottom rows), one instance per dashboard,
  owned by the element that contains the dashboard — the panel root in the
  workspace, the page root on a classic single-dashboard page. A classic
  page therefore has exactly one scope and behaves byte-for-byte like today
  (same URL params: `time`/`range`/`refresh`/`log` global, `sql`/`wp` from
  the single scope).
- Charts resolve their scope by **containment**, not by name: the `chart`
  component reads the nearest ancestor scope (`closest('[data-filter-scope]')`
  → instance registry) and combines it with the global `timeState` — the
  current `getCombinedFilter()` becomes `merge(timeState, nearestScope)`.
- Filter events (`dashica-add-filter`, B6 "filter from data") switch from
  `window`-level to **bubbling** dispatch: they rise from the clicked cell to
  the owning scope root and stop there. Scoping by DOM position replaces
  scoping by convention — a table in dashboard A can never pollute dashboard
  B's filter.
- The workspace shell renders the global controls (time presets, custom
  range, auto-refresh, log scale) **once** in its toolbar; each dashboard
  panel keeps its own filter row (SQL filter + that dashboard's filter
  buttons). The Explore preview strip is the same picture: global strip
  above, per-preview scope inside — Explore's "time range is the previewed
  dashboard's state" stays coherent because there, the preview *is* the only
  scope.
- "Maybe different query filters" cuts both ways — a **"apply filter to all
  tabs"** action is a one-liner later (copy clause into every scope), whereas
  un-sharing an accidentally global filter would be a redesign. Per-dashboard
  is the right default.

Sequencing bonus: this split is a pure store refactor, invisible on
single-dashboard pages, and needs no dockview at all — it can (and should)
land as its own small slice *before* any workspace work, shrinking the
workspace spike to geometry questions only.

This is the strongest dashboard-side argument for dockview — unlike
resizable chrome, tabs + combine-two-dashboards has no cheap CSS
alternative.

### 3.5 Table row details & pinnable hover details — wanted

Second confirmed use case: from a table widget,

- **Row details**: clicking a row opens a details panel (all columns of the
  row, key/value, full untruncated values) docked right or below — dockable,
  popout-able like any panel.
- **Pinnable hover details**: the transient hover/detail view can be
  **pinned**, becoming its own panel; pin again on another row → additional
  panel, enabling side-by-side comparison of two rows.

Fits the chrome model exactly: details panels are chrome (like the debug
drawer), the table widget itself stays untouched canvas. The row data is
already client-side (Arrow → tabulator), so the panel renders locally — this
is the `details` renderer of §4.1 rule 1. Mechanism mirrors the debug drawer
(§4.5): the table dispatches a window-level event with the row payload; the
dock adapter owns one reusable `details` panel plus N pinned clones.
Synergy: the same row context menu is where B6 "filter from data" lives —
one affordance, two actions ("details", "filter on value").

## 4. Integration sketch (if we do it)

How dockview would land in this codebase with the smallest, cleanest surface.
API names are from dockview-core's vanilla docs (`createDockview`, panels
registered by component name, `toJSON`/`fromJSON`, popout groups) — verify
against the pinned version when implementing; the *architecture* below is the
point, not the exact signatures.

### 4.1 Architecture: three owners, one boundary

```
templ (Go, SSR)      owns MARKUP    — every panel's content, as today
dockview             owns GEOMETRY  — pane sizes, docking, tabs, popouts
Alpine               owns BEHAVIOR  — unchanged, zero component rewrites
frontend/components/dock.ts        — the ONLY module importing dockview-core
```

Rules that keep it simple:

1. **Two panel components, by content origin — no more, ever.**
   - `adopt`: "move this server-rendered element in here" — the default for
     everything that exists as templ markup (sidebar, content, search bar,
     drawers). Panel content stays in templ, reviewable in Go, styled by the
     existing CSS pipeline.
   - `details`: renders *client-side data* the server never saw (table
     row-details, pinned hover details — §3.5). SSR is impossible for these
     by definition, so a second renderer is honest, not scope creep. Any
     third renderer proposal is a design smell.

   Accepted consequence, stated plainly: the overall **page geometry moves
   from templ/CSS to JS** — the templ layouts shrink to staging blocks
   (§4.3) and geometry lives in the `buildDefaultLayout` functions (§4.4).
   Markup, styling and behavior stay where they are; only the arrangement of
   the top-level panes changes owner. That is the deal being made, and it is
   confined to the two layouts that opt in (rule 4).

2. **Assemble the dock *before* `Alpine.start()`.** Both page layouts already
   call `window.Alpine.start()` explicitly at the end of `<body>` — the dock
   adopts (reparents) the SSR fragments first, then Alpine initializes them
   in their final position. No re-init, no Alpine reparenting edge cases, no
   changes to any Alpine component.
3. **Default layout is code, saved layout is localStorage.** A
   `buildDefaultLayout(api)` function per page kind; `api.fromJSON` only for
   the user's saved arrangement, behind a version key, falling back to the
   default builder on *any* error. Never ship serialized JSON blobs as the
   source of a default layout.
4. **Opt-in per layout.** Only `explorePage` (editor chrome) and
   `defaultPage` (dashboard chrome) assemble a dock. `docsPage` stays pure
   SSR — the accepted cost "no layout without JS" applies only where the
   chrome earns it.

### 4.2 The adapter (`frontend/components/dock.ts`)

```ts
// The only file importing dockview-core.
import { createDockview, type DockviewApi } from 'dockview-core';
import 'dockview-core/dist/styles/dockview.css';

// The single panel type: adopt a server-rendered element by name.
// Panels are declared in templ as <div data-dock-panel="sidebar">…</div>.
function adoptRenderer() {
    const element = document.createElement('div');
    element.className = 'dock-adopt';
    return {
        element,
        init({ params }: { params: { adopt: string } }) {
            const src = document.querySelector(`[data-dock-panel="${params.adopt}"]`);
            if (!src) throw new Error(`dock: no [data-dock-panel="${params.adopt}"]`);
            element.appendChild(src);           // move, don't clone — runs pre-Alpine.start()
        },
    };
}

const STATE_VERSION = 1;                        // bump to invalidate saved layouts

export function initDock(
    container: HTMLElement,
    storageKey: string,
    buildDefaultLayout: (api: DockviewApi) => void,
): DockviewApi {
    const api = createDockview(container, {
        createComponent: () => adoptRenderer(), // every panel is 'adopt'
        className: 'dockview-theme-dashica',
    });

    const key = `${storageKey}.v${STATE_VERSION}`;
    try {
        const saved = localStorage.getItem(key);
        if (saved) api.fromJSON(JSON.parse(saved));
        else buildDefaultLayout(api);
    } catch {
        buildDefaultLayout(api);                // saved state is a cache, never a source of truth
    }

    let t: number | undefined;
    api.onDidLayoutChange(() => {               // debounced autosave
        clearTimeout(t);
        t = window.setTimeout(
            () => localStorage.setItem(key, JSON.stringify(api.toJSON())), 250);
    });
    return api;
}
```

### 4.3 templ side: staging block instead of layout markup

`default_page.templ` keeps rendering every fragment; the CSS-grid wrappers are
replaced by an inert `<template>` staging block (content is not rendered and
not scanned by anything until adopted):

```templ
<body class="bg-base-200">
    <div id="dock" class="dock-root"></div>
    <template data-dock-staging>
        <aside data-dock-panel="sidebar">@PageMenu(renderingContext)</aside>
        <main data-dock-panel="content" class="prose max-w-none">
            if searchBar.IsVisible { @SearchBar(searchBar) }
            @content
        </main>
        <div data-dock-panel="debug">@DebugDrawer()</div>
    </template>
    <script>window.Dashica.initDashboardDock(); window.Alpine.start();</script>
</body>
```

(Adoption must pull from `template.content`, or a plain `hidden` div is used
instead — implementation detail; `<template>` is preferred because its
content is guaranteed inert.)

### 4.4 Default layouts

Dashboard chrome — content is a locked, header-less panel; the grid verdict
of §3.1 is untouched because dockview never sees individual widgets:

```ts
function dashboardLayout(api: DockviewApi) {
    const content = api.addPanel({
        id: 'content', component: 'adopt', params: { adopt: 'content' },
    });
    content.group.locked = 'no-drop-target';    // nothing can dock into the dashboard
    content.group.header.hidden = true;         // no tab bar — it reads as a page

    api.addPanel({
        id: 'sidebar', component: 'adopt', params: { adopt: 'sidebar' },
        position: { referencePanel: 'content', direction: 'left' },
        initialWidth: 240,
    });
    // NOTE: no 'debug' panel here — the drawer is added lazily (§4.5).
}
```

With the tab workspace of §3.4, the content group instead stays unlocked
with a visible header, and each dashboard tab adopts a fetched bare-dashboard
fragment (§3.4). That is client-initiated content, i.e. `details`-shaped:
`params: { src }`, the renderer fetches the fragment, inserts it and runs
`Alpine.initTree` — no third renderer needed. The sidebar click handler
calls `api.addPanel({ id: url, component: 'details', params: { src: url } })`
(focus instead of add when the panel exists).

Explore editor chrome — direct translation of today's grid; the drawer tabs
(Data / Go code / JSON) become three panels in one group, replacing the
hand-rolled tab strip:

```ts
function exploreLayout(api: DockviewApi) {
    api.addPanel({ id: 'preview',   component: 'adopt', params: { adopt: 'preview' } });
    api.addPanel({ id: 'tree',      component: 'adopt', params: { adopt: 'tree' },
        position: { referencePanel: 'preview', direction: 'left' },  initialWidth: 260 });
    api.addPanel({ id: 'inspector', component: 'adopt', params: { adopt: 'inspector' },
        position: { referencePanel: 'preview', direction: 'right' }, initialWidth: 320 });
    api.addPanel({ id: 'drawer-data',   component: 'adopt', params: { adopt: 'drawer-data' },
        title: 'Data', position: { referencePanel: 'preview', direction: 'below' },
        initialHeight: 240 });
    api.addPanel({ id: 'drawer-gocode', component: 'adopt', params: { adopt: 'drawer-gocode' },
        title: 'Go code', position: { referencePanel: 'drawer-data', direction: 'within' } });
    api.addPanel({ id: 'drawer-json',   component: 'adopt', params: { adopt: 'drawer-json' },
        title: 'JSON',    position: { referencePanel: 'drawer-data', direction: 'within' } });
}
```

`editor.ts` changes only its mount lookup: effects that today target
`querySelector('[data-explore="tree"]')` target the adopted element instead —
the headless-reactive design (§2.3 of the Explore doc) is otherwise untouched,
which is exactly why this integration is cheap there.

### 4.5 Debug drawer: lazy panel + popout

The drawer starts *absent* (dockview has no hidden-panel state worth
fighting). The chart wrench event creates it on first use; popout is one call:

```ts
// chart.ts wrench: dispatch on window instead of bubbling from $el
window.dispatchEvent(new CustomEvent('dashica-debugDrawer-toggle', { detail }));

// dock wiring
window.addEventListener('dashica-debugDrawer-toggle', () => {
    const existing = api.getPanel('debug');
    if (existing) { existing.api.close(); return; }         // toggle off
    api.addPanel({
        id: 'debug', component: 'adopt', params: { adopt: 'debug' },
        title: 'Debug', position: { referencePanel: 'content', direction: 'below' },
        initialHeight: 260,
    });
});

// "popout" button in the drawer: move its group to a browser window
api.addPopoutGroup(api.getPanel('debug')!.group);
```

Caveat to verify in a spike: `adopt` moves DOM *once*; closing and re-adding
the panel must re-adopt the same element (keep a reference in the adapter, do
not re-query — the node is no longer in the staging block).

### 4.6 Row-details panels (the `details` renderer)

Same event pattern as the debug drawer, but the content is client-side data
(§3.5), so it uses the second renderer. One live "details" panel that each
row click reuses; **pin** promotes it to a permanent panel and the next click
gets a fresh live one:

```ts
// details renderer: key/value list from the event payload — no server round trip
function detailsRenderer() {
    const element = document.createElement('div');
    element.className = 'dock-details';
    return {
        element,
        init({ params }: { params: { row: Record<string, unknown> } }) {
            element.replaceChildren(renderKeyValueList(params.row)); // htl, like the charts
        },
    };
}

// table widget (tabulator rowClick / context menu): dispatch, don't import the dock
window.dispatchEvent(new CustomEvent('dashica-row-details', { detail: { row } }));

// dock wiring: one reusable panel; pinning renames it out of the way
let pinCount = 0;
window.addEventListener('dashica-row-details', (e: CustomEvent) => {
    api.getPanel('details')?.api.close();
    api.addPanel({
        id: 'details', component: 'details', title: 'Row details',
        params: { row: e.detail.row },
        position: { referencePanel: 'content', direction: 'right' },
    });
});
window.addEventListener('dashica-row-details-pin', () => {
    api.getPanel('details')?.api.setTitle(`Pinned #${++pinCount}`);
    api.getPanel('details')?.api.updateParameters({ pinned: true });
    // panel keeps living under a new identity; next row click creates a fresh 'details'
});
```

(Exact pin mechanics — rename vs. close-and-recreate under a `pin-N` id —
is an implementation detail; the invariant is: *one* live details panel,
pinned ones are immortal until closed, comparison = two pinned panels side
by side.)

### 4.7 Theming

One CSS file mapping dockview's custom properties onto the existing daisyUI
variables — no fork of a dockview theme:

```css
.dockview-theme-dashica {
    --dv-group-view-background-color: var(--color-base-200);
    --dv-tabs-and-actions-container-background-color: var(--color-base-300);
    --dv-activegroup-visiblepanel-tab-background-color: var(--color-base-100);
    --dv-separator-border: var(--color-base-300);
    /* … the ~dozen --dv-* variables, once, shared by Explore + dashboards */
}
```

### 4.8 Spike checklist (before committing to any of this)

1. Adopt-before-`Alpine.start()` works for the search bar and charts
   (x-intersect/x-resize observers fire in panels).
2. Popout window: chart wrench → drawer in child window updates (same JS
   realm, but stylesheets must be mirrored — dockview handles its own; ours
   must be verified).
3. Panel scroll vs body scroll: sticky search bar inside the content panel.
4. `test.fail`-style e2e first: the Explore Playwright suite keys on
   `data-explore`/`data-dock-panel` attributes, which adoption preserves.

## 5. Implementation plan — shippable slices, in order

Same convention as the Explore doc: each slice ships alone, is E2E-verifiable,
and later slices depend only on earlier ones. Precondition for everything:
Explore **Step 1 (Playwright harness) is running** and the B1–B10 fixes are
in — a chrome rewrite without a browser test suite is how regressions hide.

### Slice A — `urlState` split (no dockview; do this regardless) — DONE 2026-07-22

The §3.4 time-vs-filter tear-apart. Pure store refactor, invisible on
existing pages, unblocks the workspace later.

**Implemented 2026-07-22.** `frontend/store.ts` now exports a global
`Alpine.store('timeState')` (timeRange, customDateRange, autoRefresh,
refreshInterval, logScale, `_refreshNonce`) + `createFilterScope(root,{syncUrl})`
(sqlFilter, widgetParams, addFilter) registered in a `WeakMap<Element,FilterScope>`
with `resolveScope(el)=registry.get(el.closest('[data-filter-scope]'))` and
`getCombinedFilter(el)=merge(timeState, resolveScope(el))`. URL split by disjoint
keys (timeState: time/range/refresh/log · scope: sql/wp), both read-modify-write
the same query string and only push a history entry when it changed. New
`frontend/components/filterScope.ts` Alpine component stamps the single page scope
(on `application__main` in default/docs pages); the Explore editor creates its own
scope on `.explore-editor` (data-filter-scope) in `editor.ts`. Consumers updated:
chart.ts, searchBar.js (time→timeState, filter→scope getters), textInput/
checkboxGroup/speedscopeLink (resolveScope), filterButton.js + table.ts
(`dashica-add-filter` now bubbles from the element, caught+stopped at the scope
root). `dashica-set-time` stays window-level (global time). SearchBar.templ +
editor.templ bindings retargeted. **Requires `templ generate` + frontend esbuild
rebuild** (user runs the build).

1. `frontend/store.ts`: split into `Alpine.store('timeState')`
   (timeRange, customDateRange, autoRefresh, refreshInterval, logScale,
   `_refreshNonce`) and a `createFilterScope()` factory (sqlFilter,
   widgetParams, addFilter). Keep a scope registry:
   `WeakMap<Element, FilterScope>` + `resolveScope(el) =
   registry.get(el.closest('[data-filter-scope]'))`.
2. Classic pages: `default_page.templ` / `docs_page.templ` stamp
   `data-filter-scope` on the page root; `index.js` creates the single scope
   at boot. URL read/write stays in one place (the scope + timeState both
   serialize into the same `URLSearchParams` — param names `sql`, `wp`,
   `time`, `range`, `refresh`, `log` unchanged).
3. Consumers: `chart.ts` `getCombinedFilter()` → `merge(timeState,
   resolveScope(this.$el))`; `searchBar` writes time state globally, filter
   state to its nearest scope; `filterButton` / `dashica-add-filter` /
   `dashica-set-time` switch from `window` dispatch to **bubbling** dispatch
   caught at the scope root (time events keep bubbling up to a window-level
   timeState listener).
4. Done when: existing dashboard e2e passes unchanged; URL round-trip
   identical (snapshot the query string before/after); Explore preview strip
   still drives preview cards.

### Slice B — dockview spike (time-boxed, throwaway branch)

Buy information, not features. `npm i dockview-core`, hack the Explore page
only, answer §4.8:

1. adopt-before-`Alpine.start()`: search bar + one chart inside panels;
   x-intersect/x-resize fire; time strip drives charts.
2. popout window: our stylesheets present, chart renders, wrench event
   arrives.
3. panel scroll: content panel scrolls, nothing sticky breaks.
4. bundle cost measured (esbuild metafile before/after).

**Decision gate:** all four green → proceed C–F; any red without cheap
workaround → stop, fall back to CSS-resize plan, keep Slices A and F′
(row details as plain overlay) — the doc's earlier verdicts remain honest.

### Slice C — Explore editor chrome on dockview

1. `frontend/components/dock.ts` (§4.2): adapter, `adopt` renderer,
   `initDock`, autosave, `STATE_VERSION`.
2. `lib/explore/editor.templ`: five mount points → staging block
   (`data-dock-panel` = tree / preview-controls / preview / inspector /
   drawer-data / drawer-gocode / drawer-json); keep `data-explore`
   attributes on the inner elements (e2e keys on them).
3. `frontend/explore/editor.ts`: mount lookup via adapter
   (`dock.panelElement(id)`); delete the hand-rolled drawer tab strip
   (three panels in one group now, §4.4); preview-controls = locked
   header-less panel above preview (§2.1).
4. `explore.css`: delete the shell grid; add `dockview-theme-dashica`
   (§4.7).
5. Done when: Explore e2e green; layout survives reload (localStorage);
   reset-layout button exists (drop the storage key, rebuild default).

### Slice D — dashboard chrome (`defaultPage`)

1. `default_page.templ`: `MainApplication` grid → staging block (sidebar /
   searchbar / content / debug), `initDashboardDock()` before
   `Alpine.start()`; `docsPage` untouched.
2. `dashboardLayout` (§4.4): locked header-less content group; search bar as
   its own fixed locked panel above content (kills the sticky-scroll
   question, §2.1); sidebar panel.
3. Debug drawer: lazy panel + window-level toggle event (§4.5, incl. the
   re-adopt-kept-reference caveat); popout button in the drawer header.
4. Done when: every dev-server example dashboard renders identically
   (screenshot diff), wrench → drawer → popout works, anchors/print
   re-checked.

### Slice E — workspace tabs (needs A + D)

1. Go: bare-fragment rendering — reuse the dashboard's existing route with a
   layout variant (e.g. `?fragment=1` or an `HX-style` header): content +
   per-dashboard filter row, no `<html>`/sidebar. Small change in
   `defaultPageFn` selection, no new handler logic.
2. `dock.ts`: `details`-shaped panel with `params:{src}` — fetch fragment,
   insert, `data-filter-scope` + fresh `FilterScope` on the panel root,
   `Alpine.initTree` (§4.4 note). Sidebar clicks intercepted in the shell:
   `addPanel({id: url, …})` or focus existing.
3. Shell toolbar: global time controls rendered once (they exist — the
   Explore preview strip is the template); per-panel filter rows come with
   the fragment.
4. Focused-tab URL mirroring (`history.replaceState`); visibility-gated
   auto-refresh (panel visible ⇒ refresh; dockview panel-visibility API or
   x-intersect); id-collision audit (open the same dashboard twice in the
   spike of this slice, fix lookups to container-scoped).
5. Done when: two dashboards side by side, one time range, independent
   filters, deep link restores the workspace.

### Slice F — row details + pinnable details (needs D)

1. Table widget (tabulator): row click / context menu → bubbling
   `dashica-row-details` with row payload; same menu hosts B6
   "filter from data".
2. `dock.ts`: `details` renderer (key/value via `htl`, §4.6); one live
   panel, pin action promotes (rename or re-id), next click spawns a fresh
   live panel.
3. Data-tab sample rows in Explore get the same affordance (B6/B7 synergy).
4. Done when: click row → panel; pin two rows → side-by-side compare;
   popout works.

Effort shape (relative): A ≈ C ≈ D < F < E; B is a day-box. A is worth doing
even if B kills the rest.

## 6. Summary

| Surface | Dockview? | Why |
|---|---|---|
| Explore editor chrome (tree/preview/inspector/drawer panes) | **Maybe, later** | Real IDE; imperative pane-filling maps 1:1 onto dockview panels; resize/maximize/popout for free. After E2E + B-fixes; check whether CSS resize is enough first. |
| Explore preview canvas | **No** | Preview must stay WYSIWYG of the compiled rendering path; split trees can't express all grid layouts. |
| Normal dashboards (widget grid) | **No** | Split-tree ⊂ grid-template-areas (guillotine-only); kills SSR/progressive enhancement; runtime rearrangement contradicts Go-as-source-of-truth; documents, not workspaces. |
| Normal dashboards (chrome: sidebar / debug drawer) | **Only bundled with Explore chrome** | Popout debug drawer is the real win (hard to hand-roll); content stays one locked SSR panel; too heavy for two panes alone — adopt for both surfaces or neither. |
| Dashboard tabs / combine two dashboards (§3.4) | **Wanted** | Tab group of adopted bare-SSR-dashboard fragments (Explore preview pattern, one level up); shared time range via the global urlState comes free; no cheap CSS alternative — the strongest dashboard-side argument for dockview. |
| Table row details + pinnable details panels (§3.5) | **Wanted** | Details panels are chrome (like debug drawer); row data already client-side; pin → side-by-side row comparison. |

With §3.4 and §3.5 confirmed as wanted, the adoption question flips from
"is a docking library worth it for resizable panes?" (no) to "we want tabs,
popouts and pinnable panels — is dockview the cheapest way to get them?"
(plausibly yes). The order still stands: Explore Step 1 (E2E) and the
B-fixes first, then the §4.8 spike, then a decision.