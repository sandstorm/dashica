package color

import "encoding/json"

type ColorScale struct {
	legend  bool
	domain  []string
	range_  []string
	unknown string
	typ     ScaleType
	scheme  Scheme
}

// ScaleType is the type of an Observable Plot color scale: how it maps values to colors.
// Docs: https://observablehq.com/plot/features/scales#color-scale-options
//
//dashicagen:enum
type ScaleType struct{ v string }

var (
	// ScaleCategorical gives each distinct value its own color, from the scheme.
	ScaleCategorical = ScaleType{"categorical"}
	// ScaleOrdinal gives each distinct value its own color, in the order of the domain.
	ScaleOrdinal = ScaleType{"ordinal"}
	// ScaleLinear, ScalePow, ScaleSqrt, ScaleLog and ScaleSymlog map numbers continuously along the scheme.
	ScaleLinear = ScaleType{"linear"}
	ScalePow    = ScaleType{"pow"}
	ScaleSqrt   = ScaleType{"sqrt"}
	ScaleLog    = ScaleType{"log"}
	ScaleSymlog = ScaleType{"symlog"}
	// ScaleSequential and ScaleCyclical map numbers along a sequential or a cyclical scheme.
	ScaleSequential = ScaleType{"sequential"}
	ScaleCyclical   = ScaleType{"cyclical"}
	// ScaleDiverging and its variants map numbers to two colors on either side of a pivot.
	ScaleDiverging       = ScaleType{"diverging"}
	ScaleDivergingLog    = ScaleType{"diverging-log"}
	ScaleDivergingPow    = ScaleType{"diverging-pow"}
	ScaleDivergingSqrt   = ScaleType{"diverging-sqrt"}
	ScaleDivergingSymlog = ScaleType{"diverging-symlog"}
	// ScaleThreshold, ScaleQuantile and ScaleQuantize put numbers into color buckets.
	ScaleThreshold = ScaleType{"threshold"}
	ScaleQuantile  = ScaleType{"quantile"}
	ScaleQuantize  = ScaleType{"quantize"}
	// ScaleIdentity takes the values as CSS colors.
	ScaleIdentity = ScaleType{"identity"}
)

// Scheme is an Observable Plot color scheme: the colors a scale picks from.
// Docs: https://observablehq.com/plot/features/scales#color-scale-options
//
//dashicagen:enum
type Scheme struct{ v string }

var (
	// for categories: a distinct color per value
	SchemeAccent       = Scheme{"Accent"}
	SchemeCategory10   = Scheme{"Category10"}
	SchemeDark2        = Scheme{"Dark2"}
	SchemeObservable10 = Scheme{"Observable10"}
	SchemePaired       = Scheme{"Paired"}
	SchemePastel1      = Scheme{"Pastel1"}
	SchemePastel2      = Scheme{"Pastel2"}
	SchemeSet1         = Scheme{"Set1"}
	SchemeSet2         = Scheme{"Set2"}
	SchemeSet3         = Scheme{"Set3"}
	SchemeTableau10    = Scheme{"Tableau10"}
	// diverging: two colors on either side of a midpoint
	SchemeBrBG     = Scheme{"BrBG"}
	SchemePRGn     = Scheme{"PRGn"}
	SchemePiYG     = Scheme{"PiYG"}
	SchemePuOr     = Scheme{"PuOr"}
	SchemeRdBu     = Scheme{"RdBu"}
	SchemeRdGy     = Scheme{"RdGy"}
	SchemeRdYlBu   = Scheme{"RdYlBu"}
	SchemeRdYlGn   = Scheme{"RdYlGn"}
	SchemeSpectral = Scheme{"Spectral"}
	SchemeBuRd     = Scheme{"BuRd"}
	SchemeBuYlRd   = Scheme{"BuYlRd"}
	// sequential: from light to dark, or along a hue
	SchemeBlues     = Scheme{"Blues"}
	SchemeGreens    = Scheme{"Greens"}
	SchemeGreys     = Scheme{"Greys"}
	SchemeOranges   = Scheme{"Oranges"}
	SchemePurples   = Scheme{"Purples"}
	SchemeReds      = Scheme{"Reds"}
	SchemeTurbo     = Scheme{"Turbo"}
	SchemeViridis   = Scheme{"Viridis"}
	SchemeMagma     = Scheme{"Magma"}
	SchemeInferno   = Scheme{"Inferno"}
	SchemePlasma    = Scheme{"Plasma"}
	SchemeCividis   = Scheme{"Cividis"}
	SchemeCubehelix = Scheme{"Cubehelix"}
	SchemeWarm      = Scheme{"Warm"}
	SchemeCool      = Scheme{"Cool"}
	SchemeBuGn      = Scheme{"BuGn"}
	SchemeBuPu      = Scheme{"BuPu"}
	SchemeGnBu      = Scheme{"GnBu"}
	SchemeOrRd      = Scheme{"OrRd"}
	SchemePuBu      = Scheme{"PuBu"}
	SchemePuBuGn    = Scheme{"PuBuGn"}
	SchemePuRd      = Scheme{"PuRd"}
	SchemeRdPu      = Scheme{"RdPu"}
	SchemeYlGn      = Scheme{"YlGn"}
	SchemeYlGnBu    = Scheme{"YlGnBu"}
	SchemeYlOrBr    = Scheme{"YlOrBr"}
	SchemeYlOrRd    = Scheme{"YlOrRd"}
	// cyclical: around the color wheel
	SchemeRainbow = Scheme{"Rainbow"}
	SchemeSinebow = Scheme{"Sinebow"}
)

// ColorScaleOption sets part of a color scale: a ScaleType (color.ScaleCategorical), a Scheme (color.SchemeGreens),
// or what ColorLegend, ColorMapping and ColorUnknown return. Given twice, the last one wins.
type ColorScaleOption interface{ apply(*ColorScale) }

func (t ScaleType) apply(c *ColorScale) { c.typ = t }
func (s Scheme) apply(c *ColorScale)    { c.scheme = s }

// optionFunc is the ColorScaleOption of ColorLegend, ColorMapping and ColorUnknown.
type optionFunc func(*ColorScale)

func (f optionFunc) apply(c *ColorScale) { f(c) }

func ColorLegend(enabled bool) ColorScaleOption {
	return optionFunc(func(c *ColorScale) {
		c.legend = enabled
	})
}

func ColorMapping(value string, color string) ColorScaleOption {
	return optionFunc(func(c *ColorScale) {
		c.domain = append(c.domain, value)
		c.range_ = append(c.range_, color)
	})
}

func ColorUnknown(color string) ColorScaleOption {
	return optionFunc(func(c *ColorScale) {
		c.unknown = color
	})
}

func New(opts ...ColorScaleOption) *ColorScale {
	c := &ColorScale{
		unknown: "#8E44AD",
	}
	for _, opt := range opts {
		opt.apply(c)
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
		opt.apply(&cloned)
	}
	return &cloned
}

// colorScaleDTO is the wire form of ColorScale, shared by Marshal/UnmarshalJSON.
// ColorScale keeps unexported fields; (de)serialization is added around them
// (see docs/2026-07-21-dynamic-widget-dashboard-ui.md §4.1) — hand-written like
// the sql package, as the color vocabulary is small and stable.
type colorScaleDTO struct {
	Legend  bool      `json:"legend"`
	Domain  []string  `json:"domain,omitempty"`
	Range   []string  `json:"range,omitempty"`
	Unknown string    `json:"unknown,omitempty"`
	Type    ScaleType `json:"type,omitzero"`
	Scheme  Scheme    `json:"scheme,omitzero"`
}

func (c *ColorScale) MarshalJSON() ([]byte, error) {
	return json.Marshal(&colorScaleDTO{
		Legend:  c.legend,
		Domain:  c.domain,
		Range:   c.range_,
		Unknown: c.unknown,
		Type:    c.typ,
		Scheme:  c.scheme,
	})
}

func (c *ColorScale) UnmarshalJSON(b []byte) error {
	var dto colorScaleDTO
	if err := json.Unmarshal(b, &dto); err != nil {
		return err
	}
	*c = ColorScale{
		legend:  dto.Legend,
		domain:  dto.Domain,
		range_:  dto.Range,
		unknown: dto.Unknown,
		typ:     dto.Type,
		scheme:  dto.Scheme,
	}
	return nil
}
