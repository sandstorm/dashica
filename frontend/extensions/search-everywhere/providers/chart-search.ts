// See searchEverywhere in ../search-everywhere.ts.
import type { PageApi } from '../../../hosts/page/page';
import type { SearchItem, SearchProvider } from '../../../hosts/ui/ui';
import { fuzzyMatch } from '../../../core/fuzzy/fuzzy';

/**
 * "Charts": every chart in the outlines of `workbench.json`'s menu as "Shop › Details › Requests" (its page, its
 * collapsible group, its title), matched fuzzily; the active tab's page first, then the other pages, each best match
 * first. Picking one opens its page at the chart (`/p/shop#w=3`), with Cmd / Ctrl+Enter in a new tab.
 */
export function chartSearch(page: Pick<PageApi, 'workbench' | 'navigate' | 'activeTab'>): SearchProvider {
  const charts = page.workbench.menu.flatMap((group) =>
    group.entries.flatMap((entry) =>
      entry.outline.map((chart) => ({
        url: entry.url,
        id: chart.dataUrl.split('/').pop()!,
        label: [entry.title, chart.group, chart.title].filter(Boolean).join(' › '),
      })),
    ),
  );
  return {
    id: 'searchEverywhere.charts',
    label: 'Charts',
    order: 20,
    provideItems: (query) => {
      const found: { item: SearchItem; shown: boolean; score: number }[] = [];
      const shownPath = new URL(page.activeTab.url, location.origin).pathname;
      for (const { url, id, label } of charts) {
        const match = fuzzyMatch(query, label);
        if (!match) continue;
        const item: SearchItem = {
          label,
          highlights: { label: match.ranges },
          accept: (options) => page.navigate(`${url}#w=${encodeURIComponent(id)}`, options),
        };
        found.push({ item, shown: url === shownPath, score: match.score });
      }
      return found.sort((a, b) => Number(b.shown) - Number(a.shown) || b.score - a.score).map(({ item }) => item);
    },
  };
}
