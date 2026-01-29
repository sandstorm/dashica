package httpserver

import (
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/sandstorm/dashica/server/alerting"
)

type debugCalculateAlertsHandler struct {
	batchEvaluator   *alerting.BatchEvaluator
	alertResultStore *alerting.AlertResultStore
}

func (da debugCalculateAlertsHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) error {
	if err := da.alertResultStore.ClearAll(); err != nil {
		return err
	}

	rawFilters := r.URL.Query().Get("filters")
	if rawFilters != "" {
		err := da.alertResultStore.ClearAll()
		if err != nil {
			return err
		}

		var filters DashboardFilters
		err = json.Unmarshal([]byte(rawFilters), &filters)
		if err != nil {
			return fmt.Errorf("unmarshalling filters: %w", err)
		}

		//w.Header().Add("X-Dashica-Resolved-TimeTs-Range", resolvedTimeRange)

		if err := da.batchEvaluator.EvaluateAlerts(
			r.Context(),
			filters.FromNew(), filters.ToNew(),
		); err != nil {
			return err
		}
	}

	returnToReferer(w, r)
	return nil
}

func returnToReferer(w http.ResponseWriter, r *http.Request) {
	// Get the Referer header
	referer := r.Header.Get("Referer")

	// If Referer is empty, redirect to a default location
	if referer == "" {
		referer = "/" // Default to home page
	}

	// Redirect to the referer URL
	http.Redirect(w, r, referer, http.StatusSeeOther) // 303 See Other
}
