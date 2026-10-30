package dashboard

import (
	"io"
	"net/http"
)

// shellHandler serves the HTML every page URL answers ("/p/shop"): the same for every page. The client boots the
// workbench in it (frontend/index.js) and shows the page from its page.json.
var shellHandler = http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	_, _ = io.WriteString(w, shellHTML)
})

const shellHTML = `<!DOCTYPE html>
<html>
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>Dashica</title>
	<link rel="stylesheet" href="/public/dist/index.css">
	<link rel="apple-touch-icon" sizes="180x180" href="/assets/favicon/apple-touch-icon.png">
	<link rel="icon" type="image/png" sizes="32x32" href="/assets/favicon/favicon-32x32.png">
	<link rel="icon" type="image/png" sizes="16x16" href="/assets/favicon/favicon-16x16.png">
	<script src="/public/dist/index.js"></script>
</head>
<body class="bg-base-200">
	<div id="workbench"></div>
	<script>window.Dashica.boot();</script>
</body>
</html>
`
