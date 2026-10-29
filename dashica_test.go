package dashica

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestWorkbenchJson_ListsTheGroupsAsRegisteredWhenAsked(t *testing.T) {
	d := &DashicaImpl{}
	get := func() string {
		rec := httptest.NewRecorder()
		d.serveWorkbenchJson(rec, httptest.NewRequest(http.MethodGet, "/workbench.json", nil))
		if rec.Header().Get("Content-Type") != "application/json" {
			t.Errorf("content type %q", rec.Header().Get("Content-Type"))
		}
		return rec.Body.String()
	}

	if got := get(); got != `{"menu":[]}`+"\n" {
		t.Errorf("before any group: %s", got)
	}
	d.RegisterDashboardGroup("Shop")
	if got := get(); got != `{"menu":[{"title":"Shop","entries":[]}]}`+"\n" {
		t.Errorf("after registering: %s", got)
	}
}
