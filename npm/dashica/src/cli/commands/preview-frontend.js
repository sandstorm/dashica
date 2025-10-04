import {PreviewServer} from "@observablehq/framework/dist/preview.js"
import {readConfig as observableReadConfig} from "@observablehq/framework/dist/config.js"
import {symlinkDashicaFrontendSourceCode} from "./_utils.js";
import { createServer } from "node:http";
import {existsSync} from "fs";

class CustomPreviewServer extends PreviewServer {
    async _readConfig() {
        const config = await observableReadConfig(this._config, this._root);

        //config.root = 'src';

        if (existsSync("src/style.css")) {
            config.style = { path: "style.css" } ;
        } else {
            // Fallback to default dashica styles
            config.style = { path: "dashica/style.css" } ;
        }

        // for debugging: console.log("CFG", config)
        return config;
    }
}

export default async function build({ flags, args, packageRoot }) {
    console.log('Building dashica frontend...');

    await symlinkDashicaFrontendSourceCode();

    const server = createServer();
    await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(3000, '127.0.0.1', resolve);
    });

    await new CustomPreviewServer({
        server: server,
        hostname: '127.0.0.1',
        config: undefined,
        root: undefined,
        port: undefined,
        origins: undefined,
        open: false
    });

    console.log('✓ Build complete');
}