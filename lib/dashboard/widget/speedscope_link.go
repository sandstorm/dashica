package widget

import (
	"context"
	"encoding/json"
	"fmt"
	"html"
	"io"
	"io/fs"
	"net/http"

	"github.com/a-h/templ"
	"github.com/sandstorm/dashica/lib/clickhouse"
	"github.com/sandstorm/dashica/lib/dashboard/rendering"
	"github.com/sandstorm/dashica/lib/dashboard/sql"
	"github.com/sandstorm/dashica/lib/httpserver"
	"github.com/sandstorm/dashica/lib/util/handler_collector"
	"github.com/sandstorm/dashica/speedscope_viewer"
)

// SpeedscopeLink renders an "Open Speedscope" link that, when clicked, opens the bundled
// Speedscope flame-graph viewer pointed at this widget's per-instance speedscope-query
// endpoint. The query body is a sql.SqlQueryable just like chart widgets — customer/project
// constants belong in WHERE clauses, user-driven values flow through $store.urlState.widgetParams.
type SpeedscopeLink struct {
	sqlQuery sql.SqlQueryable
	title    string
	id       string
}

func NewSpeedscopeLink(query sql.SqlQueryable) *SpeedscopeLink {
	return &SpeedscopeLink{sqlQuery: query}
}

func (s *SpeedscopeLink) Title(title string) *SpeedscopeLink {
	cloned := *s
	cloned.title = title
	return &cloned
}

func (s *SpeedscopeLink) Id(id string) *SpeedscopeLink {
	cloned := *s
	cloned.id = id
	return &cloned
}

func (s *SpeedscopeLink) BuildComponents(ctx *rendering.DashboardContext) (templ.Component, error) {
	if len(s.id) == 0 {
		s.id = ctx.NextWidgetId()
	}
	widgetBaseUrl := ctx.CurrentHandlerUrl + "/api/" + s.id

	title := s.title
	if title == "" {
		title = "Open Speedscope"
	}

	htmlOut := fmt.Sprintf(`
<div class="my-4" x-data="speedscopeLink" data-widget-base-url="%s">
  <a target="_blank" :href="href()" class="btn btn-primary btn-sm">%s</a>
</div>
`,
		html.EscapeString(widgetBaseUrl),
		html.EscapeString(title),
	)

	return templ.ComponentFunc(func(_ context.Context, w io.Writer) error {
		_, err := io.WriteString(w, htmlOut)
		return err
	}), nil
}

func (s *SpeedscopeLink) CollectHandlers(ctx *rendering.DashboardContext, registerHandler handler_collector.HandlerCollector) error {
	if len(s.id) == 0 {
		s.id = ctx.NextWidgetId()
	}

	deps := ctx.Deps
	query := s.sqlQuery
	if err := registerHandler.Handle(s.id+"/speedscope-query", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := serveSpeedscope(query, deps, w, r); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
		}
	})); err != nil {
		return err
	}

	viewerFS, err := fs.Sub(speedscope_viewer.FS, "dist")
	if err != nil {
		return fmt.Errorf("subbing speedscope viewer FS: %w", err)
	}
	viewerPrefix := ctx.CurrentHandlerUrl + "/api/" + s.id + "/viewer"
	return registerHandler.Handle(s.id+"/viewer/",
		http.StripPrefix(viewerPrefix, http.FileServerFS(viewerFS)))
}

// serveSpeedscope runs the query and streams the result as space-delimited CSV — the format
// Speedscope's profileURL ingestor expects.
func serveSpeedscope(query sql.SqlQueryable, deps rendering.Dependencies, w http.ResponseWriter, r *http.Request) error {
	client, err := deps.ClickhouseClientManager.GetClient("default")
	if err != nil {
		return fmt.Errorf("get clickhouse client: %w", err)
	}

	opts := clickhouse.DefaultQueryOptions()
	opts.Format = "CSV"
	opts.Settings["format_custom_field_delimiter"] = " "
	opts.Settings["date_time_input_format"] = "best_effort"

	if paramsStr := r.URL.Query().Get("params"); paramsStr != "" {
		var params map[string]string
		if err := json.Unmarshal([]byte(paramsStr), &params); err != nil {
			return fmt.Errorf("unmarshalling params: %w", err)
		}
		opts.Parameters = params
	}

	q := query
	if rawFilters := r.URL.Query().Get("filters"); rawFilters != "" && !query.ShouldSkipFilters() {
		var filters httpserver.DashboardFilters
		if err := json.Unmarshal([]byte(rawFilters), &filters); err != nil {
			return fmt.Errorf("unmarshalling filters: %w", err)
		}
		if clause := filters.SqlClause(); clause != "" {
			q = query.With(sql.Where(clause))
		}
		resolvedTimeRange, err := filters.ResolveTimeRangeFromDbAsTime(r.Context(), client)
		if err != nil {
			return fmt.Errorf("resolving time range: %w", err)
		}
		opts.Parameters["__from"] = fmt.Sprintf("%d", *resolvedTimeRange.From/1000)
		opts.Parameters["__to"] = fmt.Sprintf("%d", *resolvedTimeRange.To/1000)
	}

	if err := client.QueryToHandler(r.Context(), q.Build(), opts, w); err != nil {
		return fmt.Errorf("clickhouse query: %w", err)
	}
	return nil
}

var _ InteractiveWidget = (*SpeedscopeLink)(nil)
