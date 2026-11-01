package dashboard

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"github.com/sandstorm/dashica/lib/dashboard/filter"
	"github.com/sandstorm/dashica/lib/dashboard/rendering"
)

// pageButtons are `buttons` as page.json carries them for the page at `pagePath`: a button without `...` with its
// pill signed by `filters` (Key), one with `...` with the URL of buttonHandler for it (Url).
func pageButtons(filters *filter.FilterService, pagePath string, buttons []rendering.FilterButton) ([]rendering.FilterButton, error) {
	out := make([]rendering.FilterButton, 0, len(buttons))
	for i, button := range buttons {
		if strings.Contains(button.QueryPart, "...") {
			button.Url = fmt.Sprintf("%s/button?i=%d", pagePath, i)
			out = append(out, button)
			continue
		}
		pill, err := filter.NewButton(button.Title, button.QueryPart, "")
		if err == nil {
			button.Key, err = filters.Sign(pill)
		}
		if err != nil {
			return nil, fmt.Errorf("filter button %q: %w", button.Title, err)
		}
		out = append(out, button)
	}
	return out, nil
}

// buttonHandler answers `GET <page>/button?i=<index>&value=<value>` with the pill (filter.NewButton) of the page's
// button `i` for `value`, as JSON `{key, label}`: its key signed by `filters`, its label the chip's text
// ("Duration >= … ms: 500"). The value is written in as a string literal, so the browser never sends SQL. 404 for
// no such button, 400 for one without `...` (its key is in page.json) or an empty value.
func buttonHandler(filters *filter.FilterService, buttons []rendering.FilterButton) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		i, err := strconv.Atoi(r.URL.Query().Get("i"))
		if err != nil || i < 0 || i >= len(buttons) {
			http.Error(w, "want ?i=<index of a filter button of this page>&value=<value>", http.StatusNotFound)
			return
		}
		button := buttons[i]
		if !strings.Contains(button.QueryPart, "...") {
			http.Error(w, fmt.Sprintf("filter button %q takes no value", button.Title), http.StatusBadRequest)
			return
		}
		pill, err := filter.NewButton(button.Title, button.QueryPart, r.URL.Query().Get("value"))
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		key, err := filters.Sign(pill)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(struct {
			Key   string `json:"key"`
			Label string `json:"label"`
		}{key, pill.Label})
	}
}
