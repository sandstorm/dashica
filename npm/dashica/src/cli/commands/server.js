import {spawn} from 'node:child_process';
import {existsSync, constants} from 'node:fs';
import {join} from "node:path";
import {resolveDashicaServer} from "./_utils.js";

export default async function build({flags, args, packageRoot}) {
    // Validate flags - throw error if unknown flags
    const knownFlags = ['build', 'bin', 'dev'];
    const unknownFlags = Object.keys(flags).filter(flag => !knownFlags.includes(flag));
    if (unknownFlags.length > 0) {
        console.error(`ERROR: Unknown flags: ${unknownFlags.join(', ')}. Known flags: ${knownFlags.join(', ')}`);
        process.exit(1);
    }

    const dashicaServerBin = await resolveDashicaServer(flags);

    const env = Object.assign({}, process.env);
    if (flags.dev) {
        env.DEV_MODE = '1';
    }

    const dashicaServer = spawn(dashicaServerBin, {
        stdio: 'inherit',  // Share stdin/stdout/stderr
        cwd: process.cwd(),
        env: env,
    });

    dashicaServer.on('exit', (code, signal) => {
        process.exit(code ?? (signal ? 1 : 0));
    });
}