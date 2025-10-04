import {preview as observablePreview} from "@observablehq/framework/dist/preview.js"
import {readConfig as observableReadConfig} from "@observablehq/framework/dist/config.js"
import {symlinkDashicaFrontendSourceCode} from "./_utils.js";


export default async function build({ flags, args, packageRoot }) {
    console.log('Building dashica frontend...');

    await symlinkDashicaFrontendSourceCode();

    await observableReadConfig(undefined, undefined)

    observablePreview({
        hostname: '127.0.0.1',
        config: undefined,
        root: undefined,
        port: undefined,
        origins: undefined,
        open: false
    });

    console.log('✓ Build complete');
}