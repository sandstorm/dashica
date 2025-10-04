# Installation / A New Dashica Project

Dashica is consisting of a Node.JS application for the frontend build, based
on [Observable Framework](https://observablehq.com/framework/), and a custom
backend server written in Golang.

## Prerequisites

- You'll need Node.js installed on your machine.

## Creating a New Project

You'll create a new project by placing a few files in a directory:

**package.json**:

```json
{
  "dependencies": {
    "dashica": "1.0.0-alpha.1",
    "run-pty": "^5.0.0"
  },
  "type": "module",
  "scripts": {
    "dist": "dashica dist --build ../",
    "clickhouse-cli": "dashica clickhouse-cli",

    "preview": "run-pty      % dashica preview-frontend        % dashica server --dev --build ../"
  }
}
```

---
**dashica_config.yaml** (server configuration):

```yaml
clickhouse:
  default:
    # for dashica backend
    url: http://127.0.0.1:28123
    # for connection via "dashica clickhouse-cli" command
    nativeHostPort: 127.0.0.1:29001
    user: admin
    password: password
    database: default
```

## Running the project locally

```bash
# install dashica
npm install

# start the development server
npm run preview
```

now, browse to http://localhost:8080/ to see Dashica in action. It will still be quite empty, as you do not have any dashboards yet.

## Adding an empty dashboard

Any markdown file in the `src/` folder or a subfolder will be treated as a dashboard, and without a custom `observablehq.config.js`, 
it will be automatically added to the Menu.

**src/index.md**:


    ```js
    import {chart, clickhouse, component} from '/dashica/index.js';
    ```

    # Hello World
    
    This is my first Dashica dashboard. Not very exciting yet, but it's a start :)


All `js` blocks will be executed in the browser as part of the dashboard:
At the very top, we import the dashica library - which we will use later to create charts and other components.

*Try creating another markdown file in the `src/` folder, and see that it is automatically added to the menu.*

## Building the project for production

```bash
npm run dist
# creates a self-contained "dist" folder in your project.
```

Now, take the "dist" folder and copy it to your server.

On your server, start `dashica-server`:

```bash
# on your server
cd /path/to/your/dashica-project/dist
./dashica-server
```

You do **not** need Node.JS installed on your server - it is only needed for local previews and the build process.