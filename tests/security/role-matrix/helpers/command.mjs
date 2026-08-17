import { spawn } from 'node:child_process';

export async function runCommand(command, args, options = {}) {
  const {
    cwd,
    env = process.env,
    input,
    timeoutMs = 300_000,
    allowFailure = false,
  } = options;

  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      shell: false,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const stdout = [];
    const stderr = [];
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);

    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      const result = {
        code: code ?? -1,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
        timedOut,
      };
      if (!allowFailure && (timedOut || result.code !== 0)) {
        const safeMessage = timedOut
          ? `${command} timed out`
          : `${command} exited with code ${result.code}`;
        const error = new Error(safeMessage);
        error.result = result;
        reject(error);
        return;
      }
      resolve(result);
    });

    if (input !== undefined) child.stdin.end(input);
    else child.stdin.end();
  });
}

export function redactCommandError(error) {
  if (!error?.result) return error instanceof Error ? error.message : String(error);
  const safeLines = (value) => value
    .split(/\r?\n/u)
    .filter(Boolean)
    .filter((line) => !/(ANON_KEY|SERVICE_ROLE_KEY|JWT_SECRET|DB_URL)=/i.test(line));
  const lines = [...safeLines(error.result.stderr).slice(-8), ...safeLines(error.result.stdout).slice(-4)];
  return `${error.message}: ${lines.join(' | ')}`;
}
