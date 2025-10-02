# Example "Git Data"

(from this file, examples are extracted into the README.md via `dev gen-readme`)

```js
import {chart, clickhouse, component} from '/dashica/index.js';
const viewOptions = view(component.viewOptions());
```

We use the [ClickHouse Git Commits Dataset](https://clickhouse.com/docs/getting-started/example-datasets/github#downloading-and-inserting-the-data) for test data, visualized in this dashboard.

## barVertical

<!-- SECTION id=barVertical_commits_by_author -->

```js
display(chart.barVertical(
    await clickhouse.query(
        '/src/__testing/example-git/commits_by_author.sql',
    ), {
        viewOptions, invalidation, // Pass through global view options & Invalidation promise
        title: 'Minimal example - commits by user',
        x: 'author',
        y: 'commit_count',
        height: 150
    }
));
```
<!-- SECTION:end -->

<!-- SECTION id=barVertical_commits_by_author_and_year -->
```js
display(chart.barVertical(
    await clickhouse.query(
        '/src/__testing/example-git/commits_by_author_and_year.sql',
    ), {
        viewOptions, invalidation, // Pass through global view options & Invalidation promise
        title: 'With Stacking - commits by user, colored by year.',
        x: 'author',
        y: 'yearly_commit_count',
        fill: 'year',
        height: 150
    }
));
```
<!-- SECTION:end -->


<!-- SECTION id=barVertical_commits_by_author_and_year_facetingHorizontal -->
```js
display(chart.barVertical(
    await clickhouse.query(
        '/src/__testing/example-git/commits_by_author_and_year.sql',
    ), {
        viewOptions, invalidation, // Pass through global view options & Invalidation promise
        title: 'With faceting - commits by user, grouped by year (horizontally).',
        x: 'author',
        y: 'yearly_commit_count',
        fx: 'year',
        height: 150
    }
));
```
<!-- SECTION:end -->

<details><summary> <b>special case</b>: With faceting - commits by user, grouped by year (vertically).</summary>

<!-- SECTION id=barVertical_commits_by_author_and_year_facetingVertical -->
```js
display(chart.barVertical(
    await clickhouse.query(
        '/src/__testing/example-git/commits_by_author_and_year.sql',
    ), {
        viewOptions, invalidation, // Pass through global view options & Invalidation promise
        title: 'With faceting - commits by user, grouped by year (vertically).',
        x: 'author',
        y: 'yearly_commit_count',
        fy: 'year',
        height: 950
    }
));
```
<!-- SECTION:end -->

</details>



## barHorizontal

<!-- SECTION id=barHorizontal_commits_by_author -->
```js
display(chart.barHorizontal(
    await clickhouse.query(
        '/src/__testing/example-git/commits_by_author.sql',
    ), {
        viewOptions, invalidation, // Pass through global view options & Invalidation promise
        title: 'Minimal example - commits by user',
        y: 'author',
        x: 'commit_count',
        height: 300,
        marginLeft: 150,
    }
));
```
<!-- SECTION:end -->

<!-- SECTION id=barHorizontal_commits_by_author_and_year -->
```js
display(chart.barHorizontal(
    await clickhouse.query(
        '/src/__testing/example-git/commits_by_author_and_year.sql',
    ), {
        viewOptions, invalidation, // Pass through global view options & Invalidation promise
        title: 'With Stacking - commits by user, colored by year.',
        y: 'author',
        x: 'yearly_commit_count',
        fill: 'year',
        height: 300,
        marginLeft: 150,
    }
));
```
<!-- SECTION:end -->

<details><summary> <b>special case</b>: With faceting - commits by user, grouped by year (horizontally).</summary>

<!-- SECTION id=barHorizontal_commits_by_author_and_year_facetingHorizontal -->
```js
display(chart.barHorizontal(
    await clickhouse.query(
        '/src/__testing/example-git/commits_by_author_and_year.sql',
    ), {
        viewOptions, invalidation, // Pass through global view options & Invalidation promise
        title: 'With faceting - commits by user, grouped by year (horizontally).',
        y: 'author',
        x: 'yearly_commit_count',
        fx: 'year',
        height: 350,
        marginLeft: 200
    }
));
```
<!-- SECTION:end -->

</details>

<details><summary> <b>special case</b>: With faceting - commits by user, grouped by year (vertically).</summary>

<!-- SECTION id=barHorizontal_commits_by_author_and_year_facetingVertical -->
```js
display(chart.barHorizontal(
    await clickhouse.query(
        '/src/__testing/example-git/commits_by_author_and_year.sql',
    ), {
        viewOptions, invalidation, // Pass through global view options & Invalidation promise
        title: 'With faceting - commits by user, grouped by year (vertically).',
        y: 'author',
        x: 'yearly_commit_count',
        fy: 'year',
        height: 950
    }
));
```
<!-- SECTION:end -->

</details>

## timeBar

<!-- SECTION id=timeBar_commits_by_date -->
```js
display(chart.timeBar(
    await clickhouse.query(
        '/src/__testing/example-git/commits_by_date.sql',
    ), {
        viewOptions, invalidation, // Pass through global view options & Invalidation promise
        title: 'Commits by date',
        x: 'time_bucket',
        xBucketSize: 30*24*60*60*1000,
        y: 'commit_count',
    }
));
```
<!-- SECTION:end -->

<!-- SECTION id=timeBar_commits_by_author_and_date -->
```js
display(chart.timeBar(
    await clickhouse.query(
        '/src/__testing/example-git/commits_by_author_and_date.sql',
    ), {
        viewOptions, invalidation, // Pass through global view options & Invalidation promise
        title: 'With stacking - commits by author and date',
        x: 'time_bucket',
        xBucketSize: 30*24*60*60*1000,
        y: 'commit_count',
        fill: 'author',
        color: {legend: false},
    }
));
```
<!-- SECTION:end -->