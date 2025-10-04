# Dashica

Dashica is an Open-Source Monitoring Dashboard and Alerting solution, developed by [sandstorm](https://sandstorm.de).

It is a code-first, git-friendly Grafana alternative.

Main Features and ideas:

- flexible dashboards, configured in Markdown / Code / Git.
- works specifically with **ClickHouse** (other databases coming soon)
- supporting arbitrary SQL for graphs and alerts
- no magic calculations in the Graphing layer; SQL result values are directly printed
- Alerts easily debuggable and automatically visualized
- global time and SQL selector, persisted to URL parameters
- adjustable chart colors, f.e. for keeping "OK" bars green and "error" bars red.
