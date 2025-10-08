## Helpful Docs / Links

https://observablehq.com/framework/reactivity

https://observablehq.com/plot/getting-started

https://github.com/observablehq/inputs

For writing external files: https://observablehq.com/framework/imports#implicit-imports

TODO: reusable markdown: https://github.com/observablehq/framework/issues/895

INTRO DOCS:
https://observablehq.com/plot/features/marks#marks-have-tidy-data
> Plot favors tidy data structured as an array of objects, where each object represents an observation (a row), and each object property represents an observed value; all objects in the array should have the same property names (the columns).

https://github.com/observablehq/framework/discussions/1960 !!!!  Widget Groups in JS // reactivity in JavaScript files // Generators Push vs Pull // How to interact with Observable Runtime? #1960 (question by myself)

https://github.com/observablehq/plot/pull/1811/files  document the custom render option #1811

- https://talk.observablehq.com/t/first-class-cells/4937/5 **unsure**
- https://observablehq.com/@tomlarkworthy/reconcile-nanomorph `Hypertext literal reconciliation with nanomorph`
- https://observablehq.com/@tomlarkworthy/observable-notes **How the Observable Runtime works**
- https://observablehq.com/@tomlarkworthy/ui-development ! (2021?)
  > we can write a helper that takes multiple views and combines them together to create new views. This is one way we can scale UI development -- hierarchical composition of views.
- https://observablehq.com/@tomlarkworthy/view ! (2021)
  > Lets make custom UIs on Observable easy by composing views.
    - https://github.com/observablehq/inputs/issues/73
    - https://observablehq.com/d/0fa0562e1dbf9542
- https://observablehq.com/user/@mootari
    - https://observablehq.com/@mootari/plot-group > This notebook provides a helper to wrap multiple Plot Marks in an SVG <g> element with arbitrary attributes. Created primarily to handle events on marks (as a workaround for plot#2298). **!!!!**
    - https://observablehq.com/d/aebbadaa71a6c0ae "An alternative API for Observable's Runtime with a focus on authoring cells. For yet another take see Dynamic Notebook Imports."
    - https://observablehq.com/@observablehq/fabians-toolbox "An opinionated assortment of helpers for various tasks."
    - https://observablehq.com/@mootari/colored-table-rows A wrapper around the Table Input that adds row colors.
    - https://observablehq.com/@mootari/custom-inspectors "Custom Inspectors"
    - https://observablehq.com/@mootari/what-has-viewof-ever-done-for-us !! Explanation of views (basics)
    - https://observablehq.com/@mootari/observablehq-inputs-feature-73
        - Inputs.form !!!
- https://observablehq.com/@john-guerra/reactive-widgets **Reusable and Reactive Visualization Widgets or Components** !!! (2024)
- https://observablehq.com/@john-guerra/conditional-show?collection=@john-guerra/visualization-widgets
- https://github.com/observablehq/framework/discussions/1821#discussioncomment-11294071
    - manually instanciate observable runtime in cell







# Observable Framework Docs

This is an [Observable Framework](https://observablehq.com/framework/) app. To install the required dependencies, run:

```
npm install
```

Then, to start the local preview server, run:

```
npm run dev
```

Then visit <http://localhost:3000> to preview your app.

For more, see <https://observablehq.com/framework/getting-started>.

## Project structure

A typical Framework project looks like this:

```ini
.
├─ src
│  ├─ components
│  │  └─ timeline.ts           # an importable module
│  ├─ data
│  │  ├─ launches.csv.js       # a data loader
│  │  └─ events.json           # a static data file
│  ├─ example-dashboard.md     # a page
│  ├─ example-report.md        # another page
│  └─ index.md                 # the home page
├─ .gitignore
├─ observablehq.config.js      # the app config file
├─ package.json
└─ README.md
```

**`src`** - This is the “source root” — where your source files live. Pages go here. Each page is a Markdown file. Observable Framework uses [file-based routing](https://observablehq.com/framework/project-structure#routing), which means that the name of the file controls where the page is served. You can create as many pages as you like. Use folders to organize your pages.

**`src/index.md`** - This is the home page for your app. You can have as many additional pages as you’d like, but you should always have a home page, too.

**`src/data`** - You can put [data loaders](https://observablehq.com/framework/data-loaders) or static data files anywhere in your source root, but we recommend putting them here.

**`src/components`** - You can put shared [JavaScript modules](https://observablehq.com/framework/imports) anywhere in your source root, but we recommend putting them here. This helps you pull code out of Markdown files and into JavaScript modules, making it easier to reuse code across pages, write tests and run linters, and even share code with vanilla web applications.

**`observablehq.config.js`** - This is the [app configuration](https://observablehq.com/framework/config) file, such as the pages and sections in the sidebar navigation, and the app’s title.

## Command reference

| Command           | Description                                              |
| ----------------- | -------------------------------------------------------- |
| `npm install`            | Install or reinstall dependencies                        |
| `npm run dev`        | Start local preview server                               |
| `npm run build`      | Build your static site, generating `./dist`              |
| `npm run deploy`     | Deploy your app to Observable                            |
| `npm run clean`      | Clear the local data loader cache                        |
| `npm run observable` | Run commands like `observable help`                      |


