// Tests for the filter buttons in page.json (pageButtons) and their pills for a value (buttonHandler).
package dashboard

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"

	"github.com/sandstorm/dashica/lib/dashboard/filter"
)

// shop is a page with a button without `...` and one with.
var shop = New().WithTitle("Shop").
	FilterButton("Errors", "status >= 500").
	FilterButton("Path", "path ILIKE concat(..., '%')")

func TestPageJson_AButtonWithoutValueCarriesItsPillSignedOneWithItsUrl(t *testing.T) {
	rec := httptest.NewRecorder()
	serve(t, shop).ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/p/shop/page.json", nil))
	var page PageJson
	if err := json.Unmarshal(rec.Body.Bytes(), &page); err != nil || len(page.FilterButtons) != 2 {
		t.Fatalf("page.json: %v\n%s", err, rec.Body)
	}
	errors, path := page.FilterButtons[0], page.FilterButtons[1]
	pill, err := filter.Open(testSecret, errors.Key, nil)
	if want := (filter.Pill{Condition: "status >= 500", Label: "status >= 500", Button: "status >= 500"}); err != nil || pill != want || errors.Url != "" {
		t.Errorf("Errors: %+v, its pill %+v, %v", errors, pill, err)
	}
	if path.Key != "" || path.Url != "/p/shop/button?i=1" || path.QueryPart != "path ILIKE concat(..., '%')" {
		t.Errorf("Path: %+v", path)
	}
}

func TestButtonHandler_GivesThePillOfAValueWrittenInAsALiteral(t *testing.T) {
	rec := httptest.NewRecorder()
	serve(t, shop).ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/p/shop/button?i=1&value="+url.QueryEscape("it's"), nil))
	var body struct{ Key, Label string }
	if err := json.Unmarshal(rec.Body.Bytes(), &body); rec.Code != http.StatusOK || err != nil {
		t.Fatalf("%d %s", rec.Code, rec.Body)
	}
	pill, err := filter.Open(testSecret, body.Key, nil)
	want := filter.Pill{Condition: `path ILIKE concat('it\'s', '%')`, Label: `path ILIKE concat('it\'s', '%')`, Button: "path ILIKE concat(..., '%')", Value: "it's"}
	if err != nil || pill != want || body.Label != "Path: it's" {
		t.Errorf("%+v %q, %v", pill, body.Label, err)
	}
}

func TestButtonHandler_RefusesWhatMakesNoPill(t *testing.T) {
	mux := serve(t, shop)
	for query, status := range map[string]int{
		"i=2&value=a": http.StatusNotFound,
		"i=x&value=a": http.StatusNotFound,
		"i=0&value=a": http.StatusBadRequest,
		"i=1":         http.StatusBadRequest,
		"i=1&value=":  http.StatusBadRequest,
	} {
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/p/shop/button?"+query, nil))
		if rec.Code != status {
			t.Errorf("%s: %d, want %d", query, rec.Code, status)
		}
	}
}
