const templateRoot = "/templates";

const dynamicPaths = [];
function registerInDynamicPaths(pages) {
    pages.forEach(page => {
        dynamicPaths.push(page.path);
    });

    return pages;
}


// we need to encode dots so the sites are correctly served by the go server when built
// In profiling Template the customer_project value is used as filter for clickhouse queries so it must have a dot in it
function encodeDots(string) {
    return string.replace(/\./g, '%2E');
}

function alerts(clickhouseCustomerTenant) {
    return registerInDynamicPaths([{
        name: `${clickhouseCustomerTenant} / Alerts`,
        path: `${templateRoot}/${clickhouseCustomerTenant}-alerts`,
    }]);
}

const config = {
    // The app’s title; used in the sidebar and webpage titles.
    title: "sandstorm Dashica",

    // The pages and sections in the sidebar. If you don’t specify this option,
    // all pages will be listed in alphabetical order. Listing pages explicitly
    // lets you organize them into sections and have unlisted pages.
    // pages: [
    //   {
    //     name: "Examples",
    //     pages: [
    //       {name: "Dashboard", path: "/example-dashboard"},
    //       {name: "Report", path: "/example-report"}
    //     ]
    //   }
    // ],

    // Content to add to the head of the page, e.g. for a favicon:
    head: `
        <script src="https://cdn.jsdelivr.net/npm/iconify-icon@2.3.0/dist/iconify-icon.min.js"></script>
`,
    // The path to the source root.
    //root: "src",

    pages: [
        {
            name: "Getting Started",
            open: true,
            pages: [
                {
                    name: "Installation",
                    path: "/docs/01_installation",
                },
                {
                    name: "Your first Dashboard",
                    path: "/docs/02_first_dashboard",
                },
                {
                    name: "Building & Deployment",
                    path: "/docs/03_deployment",
                },
            ]
        },
        {
            name: "Chart Types",
            open: true,
            pages: [
            ]
        },
        {
            name: "Customization & Advanced Topics",
            open: true,
            pages: [
                {
                    name: "Introduction to Customization",
                    path: "/docs/21_intro_customization",
                },
                {
                    name: "Custom Sidebar Menu",
                },
                {
                    name: "Custom Styles",
                },
                {
                    name: "Configuration Reference",
                    //path: "/docs/21_intro_customization",
                },
            ]
        },
        {
            name: "Clickhouse",
            open: false,
            pages: [
                {
                    name: "Clickhouse / Table Sizes",
                    path: "/clickhouse/table_sizes",
                },
                {
                    name: "Clickhouse / Errors+Warnings",
                    path: "/clickhouse/errors_warnings",
                },
                ...alerts('clickhouse'),
            ]
        },
        {
            name: "Development",
            open: false,
            pages: [
                {name: "Test Data", path: "/__testing/test-data", pager: "example"},
                {name: "Example 'Git Data'", path: "/__testing/example-git", pager: "example"},
                {name: "Reactive", path: "/__testing/reactive", pager: "example"},
            ]
        },
    ],

    dynamicPaths: dynamicPaths,

    // Some additional configuration options and their defaults:
    // theme: "default", // try "light", "dark", "slate", etc.
    // header: "", // what to show in the header (HTML)
    // footer: "Built with Observable.", // what to show in the footer (HTML)
    // sidebar: true, // whether to show the sidebar
    // toc: true, // whether to show the table of contents
    // pager: true, // whether to show previous & next links in the footer
    // output: "dist", // path to the output root for build
    // search: true, // activate search
    // linkify: true, // convert URLs in Markdown to links
    // typographer: false, // smart quotes and other typographic improvements
    preserveExtension: true, // keep .html from URLs
    // preserveIndex: false, // drop /index from URLs
};

export default config;
