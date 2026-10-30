package httpserver

import (
	"net/http"
	"time"

	alerting2 "github.com/sandstorm/dashica/lib/alerting"
)

type debugCalculateAlertsHandler struct {
	batchEvaluator   *alerting2.BatchEvaluator
	alertResultStore *alerting2.AlertResultStore
}

func (da debugCalculateAlertsHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) error {
	if err := da.alertResultStore.ClearAll(); err != nil {
		return err
	}

	state, err := ParseQueryState(r)
	if err != nil {
		return err
	}
	timeRange, err := state.ResolveTimeRange(time.Now())
	if err != nil {
		return err
	}
	if err := da.batchEvaluator.EvaluateAlerts(
		r.Context(),
		time.UnixMilli(*timeRange.From), time.UnixMilli(*timeRange.To),
	); err != nil {
		return err
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
