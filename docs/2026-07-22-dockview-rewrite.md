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
  Alpine `searchBar`) is currently server-rendered markup inside the shell.
  With dockview the shell becomes JS-created; the templ fragment would need
  to render into a hidden container that the preview panel adopts (and
  `Alpine.initTree` it), or the strip gets rebuilt in JS. Solvable, but it is
  the one place server markup and dockview ownership meet.
- Alpine CSP build: irrelevant — dockview is a plain DOM library, no
  expression evaluation.

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
  verdict above are untouched.

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

### 3.4 The one dashboard-adjacent idea worth keeping in the back pocket

A **monitoring workspace** view: compose *existing* dashboards (or single
widgets) side-by-side in tabs/splits, popout to a second monitor, layout
saved client-side. That uses dockview for what it is (a workspace shell
around iframes/fragments of untouched SSR dashboards), touches zero rendering
code, and doesn't compete with the Go layout model. Not planned, not
requested — recorded here so a future "can I put two dashboards next to each
other" request finds the right shape instead of a dashboard rewrite.

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

1. **One panel component, ever: `adopt`.** No per-panel renderer classes.
   A panel is always "move this server-rendered element in here". Panel
   content therefore stays in templ, reviewable in Go, styled by the existing
   CSS pipeline.
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

### 4.6 Theming

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

### 4.7 Spike checklist (before committing to any of this)

1. Adopt-before-`Alpine.start()` works for the search bar and charts
   (x-intersect/x-resize observers fire in panels).
2. Popout window: chart wrench → drawer in child window updates (same JS
   realm, but stylesheets must be mirrored — dockview handles its own; ours
   must be verified).
3. Panel scroll vs body scroll: sticky search bar inside the content panel.
4. `test.fail`-style e2e first: the Explore Playwright suite keys on
   `data-explore`/`data-dock-panel` attributes, which adoption preserves.

## 5. Summary

| Surface | Dockview? | Why |
|---|---|---|
| Explore editor chrome (tree/preview/inspector/drawer panes) | **Maybe, later** | Real IDE; imperative pane-filling maps 1:1 onto dockview panels; resize/maximize/popout for free. After E2E + B-fixes; check whether CSS resize is enough first. |
| Explore preview canvas | **No** | Preview must stay WYSIWYG of the compiled rendering path; split trees can't express all grid layouts. |
| Normal dashboards (widget grid) | **No** | Split-tree ⊂ grid-template-areas (guillotine-only); kills SSR/progressive enhancement; runtime rearrangement contradicts Go-as-source-of-truth; documents, not workspaces. |
| Normal dashboards (chrome: sidebar / debug drawer) | **Only bundled with Explore chrome** | Popout debug drawer is the real win (hard to hand-roll); content stays one locked SSR panel; too heavy for two panes alone — adopt for both surfaces or neither. |
| Future "workspace of dashboards" mode | Back pocket | The only dashboard-adjacent use that plays to dockview's strengths without touching the rendering model. |
