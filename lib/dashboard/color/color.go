package color

import "encoding/json"

type ColorScale struct {
	legend  bool
	domain  []string
	range_  []string
	unknown string
	typ     string // Observable Plot color scale type (e.g. "categorical")
	scheme  string // Observable Plot color scheme (e.g. "reds", "YlOrBr", "Greens")
}

type ColorScaleOption func(*ColorScale)

func ColorLegend(enabled bool) ColorScaleOption {
	return func(c *ColorScale) {
		c.legend = enabled
	}
}

func ColorMapping(value string, color string) ColorScaleOption {
	return func(c *ColorScale) {
		c.domain = append(c.domain, value)
		c.range_ = append(c.range_, color)
	}
}

func ColorUnknown(color string) ColorScaleOption {
	return func(c *ColorScale) {
		c.unknown = color
	}
}

func ColorType(typ string) ColorScaleOption {
	return func(c *ColorScale) {
		c.typ = typ
	}
}

func ColorScheme(scheme string) ColorScaleOption {
	return func(c *ColorScale) {
		c.scheme = scheme
	}
}

func New(opts ...ColorScaleOption) *ColorScale {
	c := &ColorScale{
		unknown: "#8E44AD",
	}
	for _, opt := range opts {
		opt(c)
	}
	return c
}

func (c *ColorScale) With(opts ...ColorScaleOption) *ColorScale {
	cloned := *c
	cloned.domain = make([]string, len(c.domain))
	copy(cloned.domain, c.domain)
	cloned.range_ = make([]string, len(c.range_))
	copy(cloned.range_, c.range_)

	for _, opt := range opts {
		opt(&cloned)
	}
	return &cloned
}

func (c *ColorScale) MarshalJSON() ([]byte, error) {
	type Alias struct {
		Legend  bool     `json:"legend"`
		Domain  []string `json:"domain,omitempty"`
		Range   []string `json:"range,omitempty"`
		Unknown string   `json:"unknown,omitempty"`
		Type    string   `json:"type,omitempty"`
		Scheme  string   `json:"scheme,omitempty"`
	}
	return json.Marshal(&Alias{
		Legend:  c.legend,
		Domain:  c.domain,
		Range:   c.range_,
		Unknown: c.unknown,
		Type:    c.typ,
		Scheme:  c.scheme,
	})
}
