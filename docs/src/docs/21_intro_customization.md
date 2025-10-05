# Introduction to Customization

## Custom observable Framework configuration `observablehq.config.js`

## Styling customization

create a `src/style.css` file. If this is found, this is used as entrypoint for CSS.

The `src/style.css` should include the following line:

```css
/* import the dashica CSS */
@import url("dashica/style.css");
/* add your custom CSS here */ 
```