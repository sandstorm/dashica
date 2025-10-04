import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageRoot = join(__dirname, '../..');

// Parse arguments
const [,, command, ...args] = process.argv;

// Command registry
const commands = {
    'dist': () => import('./commands/dist.js'),
    'preview-frontend': () => import('./commands/preview-frontend.js'),
    'server': () => import('./commands/server.js'),
    'clickhouse-cli': () => import('./commands/clickhouse-cli.js'),
    init: () => import('./commands/init.js'),
    help: () => import('./commands/help.js'),
};



// Parse flags from args
function parseFlags(args) {
    const flags = {};
    const positional = [];

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];

        if (arg.startsWith('--')) {
            const key = arg.slice(2);
            const nextArg = args[i + 1];

            // Check if next arg is a value or another flag
            if (nextArg && !nextArg.startsWith('-')) {
                flags[key] = nextArg;
                i++; // Skip next arg
            } else {
                flags[key] = true; // Boolean flag
            }
        } else if (arg.startsWith('-') && arg.length === 2) {
            // Short flag
            const key = arg.slice(1);
            flags[key] = true;
        } else {
            positional.push(arg);
        }
    }

    return { flags, positional };
}

// Run command
async function run() {
    // Show help if no command or --help
    if (!command || command === 'help' || args.includes('--help') || args.includes('-h')) {
        const helpModule = await commands.help();
        await helpModule.default({ command: command === 'help' ? args[0] : null });
        return;
    }

    // Show version
    if (command === '--version' || command === '-v') {
        const pkg = await import(join(packageRoot, 'package.json'), { assert: { type: 'json' } });
        console.log(pkg.default.version);
        return;
    }

    // Get command module
    const commandLoader = commands[command];

    if (!commandLoader) {
        console.error(`Unknown command: ${command}`);
        console.error(`Run 'dashica help' for usage.`);
        process.exit(1);
    }

    // Load and execute command
    const { flags, positional } = parseFlags(args);
    const commandModule = await commandLoader();

    await commandModule.default({
        flags,
        args: positional,
        packageRoot,
    });
}

// Execute with error handling
run().catch(err => {
    console.error(err.message || err);
    process.exit(1);
});
