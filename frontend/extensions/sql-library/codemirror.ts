// See SqlEditors in sql-editor.ts. The entry of the bundle public/dist/sql-editor.js (frontendBuild.mjs), which
// `loadSqlEditors` imports on first use, so dashboards load none of CodeMirror.
import { autocompletion, closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap, insertNewlineAndIndent } from '@codemirror/commands';
import { SQLDialect, sql } from '@codemirror/lang-sql';
import { HighlightStyle, bracketMatching, syntaxHighlighting } from '@codemirror/language';
import { Compartment, EditorState, Prec } from '@codemirror/state';
import { EditorView, keymap, placeholder } from '@codemirror/view';
// a dependency of @codemirror/language, where CodeMirror documents `tags` from
import { tags } from '@lezer/highlight';
import { EventEmitter } from '../../core/event-emitter/event-emitter';
import type { SqlCompletion, SqlEditor, SqlEditorOptions, SqlEditors } from './sql-editor';

/**
 * CodeMirror's default keys but Escape (its simplifySelection): Escape belongs to the completion and to what holds the
 * editor, so a single Escape closes the input box even while its prefilled text is selected.
 */
const DEFAULT_KEYS = defaultKeymap.filter((binding) => binding.key !== 'Escape');

/** ClickHouse's statements, clauses and operators that read as words (its SQL reference). */
const KEYWORDS =
  'add after alias all alter and anti any array as asc asof attach between both by case cast cluster codec collate ' +
  'column comment constraint create cross cube database databases default delete desc describe detach dictionary ' +
  'distinct div drop else end engine exchange exists explain fill final first for format from full function global ' +
  'grant granularity group having if ilike in index inner insert interpolate interval into is join key kill last ' +
  'left like limit live local materialized mod modify move not nulls offset on optimize or order outer over partition ' +
  'prewhere primary projection qualify rename replace revoke right rollup sample select semi settings show step ' +
  'system table tables temporary then ties to top totals truncate ttl union update use using values view when where ' +
  'window with';

/** ClickHouse's data types, as it writes them: its type names are case sensitive. */
const TYPES =
  'UInt8 UInt16 UInt32 UInt64 UInt128 UInt256 Int8 Int16 Int32 Int64 Int128 Int256 Float32 Float64 BFloat16 Decimal ' +
  'Decimal32 Decimal64 Decimal128 Decimal256 Bool String FixedString UUID Date Date32 DateTime DateTime64 Time Time64 ' +
  'Enum Enum8 Enum16 LowCardinality Array Tuple Map Nullable Nested IPv4 IPv6 JSON Dynamic Variant Point Ring ' +
  'LineString MultiLineString Polygon MultiPolygon AggregateFunction SimpleAggregateFunction Nothing';

/** ClickHouse's functions a dashboard's SQL uses most, as it writes them (its function names are mostly case sensitive). */
const FUNCTIONS =
  'count countIf sum sumIf avg avgIf min max uniq uniqExact any anyLast argMax argMin quantile quantiles quantileExact ' +
  'groupArray groupUniqArray topK if multiIf coalesce ifNull isNull isNotNull toString toInt64 toUInt64 toFloat64 ' +
  'toDate toDateTime toDateTime64 toStartOfInterval toStartOfMinute toStartOfHour toStartOfDay toStartOfWeek ' +
  'toStartOfMonth toUnixTimestamp now now64 today yesterday dateDiff formatDateTime parseDateTimeBestEffort ' +
  'toIntervalSecond toIntervalMinute toIntervalHour toIntervalDay length lower upper concat substring position ' +
  'positionCaseInsensitive match extract replaceAll replaceRegexpAll splitByChar startsWith endsWith arrayJoin has ' +
  'hasAny arrayMap arrayFilter arrayElement JSONExtract JSONExtractString JSONExtractInt JSONExtractFloat ' +
  'JSONExtractBool JSONHas JSONExtractRaw round floor ceil abs intDiv greatest least';

/** Each word of the dialect lowercased (as lang-sql keeps them) to the way it is written: a type or function as ClickHouse writes it. */
const WRITTEN = new Map([...TYPES.split(' '), ...FUNCTIONS.split(' ')].map((word) => [word.toLowerCase(), word]));

/**
 * ClickHouse's dialect for lang-sql: its words; identifiers quoted with backticks or double quotes, strings with single
 * quotes only, a backslash escaping in them; `#`, `--` and `/* … *\/` comments; `{name:Type}` placeholders read as
 * braces. Identifiers count as case insensitive for completion only: ClickHouse takes an unquoted `Status` as it is,
 * so a completed name needs no quotes for its capitals.
 */
export const CLICKHOUSE = SQLDialect.define({
  keywords: KEYWORDS,
  types: TYPES.toLowerCase(),
  builtin: FUNCTIONS.toLowerCase(),
  backslashEscapes: true,
  hashComments: true,
  identifierQuotes: '`"',
  caseInsensitiveIdentifiers: true,
});

/** The colours of the SQL's parts: tokens of tokens.css, so they follow the page's colour scheme. */
const HIGHLIGHT = HighlightStyle.define([
  { tag: tags.keyword, color: 'var(--color-code-keyword)' },
  { tag: [tags.typeName, tags.standard(tags.name)], color: 'var(--color-code-name)' },
  { tag: [tags.string, tags.special(tags.string)], color: 'var(--color-code-string)' },
  { tag: [tags.number, tags.bool, tags.null], color: 'var(--color-code-number)' },
  { tag: [tags.lineComment, tags.blockComment], color: 'var(--color-code-comment)', fontStyle: 'italic' },
]);

/** The editor's look, as the page's fields (`d-field d-field--mono`) and popovers: tokens of tokens.css. */
const THEME = EditorView.theme({
  '&': {
    border: 'var(--border-width) solid var(--color-border-strong)',
    borderRadius: 'var(--radius-md)',
    background: 'var(--color-surface-raised)',
    color: 'var(--color-text)',
    fontSize: 'var(--text-sm)',
  },
  '&.cm-focused': { outline: '2px solid var(--color-accent)', outlineOffset: '-1px' },
  '.cm-scroller': { fontFamily: 'var(--font-mono)', lineHeight: 'var(--leading)' },
  '.cm-content': { padding: 'var(--space-1) 0', caretColor: 'var(--color-text)' },
  '.cm-line': { padding: '0 var(--control-padding-x)' },
  '.cm-placeholder': { color: 'var(--color-text-muted)' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': { background: 'var(--color-accent-subtle)' },
  '.cm-tooltip': {
    border: 'var(--border-width) solid var(--color-border)',
    borderRadius: 'var(--radius-md)',
    background: 'var(--color-surface-raised)',
    color: 'var(--color-text)',
    boxShadow: 'var(--shadow-popover)',
  },
  '.cm-tooltip.cm-tooltip-autocomplete > ul': { fontFamily: 'var(--font-mono)', fontSize: 'var(--text-sm)' },
  '.cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]': { background: 'var(--color-accent-subtle)', color: 'var(--color-text)' },
  '.cm-completionDetail': { color: 'var(--color-text-muted)' },
  '.cm-matchingBracket': { background: 'var(--color-accent-subtle)' },
});

/** The language with `completion`: a keyword completes in capitals, a type or function as ClickHouse writes it. */
function language(completion: SqlCompletion | undefined) {
  return sql({
    dialect: CLICKHOUSE,
    ...completion,
    keywordCompletion: (label, type) => ({ label: WRITTEN.get(label) ?? label.toUpperCase(), type }),
  });
}

/** The SQL editors of Dashica: CodeMirror 6 with the ClickHouse dialect, its completion, history and brackets. */
export const sqlEditors: SqlEditors = {
  create(options: SqlEditorOptions): SqlEditor {
    const changed = new EventEmitter<void>();
    const accepted = new EventEmitter<void>();
    const accept = () => (accepted.fire(), true);
    const completion = new Compartment();
    const view = new EditorView({
      state: EditorState.create({
        doc: options.value ?? '',
        extensions: [
          history(),
          closeBrackets(),
          bracketMatching(),
          autocompletion(),
          completion.of(language(options.completion)),
          syntaxHighlighting(HIGHLIGHT),
          THEME,
          EditorView.lineWrapping,
          placeholder(options.placeholder ?? ''),
          EditorView.contentAttributes.of({ 'aria-label': options.label, ...(options.testId ? { 'data-testid': options.testId } : {}) }),
          // after the completion's keys (its own, highest), before the default ones
          Prec.high(
            keymap.of([
              { key: 'Mod-Enter', run: accept },
              ...(options.enterAccepts ? [{ key: 'Enter', run: accept }, { key: 'Shift-Enter', run: insertNewlineAndIndent }] : []),
            ]),
          ),
          keymap.of([...closeBracketsKeymap, ...DEFAULT_KEYS, ...historyKeymap]),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) changed.fire();
          }),
        ],
      }),
    });
    return {
      element: view.dom,
      input: view.contentDOM,
      get value() {
        return view.state.doc.toString();
      },
      set value(text: string) {
        if (text !== view.state.doc.toString()) view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
      },
      select(start, end) {
        view.dispatch({ selection: { anchor: Math.min(start, view.state.doc.length), head: Math.min(end, view.state.doc.length) } });
      },
      focus: () => view.focus(),
      setCompletion: (next) => view.dispatch({ effects: completion.reconfigure(language(next)) }),
      onDidChangeValue: changed.event,
      onDidAccept: accepted.event,
      dispose() {
        changed.dispose();
        accepted.dispose();
        view.destroy();
      },
    };
  },
};
