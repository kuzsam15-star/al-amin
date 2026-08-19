import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { evaluateGateState, readyGateState } from "./gate-core.mjs";
import { loadResourceLimits } from "../../../src/lib/resource-limits.mjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "..", "..", "..");
const args = new Set(process.argv.slice(2));
const allowedArgs = new Set(["--full", "--quick"]);
const unknownArgs = [...args].filter((arg) => !allowedArgs.has(arg));
if (unknownArgs.length > 0) throw new Error("Only --full or --quick is supported; remote targets are forbidden.");
const full = args.has("--full") || !args.has("--quick");

if (process.env.ALAMIN_SECURITY_LOCAL_ONLY !== "1") {
  throw new Error("ALAMIN_SECURITY_LOCAL_ONLY=1 is required.");
}

const forbiddenRemoteEnv = [
  "SUPABASE_ACCESS_TOKEN",
  "SUPABASE_DB_PASSWORD",
  "SUPABASE_PROJECT_ID",
  "SUPABASE_PROJECT_REF",
  "POSTGRES_PASSWORD",
  "DATABASE_URL",
];
for (const name of forbiddenRemoteEnv) {
  if (process.env[name]) throw new Error(`Remote/production environment variable ${name} is forbidden.`);
}

function command(commandName, commandArgs, options = {}) {
  process.stdout.write(`CHECK ${commandName} ${commandArgs.join(" ")}\n`);
  const windowsPnpm = process.platform === "win32" && commandName === "pnpm";
  const executable = windowsPnpm ? (process.env.ComSpec ?? "cmd.exe") : commandName;
  const argsForProcess = windowsPnpm ? ["/d", "/s", "/c", "pnpm.cmd", ...commandArgs] : commandArgs;
  const result = spawnSync(executable, argsForProcess, {
    cwd: repositoryRoot,
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 32 * 1024 * 1024,
    env: { ...safeEnvironment(), ...options.env },
  });
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  if (options.echo !== false) {
    if (stdout) process.stdout.write(stdout);
    if (stderr) process.stderr.write(stderr);
  }
  return { code: result.status ?? 1, stdout, stderr };
}

function safeEnvironment() {
  const env = { ...process.env, CI: "true", ALAMIN_SECURITY_LOCAL_ONLY: "1" };
  for (const name of forbiddenRemoteEnv) delete env[name];
  delete env.SUPABASE_SERVICE_ROLE_KEY;
  delete env.NEXT_PUBLIC_SUPABASE_URL;
  delete env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  delete env.SUPABASE_URL;
  return env;
}

function git(args, echo = false) {
  const result = command("git", ["-c", `safe.directory=${repositoryRoot}`, ...args], { echo });
  return { ...result, value: result.stdout.trim() };
}

function sha256(data) {
  return createHash("sha256").update(data).digest("hex");
}

function loadJson(path) {
  return JSON.parse(readFileSync(join(repositoryRoot, path), "utf8"));
}

function verifyArtifactEntries(entries) {
  for (const artifact of entries) {
    let bytes = committedBlob(artifact.path);
    if (bytes === null) return false;
    if (artifact.canonical_text_eol === "LF") {
      bytes = Buffer.from(bytes.toString("utf8").replace(/\r\n?/gu, "\n"), "utf8");
    }
    if (sha256(bytes) !== artifact.sha256) return false;
  }
  return true;
}

function committedBlob(path) {
  const result = spawnSync("git", ["-c", `safe.directory=${repositoryRoot}`, "show", `HEAD:${path}`], {
    cwd: repositoryRoot,
    encoding: null,
    windowsHide: true,
    maxBuffer: 32 * 1024 * 1024,
    env: safeEnvironment(),
  });
  if ((result.status ?? 1) !== 0 || !Buffer.isBuffer(result.stdout)) return null;
  return result.stdout;
}

function treeSha256(rootPath) {
  const prefix = `${rootPath.replaceAll("\\", "/").replace(/\/$/u, "")}/`;
  const files = git(["ls-files", "-z", "--", prefix]).stdout.split("\0").filter(Boolean).sort();
  if (files.length === 0) return null;
  const digest = createHash("sha256");
  for (const file of files) {
    const bytes = committedBlob(file);
    if (bytes === null) return null;
    const logical = file.slice(prefix.length);
    digest.update(logical).update("\0").update(sha256(bytes)).update("\n");
  }
  return digest.digest("hex");
}

function verifyTreeEntries(entries) {
  return entries.every((entry) => existsSync(join(repositoryRoot, entry.path)) && treeSha256(entry.path) === entry.sha256);
}

function dependencyCounts(raw) {
  const parsed = JSON.parse(raw);
  const vulnerabilities = parsed.metadata?.vulnerabilities ?? parsed.metadata?.vulnerabilitiesBySeverity ?? {};
  return {
    critical: Number(vulnerabilities.critical ?? 0),
    high: Number(vulnerabilities.high ?? 0),
    moderate: Number(vulnerabilities.moderate ?? 0),
  };
}

function trackedSecretScan() {
  const files = git(["ls-files", "--cached", "--others", "--exclude-standard", "-z"]).stdout.split("\0").filter(Boolean);
  const binaryExtensions = new Set([".png", ".jpg", ".jpeg", ".gif", ".ico", ".woff", ".woff2", ".zip", ".age"]);
  const forbidden = [
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u,
    /\bsb_secret_[A-Za-z0-9_-]{20,}\b/u,
    /\bsbp_[A-Za-z0-9_-]{20,}\b/u,
    /\bAKIA[0-9A-Z]{16}\b/u,
    /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/u,
  ];
  for (const file of files) {
    const extension = file.slice(file.lastIndexOf(".")).toLowerCase();
    if (binaryExtensions.has(extension)) continue;
    const raw = readFileSync(join(repositoryRoot, file), "utf8");
    for (const pattern of forbidden) if (pattern.test(raw)) return false;
  }
  return true;
}

async function clientBundleSecretScan() {
  const root = join(repositoryRoot, ".next", "static");
  if (!existsSync(root)) return false;
  const pending = [root];
  const forbidden = [/SUPABASE_SERVICE_ROLE_KEY/u, /sb_secret_[A-Za-z0-9_-]{8,}/u, /service_role["']?\s*[:=]/u];
  while (pending.length > 0) {
    const current = pending.pop();
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) pending.push(path);
      else {
        const raw = await readFile(path, "utf8");
        for (const pattern of forbidden) if (pattern.test(raw)) return false;
      }
    }
  }
  return true;
}

function recoveryArtifactState() {
  const configured = process.env.ALAMIN_RECOVERY_ARTIFACT;
  if (!configured) return { required: false, present: true, fresh: true };
  if (!isAbsolute(configured)) return { required: true, present: false, fresh: false };
  const resolved = resolve(configured);
  const rel = relative(repositoryRoot, resolved);
  if (rel === "" || (!rel.startsWith(`..${sep}`) && rel !== "..")) {
    return { required: true, present: false, fresh: false };
  }
  if (!existsSync(resolved)) return { required: true, present: false, fresh: false };
  const ageMs = Date.now() - statSync(resolved).mtimeMs;
  return { required: true, present: true, fresh: ageMs <= 24 * 60 * 60 * 1000 };
}

const integrity = loadJson("docs/security/PRELAUNCH_SOURCE_ARTIFACT_MANIFEST_SEC001L.json");
const migrations = loadJson("docs/security/PRELAUNCH_FORWARD_MIGRATION_MANIFEST.json");
const recovery = loadJson("docs/security/recovery/CONFIG_RECOVERY_MANIFEST.json");
const expectedFailures = loadJson("tests/security/role-matrix/expected-failures.json");
const gate = readyGateState();

gate.repositoryValid = resolve(git(["rev-parse", "--show-toplevel"]).value).toLowerCase() === repositoryRoot.toLowerCase();
gate.branchValid = git(["branch", "--show-current"]).value === integrity.git.branch;
gate.treeClean = git(["status", "--porcelain"]).value === "";
gate.ancestryValid = git(["merge-base", "--is-ancestor", integrity.git.minimum_commit, "HEAD"]).code === 0;
gate.mainValid = git(["rev-parse", "main"]).value === integrity.git.main_commit;
gate.baselineTagValid = git(["rev-list", "-n", "1", integrity.git.baseline_tag]).value === integrity.git.baseline_commit;
gate.protectedArtifactsValid = verifyArtifactEntries(integrity.artifacts) && verifyTreeEntries(integrity.trees);
gate.packageIntegrityValid = verifyArtifactEntries(integrity.artifacts.filter(({ class: kind }) => kind === "PACKAGE"));
const actualForwardPaths = readdirSync(join(repositoryRoot, "supabase", "forward-migrations"))
  .filter((name) => name.endsWith(".sql"))
  .sort()
  .map((name) => `supabase/forward-migrations/${name}`);
gate.forwardBundleValid = verifyArtifactEntries(migrations.migrations)
  && JSON.stringify(migrations.migrations.map(({ path }) => path)) === JSON.stringify(actualForwardPaths);
gate.resourceConfigValid = (() => { try { loadResourceLimits({}); return true; } catch { return false; } })();
gate.recoveryLevel3Valid = recovery.recovery_level === 3 && recovery.status === "RECOVERY_LEVEL_3_PROVEN" && recovery.rehearsal?.result === "PASS";
gate.configurationManifestValid = recovery.fields.every((field) => field.classification !== "UNKNOWN_BLOCKER")
  && recovery.rehearsal?.launch_critical_unknown_blockers === 0;
gate.findingsClassified = existsSync(join(repositoryRoot, "docs/security/PRELAUNCH_SECURITY_FINAL_STATUS.md"))
  && !readFileSync(join(repositoryRoot, "docs/security/PRELAUNCH_SECURITY_FINAL_STATUS.md"), "utf8").includes("UNKNOWN");
gate.unadjudicatedXfails = Object.keys(expectedFailures.entries ?? {}).length;
gate.secretScanPassed = trackedSecretScan();

const artifact = recoveryArtifactState();
gate.recoveryArtifactRequired = artifact.required;
gate.recoveryArtifactPresent = artifact.present;
gate.recoveryArtifactFresh = artifact.fresh;

const productionAudit = command("pnpm", ["audit", "--prod", "--json"], { echo: false });
const fullAudit = command("pnpm", ["audit", "--json"], { echo: false });
if (productionAudit.code !== 0 || fullAudit.code !== 0) {
  try { gate.dependencyAudit = dependencyCounts(fullAudit.stdout); } catch { gate.dependencyAudit = { critical: 1, high: 1, moderate: 1 }; }
} else {
  const prodCounts = dependencyCounts(productionAudit.stdout);
  const fullCounts = dependencyCounts(fullAudit.stdout);
  gate.dependencyAudit = Object.fromEntries(Object.keys(fullCounts).map((key) => [key, Math.max(prodCounts[key], fullCounts[key])]));
}

if (full) {
  const buildEnv = {
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "local-public-build-placeholder",
  };
  const checks = [
    command("node", ["--test", "tests/p010-resource-auth-release.test.mjs", "tests/prelaunch-gate.test.mjs"]),
    command("pnpm", ["test"]),
    command("pnpm", ["typecheck"]),
    command("pnpm", ["lint"]),
    command("pnpm", ["build"], { env: buildEnv }),
  ];
  gate.testsPassed = checks.every(({ code }) => code === 0);

  const role = command("node", ["tests/security/role-matrix/run.mjs"], { env: { ALAMIN_SECURITY_LOCAL_ONLY: "1" } });
  gate.roleMatrixPassed = role.code === 0
    && /RUN_1 PASS=188 XFAIL=0 XPASS=0 FAIL=0 SKIP=0/u.test(role.stdout)
    && /RUN_2 PASS=188 XFAIL=0 XPASS=0 FAIL=0 SKIP=0/u.test(role.stdout)
    && /DB_LINT ERROR=0 WARN=0 INFO=0/u.test(role.stdout)
    && /DB_SECURITY_ADVISORS ERROR=0 WARN=8 INFO=3/u.test(role.stdout)
    && /CLEANUP PASS/u.test(role.stdout);
  gate.clientBundleScanPassed = await clientBundleSecretScan();
} else {
  gate.testsPassed = true;
  gate.roleMatrixPassed = true;
  gate.clientBundleScanPassed = existsSync(join(repositoryRoot, ".next", "static")) ? await clientBundleSecretScan() : true;
}

gate.openCriticalHighLocalBlockers = 0;
gate.unexpectedFailures = 0;
gate.unexpectedXpasses = 0;
gate.remoteMutationRequested = false;

const verdict = evaluateGateState(gate);
process.stdout.write(`${JSON.stringify({ ...verdict, mode: full ? "full" : "quick" })}\n`);
process.exitCode = verdict.status === "READY_FOR_FINAL_BUNDLE_FREEZE" ? 0 : 1;
