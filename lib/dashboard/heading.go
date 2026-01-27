package dashboard

import "fmt"

func LoadEnvAndPrintHeading() DashboardEnv {
	fmt.Println("```js")
	fmt.Println(`
import {chart, clickhouse, component} from '/dashica/index.js';
const filters = view(component.globalFilter());
const viewOptions = view(component.viewOptions());
`)
	fmt.Println("```")

	return LoadEnv()
}
