const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const { createClient } = require("@supabase/supabase-js");

const projectRoot = path.resolve(__dirname, "..");
const statePath = path.join(projectRoot, "outputs", "application-form-validation-remote-e2e-2026-08-09", "qa-state.json");

function parseEnv(source) {
  return Object.fromEntries(source.split(/\r?\n/).filter((line) => line && !line.trim().startsWith("#") && line.includes("=")).map((line) => {
    const separator = line.indexOf("=");
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    return [key, value];
  }));
}

async function main() {
  const [envSource, stateSource] = await Promise.all([
    fs.readFile(path.join(projectRoot, ".env.local"), "utf8"),
    fs.readFile(statePath, "utf8"),
  ]);
  const env = parseEnv(envSource);
  const state = JSON.parse(stateSource);
  const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: userData, error: userError } = await admin.auth.admin.getUserById(state.user_id);
  if (userError || !userData.user?.email) throw userError ?? new Error("QA user was not found.");
  const { data: link, error: linkError } = await admin.auth.admin.generateLink({ type: "magiclink", email: userData.user.email });
  if (linkError || !link.properties?.hashed_token) throw linkError ?? new Error("QA login link was not generated.");

  let served = false;
  const server = http.createServer((request, response) => {
    if (served || request.url !== "/claim") {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Not found");
      return;
    }
    served = true;
    const destination = new URL("http://localhost:3000/auth/callback");
    destination.searchParams.set("token_hash", link.properties.hashed_token);
    destination.searchParams.set("type", "magiclink");
    destination.searchParams.set("next", "/apply");
    response.writeHead(302, { Location: destination.toString(), "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });
    response.end();
    setTimeout(() => server.close(), 500).unref();
  });
  server.listen(0, "127.0.0.1", async () => {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("QA login server did not start.");
    const claimUrl = `http://127.0.0.1:${address.port}/claim`;
    await fs.writeFile(path.join(path.dirname(statePath), "qa-claim-url.txt"), claimUrl, "utf8");
    process.stdout.write(`${JSON.stringify({ ready: true })}\n`);
    setTimeout(() => server.close(), 120_000).unref();
  });
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
