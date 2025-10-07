
## Chart Options

The 2nd parameter of `chart.barVertical()` is an `Options` object, which minimally needs the following fields:

```
viewOptions, invalidation, // Pass through global view options & Invalidation promise 
```

`viewOptions` are required so that the chart reacts to changes in the global view options, e.g. log scale.
The `invalidation` promise is [from observable framework](https://observablehq.com/framework/reactivity#invalidation), and is a mechanism to know when the current cell
needs to re-render.

Then we need to specify the columns to use for the x and y axis:

```
x: 'day',
y: 'requests',
```

We try to use the configuration options from the underlying [Observable Plot](https://observablehq.com/plot/)
library, but simplified to common use cases.

## The display() function

The `display()` function [by Observable Framework](https://observablehq.com/framework/javascript#display-value)
is used to render the chart in a cell.
