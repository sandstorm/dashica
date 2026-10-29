package widget

import (
	"encoding/json"
	"fmt"
	"testing"
)

// The methods dashica-gen -enums writes for an enum (zz_generated.enums.go), on StackOrder.
func TestEnum_IsItsStringOnTheWireAndRefusesAnUnknownOne(t *testing.T) {
	b, err := json.Marshal(OrderSum)
	if err != nil || string(b) != `"sum"` {
		t.Fatalf("marshal: %s, %v", b, err)
	}
	var order StackOrder
	if err := json.Unmarshal([]byte(`"inside-out"`), &order); err != nil || order != OrderInsideOut {
		t.Errorf("unmarshal: %v, %v", order, err)
	}
	if err := json.Unmarshal([]byte(`"banana"`), &order); err == nil || err.Error() != `unknown StackOrder "banana"` {
		t.Errorf("unmarshal of an unknown value: %v", err)
	}
	if OrderSum.String() != "sum" || fmt.Sprintf("%#v", OrderSum) != "widget.OrderSum" {
		t.Errorf("String %q, GoString %q", OrderSum.String(), fmt.Sprintf("%#v", OrderSum))
	}
}
