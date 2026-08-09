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

  const state = JSON.parse(await fs.readFile(statePath, "utf8"));
  const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: current, error: currentError } = await admin.auth.admin.getUserById(state.user_id);
  if (currentError || !current.user?.email) {
    throw currentError ?? new Error("Existing QA user was not found.");
  }

  const password = `Qa!${crypto.randomUUID()}x9`;
  const { error: updateError } = await admin.auth.admin.updateUserById(state.user_id, { password });
  if (updateError) throw updateError;

  let served = false;
  const server = http.createServer((request, response) => {
    if (served || request.url !== "/credentials") {
      response.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
      response.end('{"error":"not_found"}');
      return;
    }
    served = true;
    response.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
    });
    response.end(JSON.stringify({ email: current.user.email, password }));
    setTimeout(() => server.close(), 500).unref();
  });

  server.listen(0, "127.0.0.1", async () => {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Credential server did not start.");
    const credentialUrl = `http://127.0.0.1:${address.port}/credentials`;
    await fs.writeFile(
      statePath,
      `${JSON.stringify({ ...state, credential_url: credentialUrl }, null, 2)}\n`,
      "utf8",
    );
    process.stdout.write(`${JSON.stringify({ ready: true })}\n`);
    setTimeout(() => server.close(), 30_000).unref();
  });
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
