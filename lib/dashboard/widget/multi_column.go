package widget

func TwoColumns50Split(left WidgetDefinition, right WidgetDefinition) *Grid {
	return NewGrid().
		Template("a b").
		Area("a", left).
		Area("b", right)
}

func TwoColumns75Split(left WidgetDefinition, right WidgetDefinition) *Grid {
	return NewGrid().
		Template("a a a b").
		Area("a", left).
		Area("b", right)
}

func TwoColumns66Split(left WidgetDefinition, right WidgetDefinition) *Grid {
	return NewGrid().
		Template("a a b").
		Area("a", left).
		Area("b", right)
}
