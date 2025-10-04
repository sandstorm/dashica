import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import YAML from 'yaml';

// NOTE: this file is ugly code, developed by AI agent (but working...)

function findConfigPath() {
  // Look for dashica_config.yaml in the current working directory
  const cwd = process.cwd();
  return join(cwd, 'dashica_config.yaml');
}

function parseConnection(cfg, name) {
  if (!cfg || typeof cfg !== 'object') return null;
  const ch = cfg.clickhouse;
  if (!ch || typeof ch !== 'object') return null;
  const conn = ch[name];
  return conn || null;
}

function buildClickhouseArgs(conn) {
  if (!conn || !conn.nativeHostPort) {
    throw new Error('Invalid connection config: missing nativeHostPort');
  }
  const [host, port] = conn.nativeHostPort.split(':')

  const args = ['client', '--host', host, '--port', String(port)];
  if (conn.database) args.push('--database', String(conn.database));
  if (conn.user) args.push('--user', String(conn.user));
  if (conn.password !== undefined) args.push('--password', String(conn.password ?? ''));
  return args;
}

async function trySpawn(binary, args) {
  return new Promise((resolve) => {
    const child = spawn(binary, args, { stdio: 'inherit' });
    child.on('error', (err) => {
      resolve({ ok: false, error: err });
    });
    child.on('exit', (code, signal) => {
      resolve({ ok: true, code, signal });
    });
  });
}

export default async function clickhouseCli({ flags, args /*, packageRoot */ }) {
  const connName = args[0] || 'default';
  const configPath = findConfigPath();

  let raw;
  try {
    raw = readFileSync(configPath, 'utf8');
  } catch (e) {
    console.error(`dashica_config.yaml not found at ${configPath}.`);
    console.error('Please create dashica_config.yaml with a "clickhouse" section.');
    process.exit(1);
  }

  let cfg;
  try {
    cfg = YAML.parse(raw);
  } catch (e) {
    console.error('Failed to parse dashica_config.yaml: ' + (e && e.message ? e.message : e));
    process.exit(1);
  }

  const conn = parseConnection(cfg, connName);
  if (!conn) {
    const available = cfg && cfg.clickhouse ? Object.keys(cfg.clickhouse).join(', ') : '(none)';
    console.error(`ClickHouse connection "${connName}" not found in dashica_config.yaml.`);
    console.error(`Available connections: ${available}`);
    process.exit(1);
  }

  let chArgs;
  try {
    chArgs = buildClickhouseArgs(conn);
  } catch (e) {
    console.error(e.message || String(e));
    process.exit(1);
  }

  // Try "clickhouse" (subcommand "client"). If missing, try "clickhouse-client".
  console.log(`Starting ClickHouse client: clickhouse ${chArgs.join(' ')}`);
  let result = await trySpawn('clickhouse', chArgs);
  if (!result.ok && result.error && (result.error.code === 'ENOENT')) {
    // Fallback
    result = await trySpawn('clickhouse-client', chArgs.slice(1)); // clickhouse-client doesn't need the "client" subcommand
  }

  if (!result.ok) {
    console.error('Failed to start ClickHouse client: ' + (result.error && result.error.message ? result.error.message : result.error));
    process.exit(1);
  }

  // Propagate exit code
  if (typeof result.code === 'number') {
    process.exit(result.code);
  } else if (result.signal) {
    // If terminated by signal, exit with non-zero
    console.error(`ClickHouse client terminated by signal ${result.signal}`);
    process.exit(1);
  }
}