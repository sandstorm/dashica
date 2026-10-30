// Tests for tableColumns, the columns Client.Columns keeps per table.
package clickhouse

import (
	"errors"
	"reflect"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestTableColumns_KeepsWhatDescribeGaveUntilRestart(t *testing.T) {
	var tc tableColumns
	asked := 0
	describe := func() ([]string, error) { asked++; return []string{"status"}, nil }

	for range 2 {
		if got, err := tc.get("http_logs", describe); err != nil || !reflect.DeepEqual(got, []string{"status"}) {
			t.Fatalf("get: %v, %v", got, err)
		}
	}
	if asked != 1 {
		t.Errorf("asked DESCRIBE %d times, want once", asked)
	}
}

func TestTableColumns_AFailedDescribeIsAskedAgain(t *testing.T) {
	var tc tableColumns
	if _, err := tc.get("http_logs", func() ([]string, error) { return nil, errors.New("connection refused") }); err == nil {
		t.Fatal("want the error of describe")
	}
	got, err := tc.get("http_logs", func() ([]string, error) { return []string{"status"}, nil })
	if err != nil || !reflect.DeepEqual(got, []string{"status"}) {
		t.Errorf("get after a failure: %v, %v", got, err)
	}
}

func TestTableColumns_TheFirstRequestsForATableShareOneDescribe(t *testing.T) {
	var tc tableColumns
	var asked atomic.Int32
	entered, release := make(chan struct{}), make(chan struct{})
	describe := func() ([]string, error) {
		if asked.Add(1) == 1 {
			close(entered)
		}
		<-release
		return []string{"status"}, nil
	}

	var done sync.WaitGroup
	for range 10 {
		done.Add(1)
		go func() {
			defer done.Done()
			if _, err := tc.get("http_logs", describe); err != nil {
				t.Errorf("get: %v", err)
			}
		}()
	}
	// the first DESCRIBE answers once the other requests had time to ask as well
	<-entered
	time.Sleep(50 * time.Millisecond)
	close(release)
	done.Wait()
	if n := asked.Load(); n != 1 {
		t.Errorf("asked DESCRIBE %d times, want once", n)
	}
}
