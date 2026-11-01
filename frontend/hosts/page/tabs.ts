// See PageApi in page.ts.

/** An open tab: the URL of the page it shows (path, query and hash: `/p/shop?time=1h#w=3`) and what the tab bar says. */
export interface Tab {
  /** Unique among the tabs of the browser tab; history entries name it (`history.state.tab`). */
  readonly id: string;
  readonly url: string;
  readonly title: string;
}

/**
 * The open tabs as a value: their order in the tab bar, the active one, and which were shown last. The functions
 * below each give the list after one change; the `page` host makes the rest follow (a page per tab, the address
 * bar). There is always one tab.
 */
export interface TabList {
  readonly tabs: readonly Tab[];
  /** The id of the tab shown. */
  readonly active: string;
  /** The ids of all tabs, the one shown last first: who becomes active after a close, who goes beyond the limit. */
  readonly recent: readonly string[];
}

/** At most this many tabs are open; opening one more closes the one shown least recently. */
export const TAB_LIMIT = 10;

/** The list of only `tab`. */
export function singleTab(tab: Tab): TabList {
  return { tabs: [tab], active: tab.id, recent: [tab.id] };
}

/**
 * Opens `tab` after the active one and shows it; a tab with the same URL that is open already is shown instead. Beyond
 * `limit` the tabs shown least recently are closed.
 */
export function openTab(list: TabList, tab: Tab, limit = TAB_LIMIT): TabList {
  const open = list.tabs.find((candidate) => candidate.url === tab.url);
  if (open) return showTab(list, open.id);
  const at = list.tabs.findIndex((candidate) => candidate.id === list.active) + 1;
  let opened: TabList = { tabs: [...list.tabs.slice(0, at), tab, ...list.tabs.slice(at)], active: tab.id, recent: [tab.id, ...list.recent] };
  while (opened.tabs.length > Math.max(limit, 1)) opened = closeTab(opened, opened.recent[opened.recent.length - 1]);
  return opened;
}

/** Shows the tab `id`; an id not open changes nothing. */
export function showTab(list: TabList, id: string): TabList {
  if (!list.tabs.some((tab) => tab.id === id)) return list;
  return { ...list, active: id, recent: [id, ...list.recent.filter((other) => other !== id)] };
}

/** Closes the tab `id`; when it was shown, the one shown before it becomes active. The last tab stays open. */
export function closeTab(list: TabList, id: string): TabList {
  if (list.tabs.length < 2 || !list.tabs.some((tab) => tab.id === id)) return list;
  const recent = list.recent.filter((other) => other !== id);
  return { tabs: list.tabs.filter((tab) => tab.id !== id), active: list.active === id ? recent[0] : list.active, recent };
}

/** The tab `id` with `change` (its URL changed, the page gave its title). */
export function updateTab(list: TabList, id: string, change: Partial<Pick<Tab, 'url' | 'title'>>): TabList {
  return { ...list, tabs: list.tabs.map((tab) => (tab.id === id ? { ...tab, ...change } : tab)) };
}

/** The id of the tab `step` places after the tab `id` in `tabs` (`-1`: before), round the end. */
export function adjacentTab(tabs: readonly Tab[], id: string, step: 1 | -1): string {
  const at = tabs.findIndex((tab) => tab.id === id);
  return tabs[(at + step + tabs.length) % tabs.length].id;
}

/**
 * What survives a reload of the browser tab (sessionStorage): the tabs `kept` (default all; the page host leaves out a
 * popped-out view's tab) in their order, and the active one, else the one of them shown last.
 */
export function storedTabs(list: TabList, kept: (tab: Tab) => boolean = () => true): { tabs: readonly Tab[]; active: string } {
  const tabs = list.tabs.filter(kept);
  return { tabs, active: list.recent.find((id) => tabs.some((tab) => tab.id === id)) ?? '' };
}

/**
 * The tabs after a reload: those `stored` (by `storedTabs`, or anything: what fails the check is left out), `url` (the
 * address bar's) in the tab `entryTab` its history entry names, else in the active one, which is shown. Without stored
 * tabs, one tab `newId` of `url`.
 */
export function restoreTabs(stored: unknown, url: string, entryTab: string | undefined, newId: string): TabList {
  const valid = isStored(stored) ? stored : { tabs: [], active: '' };
  const tabs = valid.tabs.filter((tab, i) => valid.tabs.findIndex((other) => other.id === tab.id) === i).slice(0, TAB_LIMIT);
  const shown = tabs.find((tab) => tab.id === entryTab) ?? tabs.find((tab) => tab.id === valid.active);
  if (!shown) return singleTab({ id: newId, url, title: titleOf(url) });
  const restored = tabs.map((tab) => (tab.id === shown.id && tab.url !== url ? { ...tab, url, title: titleOf(url) } : tab));
  return { tabs: restored, active: shown.id, recent: [shown.id, ...restored.map((tab) => tab.id).filter((id) => id !== shown.id)] };
}

/** What a tab says while its page has no title (loading, failed): the URL's path. */
export function titleOf(url: string): string {
  return new URL(url, 'http://dashica').pathname;
}

function isStored(value: unknown): value is { tabs: Tab[]; active: string } {
  if (typeof value !== 'object' || value === null) return false;
  const { tabs, active } = value as { tabs?: unknown; active?: unknown };
  return (
    typeof active === 'string' &&
    Array.isArray(tabs) &&
    tabs.every((tab) => typeof tab?.id === 'string' && typeof tab?.url === 'string' && typeof tab?.title === 'string')
  );
}
