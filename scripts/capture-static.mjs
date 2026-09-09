import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

const candidates = process.platform === "win32"
  ? ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Google/Chrome/Application/chrome.exe"]
  : ["/usr/bin/google-chrome", "/usr/bin/chromium", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"];
const browser = process.env.BROWSER_PATH || candidates.find(existsSync);
if (!browser) throw new Error("Headless Chromium browser not found.");

const port = 9223;
const output = path.resolve("outputs");
await mkdir(output, { recursive: true });
const processHandle = spawn(browser, [
  "--headless=new",
  "--disable-gpu",
  "--hide-scrollbars",
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${path.join(output, "cdp-profile-" + randomUUID())}`,
  "about:blank"
], { stdio: "ignore", windowsHide: true });

async function waitForTarget() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const list = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json());
      const target = list.find((item) => item.type === "page" && !String(item.url).startsWith("chrome-extension:"));
      if (target?.webSocketDebuggerUrl) return target.webSocketDebuggerUrl;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Could not connect to Chromium DevTools.");
}

async function capture(name, width, height, mobile) {
  const endpoint = await waitForTarget();
  const socket = new WebSocket(endpoint);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let nextId = 0;
  const pending = new Map();
  socket.onmessage = async (event) => {
    const raw = typeof event.data === "string"
      ? event.data
      : event.data instanceof ArrayBuffer
        ? Buffer.from(event.data).toString("utf8")
        : typeof event.data.arrayBuffer === "function"
          ? Buffer.from(await event.data.arrayBuffer()).toString("utf8")
          : Buffer.from(event.data).toString("utf8");
    const message = JSON.parse(raw);
    if (!message.id || !pending.has(message.id)) return;
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(message.error.message));
    else resolve(message.result);
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId;
    const timeout = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`CDP timeout: ${method}`));
    }, 30000);
    pending.set(id, {
      resolve: (value) => { clearTimeout(timeout); resolve(value); },
      reject: (error) => { clearTimeout(timeout); reject(error); }
    });
    socket.send(JSON.stringify({ id, method, params }));
  });
  await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile, screenWidth: width, screenHeight: height });
  await send("Page.navigate", { url: "http://127.0.0.1:4174/" });
  await new Promise((resolve) => setTimeout(resolve, 1000));
  const metrics = await send("Runtime.evaluate", { expression: "JSON.stringify({url:location.href,ready:document.readyState,width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth,screenWidth:screen.width,dpr:devicePixelRatio,viewport:document.querySelector('meta[name=viewport]')?.content})", returnByValue: true });
  const viewport = JSON.parse(metrics.result.value);
  if (process.argv.includes("--metrics-only")) {
    socket.close();
    return viewport;
  }
  const screenshot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false, fromSurface: true, optimizeForSpeed: true });
  await writeFile(path.join(output, name), Buffer.from(screenshot.data, "base64"));
  socket.close();
  return viewport;
}

try {
  if (process.argv.includes("--mobile-only")) {
    const mobile = await capture("static-home-mobile.png", 390, 844, true);
    process.stdout.write(JSON.stringify({ mobile }) + "\n");
  } else {
    const desktop = await capture("static-home-desktop.png", 1440, 1000, false);
    const mobile = await capture("static-home-mobile.png", 390, 844, true);
    process.stdout.write(JSON.stringify({ desktop, mobile }) + "\n");
  }
} finally {
  processHandle.kill();
}

process.exit(0);
