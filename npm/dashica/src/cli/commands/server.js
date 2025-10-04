import {spawn} from 'node:child_process';
import {existsSync, constants} from 'node:fs';
import {join} from "node:path";

export default async function build({flags, args, packageRoot}) {
    // Validate flags - throw error if unknown flags
    const knownFlags = ['build', 'bin'];
    const unknownFlags = Object.keys(flags).filter(flag => !knownFlags.includes(flag));
    if (unknownFlags.length > 0) {
        console.error(`ERROR: Unknown flags: ${unknownFlags.join(', ')}. Known flags: ${knownFlags.join(', ')}`);
        process.exit(1);
    }

    let dashicaServerBin = null;

    // Build the Go Server if requested
    if (flags['build']) {
        if (flags['bin']) {
            console.error(`ERROR: --bin and --build cannot be used together.`);
            process.exit(1);
        }

        console.log(`Building dashica-server with base directory: ${flags['build']}`);

        const serverSourceDirectory = join(flags['build'], 'server');
        if (!existsSync(serverSourceDirectory)) {
            console.error(`ERROR: Server source directory "${serverSourceDirectory}" does not exist.`);
            process.exit(1);
        }

        // Build the Go server & wait for build to complete
        dashicaServerBin = join(serverSourceDirectory, 'build', 'dashica-server');
        const buildProcess = spawn('go', ['build', '-C', serverSourceDirectory, '-o', 'build/dashica-server', './cmd/dashica-server'], {
            stdio: 'inherit',
            cwd: process.cwd(),
            env: process.env,
        });
        await new Promise((resolve, reject) => {
            buildProcess.on('exit', (code, signal) => {
                if (code === 0) {
                    resolve();
                } else {
                    reject(new Error(`Build failed with code ${code ?? signal}`));
                }
            });
        });

        console.log(`build complete: ${serverSourceDirectory}/build/dashica-server`);
    }

    // Take a pre-built dashica-server binary if requested
    if (flags['bin']) {
        if (!existsSync(flags['bin']) ) {
            console.error(`ERROR: dashica-server binary "${flags['bin']}" does not exist.`);
            process.exit(1);
        }

        console.log(`Using pre-built dashica-server binary: ${flags['bin']}`);
        dashicaServerBin = flags['bin'];
    }

    if (!dashicaServerBin) {
        // TODO: FALLBACK to pre-built binary
        console.error(`ERROR: No dashica-server binary specified. Use --bin or --build to specify.`);
        process.exit(1);
    }

    const dashicaServer = spawn(dashicaServerBin, {
        stdio: 'inherit',  // Share stdin/stdout/stderr
        cwd: process.cwd(),
        env: process.env,
    });

    dashicaServer.on('exit', (code, signal) => {
        process.exit(code ?? (signal ? 1 : 0));
    });
}