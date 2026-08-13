import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const manifestPath = new URL(
  "../docs/security/recovery/CONFIG_RECOVERY_MANIFEST.json",
  import.meta.url,
);

async function loadManifest() {
  return JSON.parse(await readFile(manifestPath, "utf8"));
}

test("Level 3 recovery manifest is complete and fail-closed", async () => {
  const manifest = await loadManifest();
  const allowed = new Set([
    "PROVEN_RESTORABLE",
    "PROVEN_MANUAL_REENTRY",
    "PROVEN_NOT_APPLICABLE",
    "UNKNOWN_BLOCKER",
  ]);

  assert.equal(manifest.format_version, 2);
  assert.equal(manifest.recovery_level, 3);
  assert.equal(manifest.status, "RECOVERY_LEVEL_3_PROVEN");
  assert.equal(manifest.fields.length, 73);
  assert.equal(new Set(manifest.fields.map(({ id }) => id)).size, 73);
  assert.ok(manifest.fields.every(({ classification }) => allowed.has(classification)));

  const counts = Object.fromEntries(
    [...allowed].map((classification) => [
      classification,
      manifest.fields.filter((field) => field.classification === classification).length,
    ]),
  );
  assert.deepEqual(counts, {
    PROVEN_RESTORABLE: 13,
    PROVEN_MANUAL_REENTRY: 54,
    PROVEN_NOT_APPLICABLE: 6,
    UNKNOWN_BLOCKER: 0,
  });
  assert.equal(
    manifest.fields.filter(
      ({ launch_critical, classification }) =>
        launch_critical && classification === "UNKNOWN_BLOCKER",
    ).length,
    0,
  );
});

test("manual recovery fields have actionable non-secret checklists", async () => {
  const manifest = await loadManifest();
  const manual = manifest.fields.filter(
    ({ classification }) => classification === "PROVEN_MANUAL_REENTRY",
  );

  assert.equal(manual.length, 54);
  for (const field of manual) {
    assert.equal(typeof field.recovery, "string", `${field.id}: recovery`);
    assert.ok(field.recovery.length > 0, `${field.id}: recovery`);
    assert.equal(typeof field.dashboard?.path, "string", `${field.id}: path`);
    assert.equal(typeof field.dashboard?.setting, "string", `${field.id}: setting`);
    assert.equal(typeof field.dashboard?.secret_required, "boolean", `${field.id}: secret flag`);
    assert.equal(typeof field.dashboard?.verification, "string", `${field.id}: verification`);
    assert.equal(typeof field.dashboard?.failure_impact, "string", `${field.id}: failure impact`);
  }
});

test("secret re-entry map names nine sources without storing values", async () => {
  const manifest = await loadManifest();
  const expected = new Set([
    "DATABASE_PASSWORD",
    "GOOGLE_OAUTH_CLIENT_SECRET",
    "SUPABASE_AUTH_SMTP_PASSWORD",
    "SUPABASE_SERVICE_ROLE_KEY",
    "UNISENDER_GO_API_KEY",
    "EMAIL_WORKER_SECRET",
    "TEMPORARY_S3_SECRET_ACCESS_KEY",
    "TURNSTILE_SECRET_KEY",
    "FEEDBACK_FINGERPRINT_SECRET",
  ]);

  assert.equal(manifest.secrets.length, 9);
  assert.deepEqual(new Set(manifest.secrets.map(({ name }) => name)), expected);
  for (const secret of manifest.secrets) {
    assert.equal(secret.status, "MUST_REENTER", secret.name);
    assert.equal(typeof secret.source_of_truth, "string", secret.name);
    assert.ok(secret.source_of_truth.length > 0, secret.name);
    assert.equal("value" in secret, false, secret.name);
  }
  assert.equal(manifest.source_values_stored, false);
  assert.equal(manifest.validation.secret_values_stored, false);
  assert.equal(manifest.validation.production_identifiers_stored, false);
  assert.equal(manifest.validation.production_rows_stored, false);
  assert.equal(manifest.validation.storage_paths_or_bytes_stored, false);
});

test("configuration rehearsal evidence records two-run safe boundaries", async () => {
  const manifest = await loadManifest();

  assert.match(manifest.rehearsal.mode, /two independent disposable local/i);
  assert.equal(manifest.rehearsal.external_oauth_calls, false);
  assert.equal(manifest.rehearsal.external_smtp_calls, false);
  assert.equal(manifest.rehearsal.synthetic_secrets_only, true);
  assert.equal(manifest.rehearsal.result, "PASS");
  assert.equal(manifest.rehearsal.launch_critical_unknown_blockers, 0);
  assert.equal(manifest.rehearsal.residual_resources, 0);
  assert.equal(manifest.validation.production_configuration_mutated, false);
  assert.equal(manifest.validation.isolated_configuration_rehearsal_performed, true);
  assert.equal(manifest.validation.complete_project_loss_walkthrough, "PASS");
});

test("manifest contains no common credential material", async () => {
  const raw = await readFile(manifestPath, "utf8");
  const forbidden = [
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
    /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/,
    /\bsbp_[A-Za-z0-9_-]{20,}\b/,
    /\bsb_secret_[A-Za-z0-9_-]{20,}\b/,
    /\bAKIA[0-9A-Z]{16}\b/,
  ];

  for (const pattern of forbidden) {
    assert.doesNotMatch(raw, pattern);
  }
});
