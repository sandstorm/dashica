package widget

import (
	"net/http"
	"strings"
	"testing"

	"github.com/sandstorm/dashica/lib/dashboard/rendering"
	"github.com/sandstorm/dashica/lib/dashboard/sql"
	"github.com/sandstorm/dashica/lib/util/handler_collector"
)

func TestSpeedscopeLink_RendersCSPFriendlyMarkup(t *testing.T) {
	w := NewSpeedscopeLink(sql.New(sql.From("profiling_traces"))).
		Title("Open Speedscope").
		Id("widget-1")

	out := renderComponent(t, w)
	mustContain(t, out, `x-data="speedscopeLink"`)
	mustContain(t, out, `data-widget-base-url="/d/api/widget-1"`)
	mustContain(t, out, `:href="href()"`)
	mustContain(t, out, `target="_blank"`)
	mustContain(t, out, `Open Speedscope`)
}

func TestSpeedscopeLink_DefaultTitle(t *testing.T) {
	w := NewSpeedscopeLink(sql.New(sql.From("t"))).Id("w")
	out := renderComponent(t, w)
	mustContain(t, out, `Open Speedscope`)
}

func TestSpeedscopeLink_AutoGeneratesId(t *testing.T) {
	w := NewSpeedscopeLink(sql.New(sql.From("t")))
	ctx := &rendering.DashboardContext{CurrentHandlerUrl: "/d"}
	if _, err := w.BuildComponents(ctx); err != nil {
		t.Fatalf("BuildComponents: %v", err)
	}
	if w.id == "" {
		t.Error("expected auto-generated id")
	}
}

func TestSpeedscopeLink_RegistersHandler(t *testing.T) {
	w := NewSpeedscopeLink(sql.New(sql.From("t"))).Id("widget-7")
	rec := newRecordingCollector()
	ctx := &rendering.DashboardContext{CurrentHandlerUrl: "/d"}
	if err := w.CollectHandlers(ctx, rec); err != nil {
		t.Fatalf("CollectHandlers: %v", err)
	}
	if _, ok := rec.handlers["widget-7/speedscope-query"]; !ok {
		var keys []string
		for k := range rec.handlers {
			keys = append(keys, k)
		}
		t.Errorf("expected widget-7/speedscope-query handler, got: %v", keys)
	}
}

func TestSpeedscopeLink_RegistersViewerHandler(t *testing.T) {
	w := NewSpeedscopeLink(sql.New(sql.From("t"))).Id("widget-7")
	rec := newRecordingCollector()
	ctx := &rendering.DashboardContext{CurrentHandlerUrl: "/d"}
	if err := w.CollectHandlers(ctx, rec); err != nil {
		t.Fatalf("CollectHandlers: %v", err)
	}
	if _, ok := rec.handlers["widget-7/viewer/"]; !ok {
		var keys []string
		for k := range rec.handlers {
			keys = append(keys, k)
		}
		t.Errorf("expected widget-7/viewer/ handler, got: %v", keys)
	}
}

func TestSpeedscopeLink_Immutability(t *testing.T) {
	original := NewSpeedscopeLink(sql.New(sql.From("t")))
	_ = original.Title("hi")
	if original.title != "" {
		t.Errorf("original mutated by Title()")
	}
}

func TestSpeedscopeLink_ContextNotShared(t *testing.T) {
	w := NewSpeedscopeLink(sql.New(sql.From("t"))).Id("w1")
	a := renderComponent(t, w)
	b := renderComponent(t, w)
	if !strings.Contains(a, "speedscopeLink") || a != b {
		t.Errorf("rendering not stable")
	}
}

// recordingCollector is a minimal in-memory handler_collector.HandlerCollector for tests.
type recordingCollector struct {
	handlers map[string]http.Handler
}

func newRecordingCollector() *recordingCollector {
	return &recordingCollector{handlers: map[string]http.Handler{}}
}

func (r *recordingCollector) Handle(path string, handler http.Handler) error {
	r.handlers[path] = handler
	return nil
}
func (r *recordingCollector) HandleRoot(_ http.Handler) error                    { return nil }
func (r *recordingCollector) Nested(_ string) handler_collector.HandlerCollector { return r }
func (r *recordingCollector) IsRegistered(_ string) bool                         { return false }

var _ handler_collector.HandlerCollector = (*recordingCollector)(nil)
