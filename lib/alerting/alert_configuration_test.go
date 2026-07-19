package alerting

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestAlertIdFunctions(t *testing.T) {
	id := AlertIdFromString("group1#alert1")
	assert.Equal(t, "group1", id.Group)
	assert.Equal(t, "alert1", id.Key)
	assert.Equal(t, "group1#alert1", id.String())
}
