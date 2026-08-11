import { createServer } from 'node:net';
import { randomUUID } from 'node:crypto';
import { chmod, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runCommand, redactCommandError } from './command.mjs';

const excludedServices = [
  'studio',
  'imgproxy',
  'mailpit',
  'realtime',
  'edge-runtime',
  'logflare',
  'vector',
  'supavisor',
  'postgres-meta',
];

async function reservePort() {
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}

async function freePorts(count) {
  const ports = [];
  while (ports.length < count) {
    const port = await reservePort();
    if (!ports.includes(port)) ports.push(port);
  }
  return ports;
}

function updateConfig(source, projectId, ports) {
  const replacements = new Map([
    ['root.project_id', JSON.stringify(projectId)],
    ['api.port', String(ports.api)],
    ['db.port', String(ports.db)],
    ['db.shadow_port', String(ports.shadow)],
    ['db.major_version', '17'],
    ['studio.port', String(ports.studio)],
    ['inbucket.port', String(ports.inbucket)],
    ['inbucket.smtp_port', String(ports.smtp)],
    ['inbucket.pop3_port', String(ports.pop3)],
    ['storage.enabled', 'true'],
    ['auth.enabled', 'true'],
    ['auth.mfa.totp.enroll_enabled', 'true'],
    ['auth.mfa.totp.verify_enabled', 'true'],
    ['realtime.enabled', 'false'],
    ['analytics.enabled', 'false'],
    ['edge_runtime.enabled', 'false'],
    ['db.migrations.enabled', 'false'],
    ['db.seed.enabled', 'false'],
  ]);
  let section = 'root';
  const seen = new Set();
  const lines = source.split(/\r?\n/u).map((line) => {
    const sectionMatch = line.match(/^\s*\[([^\]]+)\]\s*$/u);
    if (sectionMatch) {
      section = sectionMatch[1];
      return line;
    }
    const keyMatch = line.match(/^(\s*)([A-Za-z0-9_]+)\s*=.*$/u);
    if (!keyMatch) return line;
    const compound = `${section}.${keyMatch[2]}`;
    if (!replacements.has(compound)) return line;
    seen.add(compound);
    return `${keyMatch[1]}${keyMatch[2]} = ${replacements.get(compound)}`;
  });

  if (!seen.has('db.migrations.enabled')) {
    lines.push('', '[db.migrations]', 'enabled = false');
  }
  if (!seen.has('db.seed.enabled')) {
    lines.push('', '[db.seed]', 'enabled = false');
  }
  return `${lines.join('\n')}\n`;
}

function parseStatusEnv(value) {
  const result = {};
  for (const line of value.split(/\r?\n/u)) {
    const match = line.match(/^([A-Z0-9_]+)=(?:"([^"]*)"|(.*))$/u);
    if (match) result[match[1]] = match[2] ?? match[3] ?? '';
  }
  return result;
}

function assertLoopbackUrl(value, label) {
  const url = new URL(value);
  if (!['127.0.0.1', 'localhost', '::1'].includes(url.hostname)) {
    throw new Error(`${label} is not loopback`);
  }
}

export async function createLocalStack({ runNumber, repoRoot, supabaseBin, dockerBin, env }) {
  const random = randomUUID().slice(0, 8);
  const projectId = `alamin-role-matrix-r${runNumber}-${random}`;
  const workdir = await mkdtemp(join(tmpdir(), `${projectId}-`));
  const values = await freePorts(8);
  const ports = {
    api: values[0],
    db: values[1],
    shadow: values[2],
    studio: values[3],
    inbucket: values[4],
    smtp: values[5],
    pop3: values[6],
    analytics: values[7],
  };

  let started = false;
  try {
    await runCommand(supabaseBin, ['init', '--workdir', workdir], { cwd: workdir, env });
    const configPath = join(workdir, 'supabase', 'config.toml');
    const config = await readFile(configPath, 'utf8');
    const updated = updateConfig(config, projectId, ports);
    const forbiddenCredentialLine = updated.split(/\r?\n/u).some((line) => {
      const assignment = line.match(/^\s*([A-Za-z0-9_]*(?:project_ref|access_token|service_role|password)[A-Za-z0-9_]*)\s*=\s*["']([^"']*)["']/iu);
      if (!assignment) return false;
      const value = assignment[2];
      return value !== '' && !value.startsWith('env(');
    });
    if (forbiddenCredentialLine) {
      throw new Error('Temporary config contains a forbidden remote or credential field');
    }
    await writeFile(configPath, updated, { encoding: 'utf8', mode: 0o600 });
    await chmod(configPath, 0o600).catch(() => {});

    await runCommand(
      supabaseBin,
      ['start', '--workdir', workdir, '--exclude', excludedServices.join(',')],
      { cwd: workdir, env, timeoutMs: 1_200_000 },
    );
    started = true;

    const status = await runCommand(supabaseBin, ['status', '--workdir', workdir, '-o', 'env'], {
      cwd: workdir,
      env,
    });
    const statusEnv = parseStatusEnv(status.stdout);
    if (!statusEnv.API_URL || !statusEnv.ANON_KEY || !statusEnv.SERVICE_ROLE_KEY) {
      throw new Error('Local Supabase status did not return the required in-memory values');
    }
    assertLoopbackUrl(statusEnv.API_URL, 'API URL');
    if (statusEnv.DB_URL) assertLoopbackUrl(statusEnv.DB_URL, 'DB URL');

    const container = `supabase_db_${projectId}`;
    const inspect = await runCommand(dockerBin, ['inspect', '-f', '{{.State.Status}}|{{.State.Health.Status}}', container], {
      env,
    });
    if (!/^running\|healthy\s*$/u.test(inspect.stdout.trim())) {
      throw new Error('Disposable PostgreSQL container is not healthy');
    }

    const baseline = await readFile(join(repoRoot, 'supabase', 'bootstrap', 'baseline.sql'));
    await runCommand(
      dockerBin,
      ['exec', '-i', container, 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-U', 'supabase_admin', '-d', 'postgres'],
      { env, input: baseline, timeoutMs: 300_000 },
    );
    const verification = await readFile(join(repoRoot, 'supabase', 'bootstrap', 'verify.sql'));
    const verified = await runCommand(
      dockerBin,
      ['exec', '-i', container, 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-U', 'supabase_admin', '-d', 'postgres'],
      { env, input: verification, timeoutMs: 300_000 },
    );
    if (!verified.stdout.includes('VERIFIED_BOOTSTRAP_MANIFEST_PASS')) {
      throw new Error('Bootstrap verification marker is absent');
    }

    const forwardDirectory = join(repoRoot, 'supabase', 'forward-migrations');
    const forwardMigrations = (await readdir(forwardDirectory))
      .filter((name) => /^\d+_[a-z0-9_]+\.sql$/u.test(name))
      .sort((left, right) => left.localeCompare(right));
    for (const name of forwardMigrations) {
      const sql = await readFile(join(forwardDirectory, name));
      await runCommand(
        dockerBin,
        ['exec', '-i', container, 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-U', 'supabase_admin', '-d', 'postgres'],
        { env, input: sql, timeoutMs: 300_000 },
      );
    }

    return {
      workdir,
      projectId,
      ports,
      container,
      apiUrl: statusEnv.API_URL,
      anonKey: statusEnv.ANON_KEY,
      serviceRoleKey: statusEnv.SERVICE_ROLE_KEY,
      excludedServices,
      baselineVerified: true,
      forwardMigrations,
      started,
    };
  } catch (error) {
    error.safeMessage = redactCommandError(error);
    const partialStack = { workdir, projectId, started };
    const cleanup = await cleanupLocalStack(partialStack, { supabaseBin, dockerBin, env });
    if (!cleanup.ok) {
      error.safeMessage += `; cleanup residual: ${cleanup.residual.join(', ')}`;
    }
    error.partialStack = partialStack;
    throw error;
  }
}

export async function queryLocalSql(stack, dockerBin, env, sql) {
  const result = await runCommand(
    dockerBin,
    ['exec', stack.container, 'psql', '-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-U', 'supabase_admin', '-d', 'postgres', '-c', sql],
    { env, timeoutMs: 120_000 },
  );
  return result.stdout.trim();
}

export async function cleanupLocalStack(stack, { supabaseBin, dockerBin, env }) {
  let residual = [];
  if (!stack) return { ok: true, residual };
  if (stack.started) {
    await runCommand(
      supabaseBin,
      ['stop', '--workdir', stack.workdir, '--project-id', stack.projectId, '--no-backup'],
      { cwd: stack.workdir, env, timeoutMs: 300_000, allowFailure: true },
    );
  }

  const inventory = async () => {
    const found = [];
    for (const kind of ['container', 'network', 'volume']) {
    const listArgs = kind === 'container'
      ? ['ps', '-a', '--format', '{{.Names}}']
      : kind === 'network'
        ? ['network', 'ls', '--format', '{{.Name}}']
        : ['volume', 'ls', '--format', '{{.Name}}'];
    const list = await runCommand(dockerBin, listArgs, { env, allowFailure: true });
      found.push(...list.stdout.split(/\r?\n/u).filter((name) => name.includes(stack.projectId)));
    }
    return found;
  };
  residual = await inventory();

  for (const volume of residual.filter((name) => name.startsWith('supabase_edge_runtime_'))) {
    const users = await runCommand(dockerBin, ['ps', '-a', '--filter', `volume=${volume}`, '-q'], { env, allowFailure: true });
    if (!users.stdout.trim()) {
      await runCommand(dockerBin, ['volume', 'rm', volume], { env, allowFailure: true });
    }
  }
  residual = await inventory();

  if (residual.length === 0) {
    await rm(stack.workdir, { recursive: true, force: true });
  }
  return { ok: residual.length === 0, residual };
}
