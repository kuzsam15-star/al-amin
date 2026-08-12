import { randomBytes, randomUUID } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLocalStack, cleanupLocalStack, queryLocalSql } from '../../tests/security/role-matrix/helpers/local-stack.mjs';
import { runCommand, redactCommandError } from '../../tests/security/role-matrix/helpers/command.mjs';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..', '..');
const localAppData = process.env.LOCALAPPDATA;
const supabaseBin = join(localAppData, 'Programs', 'SupabaseCLI', '2.113.0', 'supabase.exe');
const dockerBin = join(localAppData, 'Programs', 'DockerDesktop', 'resources', 'bin', 'docker.exe');
const ageBin = join(localAppData, 'AL-AMIN-Recovery', 'tools', 'age-1.3.1', 'age.exe');
const ageKeygenBin = join(localAppData, 'AL-AMIN-Recovery', 'tools', 'age-1.3.1', 'age-keygen.exe');
const powershell = 'powershell.exe';
const env = {
  ...process.env,
  SUPABASE_TELEMETRY_DISABLED: '1',
  ALAMIN_SECURITY_LOCAL_ONLY: '1',
  PATH: `${dirname(dockerBin)};${process.env.PATH ?? ''}`,
};
for (const name of Object.keys(env)) {
  if (/SUPABASE_(ACCESS_TOKEN|DB_PASSWORD|SERVICE_ROLE_KEY)|DATABASE_URL/i.test(name)) delete env[name];
}

async function ps(file, args, extraEnv = {}) {
  return await runCommand(powershell, ['-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(scriptDir, file), ...args], {
    cwd: repoRoot,
    env: { ...env, ...extraEnv },
    timeoutMs: 1_200_000,
  });
}

async function createAuthUser(stack) {
  const email = `recovery-${randomUUID()}@example.invalid`;
  const password = `Synthetic-${randomBytes(18).toString('hex')}!`;
  const response = await fetch(`${stack.apiUrl}/auth/v1/admin/users`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${stack.serviceRoleKey}`,
      apikey: stack.serviceRoleKey,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  if (!response.ok) throw new Error(`Synthetic Auth fixture creation failed (${response.status})`);
  const body = await response.json();
  if (!/^[0-9a-f-]{36}$/u.test(body.id)) throw new Error('Synthetic Auth fixture returned an invalid identifier');
  return body.id;
}

async function seedSyntheticSource(stack) {
  const userId = await createAuthUser(stack);
  const categoryId = randomUUID();
  const applicationId = randomUUID();
  await queryLocalSql(stack, dockerBin, env, `
    insert into public.categories(id,name,slug,is_active,group_name) values ('${categoryId}','Synthetic Recovery Category','synthetic-recovery-${categoryId.slice(0,8)}',true,'Synthetic Recovery Group');
    insert into public.applications(id,owner_id,full_name,contact,country,city,category_text,category_id,contract_version,profile_summary,description,services,help_topics,work_offers,consent_truthful,consent_personal_data,status)
    values ('${applicationId}','${userId}','Synthetic Recovery Person','synthetic@example.invalid','Synthetic','Synthetic','Synthetic','${categoryId}',2,'Synthetic recovery profile',repeat('Synthetic recovery description. ',3),'Synthetic recovery service','[{"title":"Synthetic topic"}]'::jsonb,'[{"title":"Synthetic offer","mode":"online"}]'::jsonb,true,true,'new');
  `);
  const tinyPng = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c63606060f80f0001040100f5f57f5a0000000049454e44ae426082', 'hex');
  const objects = [
    ['avatars', `synthetic/${randomUUID()}.png`],
    ['profile-media', `submissions/${userId}/${randomUUID()}.png`],
  ];
  for (const [bucket, path] of objects) {
    const encoded = path.split('/').map(encodeURIComponent).join('/');
    const response = await fetch(`${stack.apiUrl}/storage/v1/object/${bucket}/${encoded}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${stack.serviceRoleKey}`, apikey: stack.serviceRoleKey, 'content-type': 'image/png', 'x-upsert': 'false' },
      body: tinyPng,
    });
    if (!response.ok) throw new Error(`Synthetic Storage fixture creation failed (${response.status})`);
  }
  return { authUsers: 1, applicationRows: 1, storageObjects: 2 };
}

async function packageEncrypted(payloadRoot, workRoot) {
  const zipPath = join(workRoot, 'payload.zip');
  const archivePath = join(workRoot, 'synthetic-recovery.zip.age');
  const identityPath = join(workRoot, 'synthetic-age-identity.txt');
  const keygen = await runCommand(ageKeygenBin, ['-o', identityPath], { env, timeoutMs: 30_000 });
  const publicMatch = keygen.stderr.match(/Public key:\s*(age1[a-z0-9]+)/u);
  if (!publicMatch) throw new Error('Synthetic age key generation did not return a public recipient');
  await ps('New-AlAminRecoveryZip.ps1', ['-PayloadRoot', payloadRoot, '-OutputZip', zipPath]);
  await runCommand(ageBin, ['-r', publicMatch[1], '-o', archivePath, zipPath], { env, timeoutMs: 300_000 });
  await rm(zipPath, { force: true });
  return { archivePath, identityPath };
}

async function run() {
  const workRoot = await mkdtemp(join(tmpdir(), 'alamin-recovery-preflight-'));
  const payloadRoot = join(workRoot, 'payload');
  const databaseDir = join(payloadRoot, 'database');
  const storageDir = join(payloadRoot, 'storage');
  const configDir = join(payloadRoot, 'config');
  await mkdir(databaseDir, { recursive: true });
  await mkdir(storageDir, { recursive: true });
  await mkdir(configDir, { recursive: true });
  let source;
  let target;
  let restoreRoot;
  try {
    source = await createLocalStack({ runNumber: 1, repoRoot, supabaseBin, dockerBin, env, projectPrefix: 'alamin-recovery-source' });
    const fixtures = await seedSyntheticSource(source);
    const pgpassProbe = await ps('Test-AlAminPgpassIsolation.ps1', ['-LocalContainer',source.container,'-LocalProjectId',source.projectId,'-LocalApiUrl',source.apiUrl]);
    const pgpassIsolation = JSON.parse(pgpassProbe.stdout.trim().split(/\r?\n/u).at(-1));
    await ps('Export-AlAminDatabaseBackup.ps1', ['-SourceMode','LocalContainer','-OutputDirectory',databaseDir,'-LocalContainer',source.container,'-LocalProjectId',source.projectId,'-LocalApiUrl',source.apiUrl]);
    await ps('Export-AlAminStorageBackup.ps1', ['-SourceMode','LocalApi','-OutputDirectory',storageDir,'-LocalContainer',source.container,'-LocalProjectId',source.projectId,'-LocalApiUrl',source.apiUrl], { ALAMIN_RECOVERY_LOCAL_SERVICE_KEY: source.serviceRoleKey });
    await copyFile(join(repoRoot, 'docs', 'security', 'recovery', 'CONFIG_RECOVERY_MANIFEST.json'), join(configDir, 'CONFIG_RECOVERY_MANIFEST.json'));
    const encrypted = await packageEncrypted(payloadRoot, workRoot);
    await rm(payloadRoot, { recursive: true, force: true });
    const sourceCleanup = await cleanupLocalStack(source, { supabaseBin, dockerBin, env });
    source = undefined;
    if (!sourceCleanup.ok) throw new Error(`Synthetic source cleanup residual: ${sourceCleanup.residual.join(',')}`);

    target = await createLocalStack({ runNumber: 1, repoRoot, supabaseBin, dockerBin, env, projectPrefix: 'alamin-recovery-target' });
    const restored = await ps('Restore-AlAminRecoveryProof.ps1', ['-EncryptedArtifact',encrypted.archivePath,'-TargetContainer',target.container,'-TargetProjectId',target.projectId,'-TargetApiUrl',target.apiUrl,'-SyntheticIdentityFile',encrypted.identityPath], { ALAMIN_RECOVERY_LOCAL_SERVICE_KEY: target.serviceRoleKey, ALAMIN_RECOVERY_SYNTHETIC: '1' });
    const restoreResult = JSON.parse(restored.stdout.trim().split(/\r?\n/u).at(-1));
    restoreRoot = restoreResult.RestoreRoot;
    const verified = await ps('Verify-AlAminRecoveryProof.ps1', ['-ExpandedRoot',restoreResult.ExpandedRoot,'-TargetContainer',target.container,'-TargetProjectId',target.projectId,'-TargetApiUrl',target.apiUrl], { ALAMIN_RECOVERY_LOCAL_SERVICE_KEY: target.serviceRoleKey });
    const verifyResult = JSON.parse(verified.stdout.trim().split(/\r?\n/u).at(-1));
    await ps('Remove-AlAminRecoveryTemporaryData.ps1', ['-Path',restoreRoot]);
    restoreRoot = undefined;
    const targetCleanup = await cleanupLocalStack(target, { supabaseBin, dockerBin, env });
    target = undefined;
    if (!targetCleanup.ok) throw new Error(`Synthetic target cleanup residual: ${targetCleanup.residual.join(',')}`);
    return {
      status: 'PASS',
      source: fixtures,
      pgpassIsolation,
      restored: { tableCount: verifyResult.TableCount, authUsers: verifyResult.AuthUserCount, storageObjects: verifyResult.StorageObjectCount },
      databaseRowCountsMatch: verifyResult.RowCountsMatch,
      storageHashesMatch: verifyResult.StorageHashesMatch,
      encryption: 'age v1.3.1 authenticated encryption',
      rawArtifactsRemaining: 0,
      residualDockerResources: 0,
    };
  } finally {
    if (restoreRoot) await ps('Remove-AlAminRecoveryTemporaryData.ps1', ['-Path',restoreRoot]).catch(() => {});
    if (source) await cleanupLocalStack(source, { supabaseBin, dockerBin, env });
    if (target) await cleanupLocalStack(target, { supabaseBin, dockerBin, env });
    await rm(workRoot, { recursive: true, force: true });
  }
}

try {
  const result = await run();
  process.stdout.write(`${JSON.stringify(result)}\n`);
} catch (error) {
  process.stderr.write(`Synthetic recovery preflight blocked: ${redactCommandError(error)}\n`);
  process.exitCode = 1;
}
