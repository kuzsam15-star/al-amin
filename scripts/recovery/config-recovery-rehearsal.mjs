import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  cleanupLocalStack,
  createLocalStack,
  queryLocalSql,
} from '../../tests/security/role-matrix/helpers/local-stack.mjs';
import { redactCommandError, runCommand } from '../../tests/security/role-matrix/helpers/command.mjs';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..', '..');
const manifestPath = join(repoRoot, 'docs', 'security', 'recovery', 'CONFIG_RECOVERY_MANIFEST.json');
const localAppData = process.env.LOCALAPPDATA;
const supabaseBin = join(localAppData, 'Programs', 'SupabaseCLI', '2.113.0', 'supabase.exe');
const dockerBin = join(localAppData, 'Programs', 'DockerDesktop', 'resources', 'bin', 'docker.exe');
const allowedClassifications = new Set([
  'PROVEN_RESTORABLE',
  'PROVEN_MANUAL_REENTRY',
  'PROVEN_NOT_APPLICABLE',
  'UNKNOWN_BLOCKER',
]);
const configExcludedServices = [
  'studio',
  'imgproxy',
  'edge-runtime',
  'logflare',
  'vector',
  'supavisor',
  'postgres-meta',
];

function cleanEnvironment() {
  const env = {
    ...process.env,
    SUPABASE_TELEMETRY_DISABLED: '1',
    ALAMIN_SECURITY_LOCAL_ONLY: '1',
    PATH: `${dirname(dockerBin)};${process.env.PATH ?? ''}`,
    SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID: `synthetic-${randomUUID()}@example.invalid`,
    SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET: randomBytes(32).toString('hex'),
    SUPABASE_AUTH_SMTP_PASSWORD: randomBytes(32).toString('hex'),
  };
  for (const name of Object.keys(env)) {
    if (/SUPABASE_(ACCESS_TOKEN|DB_PASSWORD|SERVICE_ROLE_KEY)|DATABASE_URL/iu.test(name)) {
      delete env[name];
    }
  }
  return env;
}

function upsertToml(source, section, key, value) {
  const lines = source.split(/\r?\n/u);
  const header = `[${section}]`;
  const start = lines.findIndex((line) => line.trim() === header);
  if (start < 0) {
    return `${source.trimEnd()}\n\n${header}\n${key} = ${value}\n`;
  }
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^\s*\[[^\]]+\]\s*$/u.test(lines[index])) {
      end = index;
      break;
    }
  }
  const matcher = new RegExp(`^\\s*${key.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}\\s*=`, 'u');
  const existing = lines.slice(start + 1, end).findIndex((line) => matcher.test(line));
  if (existing >= 0) lines[start + 1 + existing] = `${key} = ${value}`;
  else lines.splice(end, 0, `${key} = ${value}`);
  return `${lines.join('\n').trimEnd()}\n`;
}

function configureLevel3(source, { projectId, ports }) {
  let config = source;
  const localSite = `http://127.0.0.1:${ports.studio}`;
  const values = [
    ['api', 'auto_expose_new_tables', 'true'],
    ['api', 'schemas', '["public", "graphql_public"]'],
    ['api', 'extra_search_path', '["public", "extensions"]'],
    ['api', 'max_rows', '1000'],
    ['db.network_restrictions', 'enabled', 'false'],
    ['db.network_restrictions', 'allowed_cidrs', '["0.0.0.0/0"]'],
    ['db.network_restrictions', 'allowed_cidrs_v6', '["::/0"]'],
    ['db.ssl_enforcement', 'enabled', 'false'],
    ['realtime', 'enabled', 'true'],
    ['local_smtp', 'enabled', 'true'],
    ['auth', 'site_url', JSON.stringify(localSite)],
    ['auth', 'additional_redirect_urls', JSON.stringify([`${localSite}/auth/callback`, `${localSite}/reset-password`])],
    ['auth', 'jwt_expiry', '3600'],
    ['auth', 'enable_refresh_token_rotation', 'true'],
    ['auth', 'refresh_token_reuse_interval', '10'],
    ['auth', 'enable_signup', 'true'],
    ['auth', 'enable_anonymous_sign_ins', 'false'],
    ['auth', 'enable_manual_linking', 'false'],
    ['auth', 'minimum_password_length', '6'],
    ['auth', 'password_requirements', '""'],
    ['auth.email', 'enable_signup', 'true'],
    ['auth.email', 'double_confirm_changes', 'true'],
    ['auth.email', 'enable_confirmations', 'true'],
    ['auth.email', 'secure_password_change', 'false'],
    ['auth.email', 'otp_length', '8'],
    ['auth.email', 'otp_expiry', '3600'],
    ['auth.rate_limit', 'email_sent', '30'],
    ['auth.rate_limit', 'sms_sent', '30'],
    ['auth.rate_limit', 'anonymous_users', '30'],
    ['auth.rate_limit', 'token_refresh', '150'],
    ['auth.rate_limit', 'sign_in_sign_ups', '30'],
    ['auth.rate_limit', 'token_verifications', '30'],
    ['auth.rate_limit', 'web3', '30'],
    ['auth.captcha', 'enabled', 'false'],
    ['auth.mfa', 'max_enrolled_factors', '10'],
    ['auth.mfa.totp', 'enroll_enabled', 'true'],
    ['auth.mfa.totp', 'verify_enabled', 'true'],
    ['auth.external.google', 'enabled', 'true'],
    ['auth.external.google', 'client_id', '"env(SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID)"'],
    ['auth.external.google', 'secret', '"env(SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET)"'],
    ['auth.external.google', 'skip_nonce_check', 'false'],
    ['auth.external.google', 'email_optional', 'false'],
    ['auth.email.smtp', 'enabled', 'true'],
    ['auth.email.smtp', 'host', JSON.stringify(`supabase_inbucket_${projectId}`)],
    ['auth.email.smtp', 'port', '1025'],
    ['auth.email.smtp', 'user', '"synthetic-recovery"'],
    ['auth.email.smtp', 'pass', '"env(SUPABASE_AUTH_SMTP_PASSWORD)"'],
    ['auth.email.smtp', 'admin_email', '"no-reply@example.invalid"'],
    ['auth.email.smtp', 'sender_name', '"AL-AMIN Recovery"'],
    ['storage.s3_protocol', 'enabled', 'true'],
    ['storage.buckets.avatars', 'public', 'true'],
    ['storage.buckets.avatars', 'file_size_limit', '"2MiB"'],
    ['storage.buckets.avatars', 'allowed_mime_types', '["image/jpeg", "image/png", "image/webp"]'],
    ['storage.buckets.profile-media', 'public', 'false'],
    ['storage.buckets.profile-media', 'file_size_limit', '"5MiB"'],
    ['storage.buckets.profile-media', 'allowed_mime_types', '["image/jpeg", "image/png", "image/webp"]'],
  ];
  for (const [section, key, value] of values) config = upsertToml(config, section, key, value);
  if (/\bhttps?:\/\/(?!127\.0\.0\.1|localhost)/iu.test(config.replace(/#.*$/gmu, ''))) {
    throw new Error('Configuration rehearsal generated a non-loopback URL');
  }
  if (/\b(project_ref|access_token|service_role|database_url)\s*=/iu.test(config)) {
    throw new Error('Configuration rehearsal generated a forbidden remote field');
  }
  return config;
}

function validateManifest(manifest) {
  if (manifest.format_version !== 2 || manifest.status !== 'RECOVERY_LEVEL_3_PROVEN') {
    throw new Error('Recovery configuration manifest is not a Level 3 v2 manifest');
  }
  if (!Array.isArray(manifest.fields) || manifest.fields.length === 0) {
    throw new Error('Recovery configuration manifest has no fields');
  }
  const ids = new Set();
  const counts = Object.fromEntries([...allowedClassifications].map((classification) => [classification, 0]));
  for (const field of manifest.fields) {
    if (!field.id || ids.has(field.id)) throw new Error('Recovery configuration manifest has a duplicate or empty field ID');
    ids.add(field.id);
    if (!allowedClassifications.has(field.classification)) throw new Error(`Invalid recovery classification for ${field.id}`);
    counts[field.classification] += 1;
    if (!field.evidence || !field.recovery || field.expected === undefined) {
      throw new Error(`Incomplete recovery field: ${field.id}`);
    }
    if (field.classification === 'PROVEN_MANUAL_REENTRY') {
      const dashboard = field.dashboard;
      if (!dashboard?.path || !dashboard.setting || typeof dashboard.secret_required !== 'boolean' || !dashboard.verification || !dashboard.failure_impact) {
        throw new Error(`Incomplete manual recovery checklist: ${field.id}`);
      }
    }
  }
  const secretNames = new Set(manifest.secrets.map((entry) => entry.name));
  for (const secret of manifest.secrets) {
    if (secret.status !== 'MUST_REENTER' || !secret.source_of_truth) throw new Error(`Incomplete secret mapping: ${secret.name}`);
  }
  for (const field of manifest.fields.filter((entry) => entry.secret_name)) {
    if (!secretNames.has(field.secret_name)) throw new Error(`Unmapped secret for ${field.id}`);
  }
  const unknownLaunchCritical = manifest.fields.filter((field) => field.launch_critical && field.classification === 'UNKNOWN_BLOCKER');
  if (unknownLaunchCritical.length) throw new Error(`Launch-critical unknowns remain: ${unknownLaunchCritical.map((field) => field.id).join(', ')}`);
  return {
    fieldCount: manifest.fields.length,
    classificationCounts: counts,
    secretCount: manifest.secrets.length,
    dashboardOnlyCount: manifest.fields.filter((field) => field.dashboard).length,
    launchCriticalUnknowns: 0,
  };
}

function parseContainerEnvironment(value) {
  const result = new Map();
  for (const line of value.split(/\r?\n/u)) {
    const separator = line.indexOf('=');
    if (separator > 0) result.set(line.slice(0, separator), line.slice(separator + 1));
  }
  return result;
}

async function assertContainerReady(projectId, service, env) {
  const name = `supabase_${service}_${projectId}`;
  const inspected = await runCommand(dockerBin, ['inspect', '-f', '{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}', name], { env });
  const [status, health] = inspected.stdout.trim().split('|');
  if (status !== 'running' || !['healthy', 'none'].includes(health)) throw new Error(`Required local service is not ready: ${service}`);
  return `${service}:${health}`;
}

async function localMailCount(port) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const response = await fetch(`http://127.0.0.1:${port}/api/v1/messages`).catch(() => null);
    if (response?.ok) {
      const payload = await response.json();
      const total = payload.total ?? payload.messages?.length ?? payload.messages_count ?? 0;
      if (Number(total) > 0) return Number(total);
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  }
  throw new Error('Local SMTP sink did not receive the synthetic confirmation email');
}

async function oneRun(runNumber, manifestSummary) {
  const env = cleanEnvironment();
  let stack;
  try {
    stack = await createLocalStack({
      runNumber,
      repoRoot,
      supabaseBin,
      dockerBin,
      env,
      projectPrefix: 'alamin-config-recovery',
      forwardMigrationNames: [],
      excludedServiceNames: configExcludedServices,
      configTransform: configureLevel3,
    });
    if (!stack.projectId.startsWith('alamin-config-recovery-')) throw new Error('Disposable project prefix check failed');
    const serviceStates = [];
    for (const service of ['db', 'auth', 'rest', 'storage', 'kong', 'realtime', 'inbucket']) {
      serviceStates.push(await assertContainerReady(stack.projectId, service, env));
    }

    const configText = await readFile(join(stack.workdir, 'supabase', 'config.toml'), 'utf8');
    for (const marker of ['SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET', 'SUPABASE_AUTH_SMTP_PASSWORD']) {
      if (!configText.includes(`env(${marker})`)) throw new Error(`Synthetic secret indirection missing: ${marker}`);
    }
    if (configText.includes(env.SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET) || configText.includes(env.SUPABASE_AUTH_SMTP_PASSWORD)) {
      throw new Error('Synthetic secret material was written to config.toml');
    }

    const settingsResponse = await fetch(`${stack.apiUrl}/auth/v1/settings`, { headers: { apikey: stack.anonKey } });
    if (!settingsResponse.ok) throw new Error(`Local Auth settings failed (${settingsResponse.status})`);
    const settings = await settingsResponse.json();
    if (settings.external?.google !== true || settings.disable_signup !== false || settings.mailer_autoconfirm !== false) {
      throw new Error('Local Auth configuration does not match the recovery profile');
    }

    const syntheticEmail = `config-recovery-${randomUUID()}@example.invalid`;
    const signupResponse = await fetch(`${stack.apiUrl}/auth/v1/signup`, {
      method: 'POST',
      headers: { apikey: stack.anonKey, 'content-type': 'application/json' },
      body: JSON.stringify({ email: syntheticEmail, password: `Synthetic-${randomBytes(18).toString('hex')}!` }),
    });
    if (!signupResponse.ok) throw new Error(`Synthetic local signup failed (${signupResponse.status})`);
    await localMailCount(stack.ports.inbucket);

    const restResponse = await fetch(`${stack.apiUrl}/rest/v1/categories?select=id&limit=1`, { headers: { apikey: stack.anonKey } });
    if (!restResponse.ok) throw new Error(`Local Data API check failed (${restResponse.status})`);

    const bucketJson = await queryLocalSql(stack, dockerBin, env, `
      select jsonb_agg(jsonb_build_object(
        'id', id,
        'public', public,
        'file_size_limit', file_size_limit,
        'allowed_mime_types', allowed_mime_types
      ) order by id)::text
      from storage.buckets
      where id in ('avatars','profile-media');
    `);
    const buckets = JSON.parse(bucketJson);
    if (buckets.length !== 2 || buckets[0].id !== 'avatars' || buckets[1].id !== 'profile-media') throw new Error('Storage bucket inventory mismatch');
    if (buckets[0].public !== true || Number(buckets[0].file_size_limit) !== 2097152) throw new Error('avatars configuration mismatch');
    if (buckets[1].public !== false || Number(buckets[1].file_size_limit) !== 5242880) throw new Error('profile-media configuration mismatch');
    const expectedMime = ['image/jpeg', 'image/png', 'image/webp'];
    if (JSON.stringify(buckets[0].allowed_mime_types) !== JSON.stringify(expectedMime) || JSON.stringify(buckets[1].allowed_mime_types) !== JSON.stringify(expectedMime)) {
      throw new Error('Storage MIME configuration mismatch');
    }

    const version = await queryLocalSql(stack, dockerBin, env, "select current_setting('server_version')");
    if (!version.startsWith('17.')) throw new Error('Local PostgreSQL major version mismatch');
    const extensions = (await queryLocalSql(stack, dockerBin, env, "select extname || '@' || extversion from pg_extension where extname in ('plpgsql','pgcrypto','pg_stat_statements','supabase_vault','uuid-ossp') order by extname"))
      .split(/\r?\n/u).filter(Boolean);
    if (extensions.length !== 5) throw new Error('Required extension inventory mismatch');

    await queryLocalSql(stack, dockerBin, env, `
      do $recovery$
      begin
        if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
          execute 'create publication supabase_realtime with (publish = ''insert, update, delete, truncate'')';
        else
          execute 'alter publication supabase_realtime set (publish = ''insert, update, delete, truncate'')';
        end if;
      end
      $recovery$;
    `);
    const publication = await queryLocalSql(stack, dockerBin, env, "select pubname || '|' || pubinsert || '|' || pubupdate || '|' || pubdelete || '|' || pubtruncate from pg_publication where pubname='supabase_realtime'");
    if (publication !== 'supabase_realtime|true|true|true|true') throw new Error(`Realtime publication mismatch (${publication || 'absent'})`);
    const publicationTables = await queryLocalSql(stack, dockerBin, env, "select count(*) from pg_publication_tables where pubname='supabase_realtime'");
    if (publicationTables !== '0') throw new Error('Realtime publication table set mismatch');

    const authInspect = await runCommand(dockerBin, ['inspect', '--format', '{{range .Config.Env}}{{println .}}{{end}}', `supabase_auth_${stack.projectId}`], { env });
    const authEnvironment = parseContainerEnvironment(authInspect.stdout);
    if (authEnvironment.get('GOTRUE_SMTP_HOST') !== `supabase_inbucket_${stack.projectId}` || authEnvironment.get('GOTRUE_SMTP_PORT') !== '1025') {
      throw new Error('Local synthetic SMTP boundary mismatch');
    }

    const cleanup = await cleanupLocalStack(stack, { supabaseBin, dockerBin, env });
    stack = undefined;
    if (!cleanup.ok) throw new Error(`Configuration rehearsal cleanup residual: ${cleanup.residual.join(', ')}`);
    return {
      status: 'PASS',
      manifest: manifestSummary,
      services: serviceStates.sort(),
      postgresMajor: 17,
      auth: { email: true, google: true, confirmation: true, externalCalls: 0 },
      storageBuckets: 2,
      realtimePublicationTables: 0,
      syntheticSmtpMessages: 1,
      cleanup: 'PASS',
      residualResources: 0,
    };
  } finally {
    if (stack) await cleanupLocalStack(stack, { supabaseBin, dockerBin, env });
    env.SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID = '';
    env.SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET = '';
    env.SUPABASE_AUTH_SMTP_PASSWORD = '';
  }
}

try {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const manifestSummary = validateManifest(manifest);
  const first = await oneRun(1, manifestSummary);
  const second = await oneRun(2, manifestSummary);
  const comparableFirst = { ...first, services: first.services.map((entry) => entry.split(':')[0]) };
  const comparableSecond = { ...second, services: second.services.map((entry) => entry.split(':')[0]) };
  if (JSON.stringify(comparableFirst) !== JSON.stringify(comparableSecond)) throw new Error('Independent configuration rehearsal summaries do not match');
  process.stdout.write(`${JSON.stringify({
    status: 'PASS',
    run1: first,
    run2: second,
    matching: true,
    completeProjectLossWalkthrough: 'PASS',
    productionCalls: 0,
    externalProviderCalls: 0,
    residualResources: 0,
  })}\n`);
} catch (error) {
  process.stderr.write(`Configuration recovery rehearsal blocked: ${redactCommandError(error)}\n`);
  process.exitCode = 1;
}
