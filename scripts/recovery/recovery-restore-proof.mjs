import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLocalStack, cleanupLocalStack, queryLocalSql } from '../../tests/security/role-matrix/helpers/local-stack.mjs';
import { runCommand, redactCommandError } from '../../tests/security/role-matrix/helpers/command.mjs';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..', '..');
const artifact = resolve(process.argv[2] ?? '');
const localAppData = process.env.LOCALAPPDATA;
const supabaseBin = join(localAppData, 'Programs', 'SupabaseCLI', '2.113.0', 'supabase.exe');
const dockerBin = join(localAppData, 'Programs', 'DockerDesktop', 'resources', 'bin', 'docker.exe');
const powershell = 'powershell.exe';
const env = { ...process.env, SUPABASE_TELEMETRY_DISABLED: '1', ALAMIN_SECURITY_LOCAL_ONLY: '1', PATH: `${dirname(dockerBin)};${process.env.PATH ?? ''}` };
for (const name of Object.keys(env)) if (/SUPABASE_(ACCESS_TOKEN|DB_PASSWORD|SERVICE_ROLE_KEY)|DATABASE_URL/i.test(name)) delete env[name];

async function ps(file, args, extraEnv = {}) {
  return await runCommand(powershell, ['-NoLogo','-NoProfile','-ExecutionPolicy','Bypass','-File',join(scriptDir,file),...args], { cwd: repoRoot, env: { ...env, ...extraEnv }, timeoutMs: 1_200_000 });
}

async function oneRun(runNumber) {
  const temp = await mkdtemp(join(tmpdir(), `alamin-recovery-proof-r${runNumber}-`));
  const restoreResultPath = join(temp, 'restore-result.json');
  const verifyResultPath = join(temp, 'verify-result.json');
  let stack;
  let restoreRoot;
  try {
    stack = await createLocalStack({ runNumber, repoRoot, supabaseBin, dockerBin, env, projectPrefix: 'alamin-recovery-target' });
    const childEnv = { ...env, ALAMIN_RECOVERY_LOCAL_SERVICE_KEY: stack.serviceRoleKey };
    const restored = spawnSync(powershell, ['-NoLogo','-NoProfile','-ExecutionPolicy','Bypass','-File',join(scriptDir,'Restore-AlAminRecoveryProof.ps1'),'-EncryptedArtifact',artifact,'-TargetContainer',stack.container,'-TargetProjectId',stack.projectId,'-TargetApiUrl',stack.apiUrl,'-ResultFile',restoreResultPath], { cwd: repoRoot, env: childEnv, stdio: 'inherit', windowsHide: false });
    if (restored.status !== 0) throw new Error(`Restore run ${runNumber} failed without exposing credentials`);
    const restoreResult = JSON.parse(await readFile(restoreResultPath, 'utf8'));
    restoreRoot = restoreResult.RestoreRoot;
    await ps('Verify-AlAminRecoveryProof.ps1', ['-ExpandedRoot',restoreResult.ExpandedRoot,'-TargetContainer',stack.container,'-TargetProjectId',stack.projectId,'-TargetApiUrl',stack.apiUrl,'-ResultFile',verifyResultPath], { ALAMIN_RECOVERY_LOCAL_SERVICE_KEY: stack.serviceRoleKey });
    const verified = JSON.parse(await readFile(verifyResultPath, 'utf8'));
    const config = JSON.parse(await readFile(join(restoreResult.ExpandedRoot,'config','CONFIG_RECOVERY_MANIFEST.json'),'utf8'));
    const sec001Infrastructure = await queryLocalSql(stack, dockerBin, env, "select case when to_regclass('private.published_media_assets') is null then 'PRE_PHASE_A' else 'PHASE_A_OR_LATER' end");
    await ps('Remove-AlAminRecoveryTemporaryData.ps1', ['-Path',restoreRoot]);
    restoreRoot = undefined;
    const cleaned = await cleanupLocalStack(stack, { supabaseBin, dockerBin, env });
    stack = undefined;
    if (!cleaned.ok) throw new Error(`Restore run ${runNumber} cleanup residual: ${cleaned.residual.join(',')}`);
    return {
      tableCount: verified.TableCount,
      authUserCount: verified.AuthUserCount,
      storageObjectCount: verified.StorageObjectCount,
      rowCountsMatch: verified.RowCountsMatch,
      storageHashesMatch: verified.StorageHashesMatch,
      configFormatVersion: config.format_version,
      sec001State: sec001Infrastructure,
      cleanup: 'PASS',
    };
  } finally {
    if (restoreRoot) await ps('Remove-AlAminRecoveryTemporaryData.ps1', ['-Path',restoreRoot]).catch(() => {});
    if (stack) await cleanupLocalStack(stack, { supabaseBin, dockerBin, env });
    await rm(temp, { recursive: true, force: true });
  }
}

try {
  if (!artifact.endsWith('.age')) throw new Error('Encrypted artifact must use the .age suffix');
  const first = await oneRun(1);
  const second = await oneRun(2);
  const comparable = JSON.stringify({ ...first, cleanup: undefined }) === JSON.stringify({ ...second, cleanup: undefined });
  if (!comparable) throw new Error('Two independent restore summaries do not match');
  process.stdout.write(`${JSON.stringify({ status:'PASS', restore1:first, restore2:second, matching:true, residualResources:0 })}\n`);
} catch (error) {
  process.stderr.write(`Isolated restore proof blocked: ${redactCommandError(error)}\n`);
  process.exitCode = 1;
}
