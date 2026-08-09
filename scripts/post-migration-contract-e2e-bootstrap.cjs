const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { createClient } = require("@supabase/supabase-js");

const projectRoot = path.resolve(__dirname, "..");
const statePath = path.join(
  projectRoot,
  "outputs",
  "post-migration-data-contract-e2e-2026-08-07",
  "qa-bootstrap-state.json",
);

function parseEnv(source) {
  return Object.fromEntries(
    source
      .split(/\r?\n/)
      .filter((line) => line && !line.trim().startsWith("#") && line.includes("="))
      .map((line) => {
        const separator = line.indexOf("=");
        const key = line.slice(0, separator).trim();
        let value = line.slice(separator + 1).trim();
        if (
          (value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))
        ) value = value.slice(1, -1);
        return [key, value];
      }),
  );
}

async function main() {
  const env = parseEnv(await fs.readFile(path.join(projectRoot, ".env.local"), "utf8"));
  if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Supabase server credentials are not configured.");
  }

  const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const existingClaim = process.argv.includes("--claim-existing");
  let previousState = null;
  let marker;
  let email;
  let user;
  if (existingClaim) {
    previousState = JSON.parse(await fs.readFile(statePath, "utf8"));
    const { data, error } = await admin.auth.admin.getUserById(previousState.user_id);
    if (error || !data.user?.email) throw error ?? new Error("Existing QA user was not found.");
    marker = previousState.marker;
    email = data.user.email;
    user = data.user;
  } else {
    const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
    marker = `ALAMIN-E2E-20260807-${stamp}`;
    email = `alamin-e2e-20260807-${stamp.toLowerCase()}@example.invalid`;
    const password = `Qa!${crypto.randomUUID()}x9`;
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { qa_marker: marker },
    });
    if (error || !data.user) throw error ?? new Error("QA user was not created.");
    user = data.user;
  }

  const { data: link, error: linkError } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  if (linkError || !link.properties?.hashed_token) {
    if (!existingClaim) await admin.auth.admin.deleteUser(user.id).catch(() => undefined);
    throw linkError ?? new Error("QA login link was not generated.");
  }

  const server = http.createServer((request, response) => {
    if (request.url !== "/claim") {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Not found");
      return;
    }
    const destination = new URL("http://localhost:3000/auth/callback");
    destination.searchParams.set("token_hash", link.properties.hashed_token);
    destination.searchParams.set("type", "magiclink");
    destination.searchParams.set("next", "/apply");
    const serializedDestination = JSON.stringify(destination.toString()).replace(/</g, "\\u003c");
    response.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
    });
    response.end(
      `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>QA sign-in</title></head><body><p>Переход в AL-AMIN…</p><script>location.replace(${serializedDestination})</script></body></html>`,
    );
  });

  server.listen(0, "127.0.0.1", async () => {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("QA claim server did not start.");
    const state = {
      ...(previousState ?? {}),
      marker,
      user_id: user.id,
      email_domain: "example.invalid",
      email_confirmed: Boolean(user.email_confirmed_at),
      claim_url: `http://127.0.0.1:${address.port}/claim`,
      created_object_ids: previousState?.created_object_ids ?? {},
    };
    await fs.mkdir(path.dirname(statePath), { recursive: true });
    await fs.writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    process.stdout.write(`${JSON.stringify(state)}\n`);
    setTimeout(() => server.close(), 30_000).unref();
  });
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
