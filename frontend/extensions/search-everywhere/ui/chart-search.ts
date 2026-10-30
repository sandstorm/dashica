// See searchEverywhere in ../search-everywhere.ts.
import type { PageApi } from '../../../hosts/page/page';
import type { SearchItem, SearchProvider } from '../../../hosts/ui/ui';
import { fuzzyMatch } from '../model/fuzzy';

/**
 * "Charts": every chart in the outlines of `workbench.json`'s menu as "Shop › Details › Requests" (its page, its
 * collapsible group, its title), matched fuzzily; the page shown first, then the other pages, each best match first.
 * Picking one opens its page at the chart (`/p/shop#w=3`).
 */
export function chartSearch(page: Pick<PageApi, 'workbench' | 'navigate'>): SearchProvider {
  const charts = page.workbench.menu.flatMap((group) =>
    group.entries.flatMap((entry) =>
      entry.outline.map((chart) => ({
        url: entry.url,
        id: chart.id,
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
      for (const { url, id, label } of charts) {
        const match = fuzzyMatch(query, label);
        if (!match) continue;
        const item = { label, highlights: { label: match.ranges }, accept: () => page.navigate(`${url}#w=${encodeURIComponent(id)}`) };
        found.push({ item, shown: url === location.pathname, score: match.score });
      }
      return found.sort((a, b) => Number(b.shown) - Number(a.shown) || b.score - a.score).map(({ item }) => item);
    },
  };
}
