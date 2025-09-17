package assertions

import (
	"encoding/json"
	"go.uber.org/goleak"
	"os"
	"reflect"
	"testing"
	"time"
)

func AssertNoGoRoutineLeak(t *testing.T) {
	t.Helper()
	ignoreIdleHttpConnections := goleak.IgnoreAnyFunction("net/http.http2readFrameHeader")
	ignoreClickhouseRead := goleak.IgnoreTopFunction("net/http.(*persistConn).readLoop")
	ignoreClickhouseWrite := goleak.IgnoreTopFunction("net/http.(*persistConn).writeLoop")
	// we have some goroutines which load the next data package in the background
	// and terminate afterward if the client is no longer listening for updates
	var err error
	for i := 0; i < 10; i++ {
		err = goleak.Find(
			ignoreIdleHttpConnections,
			ignoreClickhouseRead,
			ignoreClickhouseWrite,
		)
		if err == nil {
			return
		}
		if i > 5 {
			t.Logf("waiting for goroutines to finish: %v", err)
		}
		time.Sleep(1 * time.Second)
	}
	if err != nil {
		t.Error(err)
		// if we leaked goroutines all other tests will fail as well
		panic(err)
	}
}

func AssertThat[T any](t *testing.T, success bool, errorMessage string, actual T) bool {
	t.Helper()
	// AssertNil did not work properly since passing nil made it un-nil and vice versa
	if !success {
		t.Errorf(
			"%s: got %s(%v)",
			errorMessage,
			reflect.TypeOf(actual),
			actual)
	}
	return success
}

func AssertEquals[T any](t *testing.T, errorMessage string, expected T, actual T) bool {
	t.Helper()
	if !reflect.DeepEqual(actual, expected) {
		t.Errorf(
			"%s: expected\n%s(%v), but got\n%s(%v)",
			errorMessage,
			reflect.TypeOf(expected),
			expected,
			reflect.TypeOf(actual),
			actual)
		return false
	}
	return true
}

func AssertNotEquals[T any](t *testing.T, errorMessage string, unexpected T, actual T) bool {
	t.Helper()
	if reflect.DeepEqual(actual, unexpected) {
		t.Errorf(
			"%s: did not expect %s(%v)",
			errorMessage,
			reflect.TypeOf(actual),
			actual)
		return false
	}
	return true
}

func AssertJsonFixture[T any](t *testing.T, errorMessage string, fixturePath string, actual T) bool {
	t.Helper()
	expectedJson, err := os.ReadFile(fixturePath)
	if err != nil {
		t.Errorf("%s - failed to read fixture: %v", errorMessage, err)
		return false
	}
	var expected T
	err = json.Unmarshal(expectedJson, &expected)
	if err != nil {
		t.Errorf("%s - failed to unmarshal fixture: %v", errorMessage, err)
		return false
	}

	return AssertEquals(t, errorMessage, expected, actual)
}
