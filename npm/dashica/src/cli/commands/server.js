import { spawn } from 'node:child_process';

export default async function build({ flags, args, packageRoot }) {

    // Build the Go server
    const buildProcess = spawn('go', ['build', '-C', '../server', '-o', 'build/dashica-server', './cmd/dashica-server'], {
        stdio: 'inherit',
        cwd: process.cwd(),
        env: process.env,
    });

    // Wait for build to complete
    await new Promise((resolve, reject) => {
        buildProcess.on('exit', (code, signal) => {
            if (code === 0) {
                resolve();
            } else {
                reject(new Error(`Build failed with code ${code ?? signal}`));
            }
        });
    });

    const child = spawn('../server/build/dashica-server', {
        stdio: 'inherit',  // Share stdin/stdout/stderr
        cwd: process.cwd(),
        env: process.env,
    });

    child.on('exit', (code, signal) => {
        process.exit(code ?? (signal ? 1 : 0));
    });
}