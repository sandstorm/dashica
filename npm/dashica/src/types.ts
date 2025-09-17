import type {TipPointer as _TipPointer, Data as _Data} from "@observablehq/plot/src/mark";

import type {TipOptions as _TipOptions} from "@observablehq/plot/src/marks/tip";

import type {PointerOptions as _PointerOptions} from "@observablehq/plot/src/interactions/pointer";
import type {ChannelValueSpec as _ChannelValueSpec} from "@observablehq/plot/src/channel";
import type {ChannelValue as _ChannelValue} from "@observablehq/plot/src/channel";
import type {Table} from "apache-arrow";

// add extra types with | ... here
// NOTE: if adding new values here, add them to viewOptions.ts for choosing
type ViewOption = 'VIEW_LOGARITHMIC';
export type ViewOptions = ViewOption[];

type QueryResultMetadata = {
    // the servers opinion about the selected time range (if any)
    dashicaResolvedTimeRange?: {
        from: number,
        to: number,
    }

    // the servers opinion about the bucket size (if any)
    dashicaBucketSize?: number|null

    clickhouseSummary?: any

    dashicaAlertIf?: {
        value_gt?: number|null
        value_lt?: number|null
    }

    dashicaDevmode?: boolean
}

/**
 * QueryResult is the main result type of our ClickHouse query function.
 *
 * It is an iterable (= an array) of result rows in (Tidy Data)[https://tidyr.tidyverse.org/articles/tidy-data.html]
 * format. To quote the (docs)[https://observablehq.com/plot/features/marks#marks-have-tidy-data]:
 * > Plot favors tidy data:
 * > - structured as an array of objects,
 * > - where each object represents an observation (a row),
 * > - and each object property represents an observed value
 * > - all objects in the array should have the same property names (the columns).
 *
 * We extend this array/iterable with extra *Metadata* (which is all optional).
 * This way, the charting step can use some information known only at query time,
 * such as the SQL query (for debugging).
 */
export type QueryResult = _Data & QueryResultMetadata & Table<any>;

export type TipPointer = _TipPointer;
export type TipOptions = _TipOptions;
export type PointerOptions = _PointerOptions;
export type ChannelValueSpec = _ChannelValueSpec;
export type ChannelValue = _ChannelValue;
export type ChartComponent<TProps> = (data: QueryResult, props: TProps) => Promise<SVGSVGElement | HTMLElement>;
