// Tests for CheckFilterSecret.
package config

import (
	"strings"
	"testing"
)

func TestCheckFilterSecret_WantsALongEnoughSecret(t *testing.T) {
	for secret, ok := range map[string]bool{"": false, "short": false, strings.Repeat("x", MinFilterSecretLength-1): false, strings.Repeat("x", MinFilterSecretLength): true} {
		if err := (FiltersConfig{Secret: secret}).CheckFilterSecret(); (err == nil) != ok {
			t.Errorf("%d characters: %v", len(secret), err)
		}
	}
}
