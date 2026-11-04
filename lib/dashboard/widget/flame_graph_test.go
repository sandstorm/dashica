package widget

import (
	"testing"

	"github.com/sandstorm/dashica/lib/dashboard/sql"
)

func TestFlameGraph_Defaults(t *testing.T) {
	f := NewFlameGraph(sql.New(sql.From("profiling_traces")))
	if f.height != 800 || f.title != "" || f.id != "" {
		t.Errorf("unexpected defaults: %+v", f)
	}
}

func TestFlameGraph_Immutability(t *testing.T) {
	original := NewFlameGraph(sql.New(sql.From("profiling_traces")))
	changed := original.Title("Profile").Height(300).Id("profile").AdjustQuery(sql.Where("cnt > 0"))
	if original.title != "" || original.height != 800 || original.id != "" {
		t.Errorf("original mutated: %+v", original)
	}
	if changed.title != "Profile" || changed.height != 300 || changed.explicitId() != "profile" {
		t.Errorf("unexpected result: %+v", changed)
	}
}

func TestFlameGraph_QueryIsItsSql(t *testing.T) {
	query := sql.New(sql.From("profiling_traces"))
	got, err := sql.BuildWithFS(NewFlameGraph(query).AdjustQuery(sql.Where("cnt > 0")).Query(), nil)
	if err != nil {
		t.Fatal(err)
	}
	want, err := sql.BuildWithFS(query.With(sql.Where("cnt > 0")), nil)
	if err != nil {
		t.Fatal(err)
	}
	if got != want {
		t.Errorf("got %q, want %q", got, want)
	}
}
