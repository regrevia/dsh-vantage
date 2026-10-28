#!/usr/bin/env node
/**
 * Boot a throwaway profile with this package installed the same way a user
 * installs it, then prove the Host and the browser shell actually pick it up.
 *
 * Unit tests run the reducer and the routes in-process. They cannot see a plugin
 * that never mounts, so this script checks the four things a broken install
 * breaks: the Host prints a URL, the shell lists our client module, the served
 * bundle is this checkout's client.js, and the plugin's own route answers.
 *
 * Usage: node scripts/accept-installed.mjs [profile] [--keep]
 *   profile  profile name under $DSH_HOME/profiles (default vantage-accept)
 *   --keep   leave the Host and the profile in place for inspection
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const args = process.argv.slice(2);
const keep = args.includes("--keep");
const name = args.find((arg) => !arg.startsWith("--")) ?? "vantage-accept";
const home = process.env.DSH_HOME ?? join(homedir(), ".dsh");
const profileDir = join(home, "profiles", name);
const cli = process.env.DSH_CLI
  ?? "/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh";

const failures = [];
const note = (line) => console.log(line);
const check = (ok, line) => {
  note(`${ok ? "ok  " : "FAIL"} ${line}`);
  if (!ok) failures.push(line);
};

function run(argv, timeout) {
  return spawnSync(cli, argv, { encoding: "utf8", timeout, env: { ...process.env, DSH_HOME: home } });
}

// A fresh profile copies the shipped web template, so nothing from this session's
// real profile can mask a missing bundle patch.
if (!existsSync(join(profileDir, "package.json"))) {
  const made = run(["--profile", name, "--from-default-profile", "web", "--dump-config"], 90000);
  check(made.status === 0, `create profile ${name}`);
} else {
  note(`note profile ${name} exists`);
}

const installed = run(["plugin", "--profile", name, "add", root], 120000);
check(installed.status === 0, "install this checkout into the profile");
const manifest = JSON.parse(readFileSync(join(profileDir, "package.json"), "utf8"));
check(
  manifest.dsh?.profile?.bundles?.includes("dsh-vantage") === true,
  "the profile boots the dsh-vantage bundle"
);
check(
  String(manifest.dependencies?.["dsh-vantage"] ?? "").startsWith("link:"),
  "the profile links this checkout"
);

const child = spawn(cli, ["--profile", name, "--port", "0", "--no-open"], {
  env: { ...process.env, DSH_HOME: home },
  stdio: ["ignore", "pipe", "pipe"]
});
let log = "";
child.stdout.on("data", (chunk) => { log += chunk; });
child.stderr.on("data", (chunk) => { log += chunk; });

const url = await new Promise((resolveUrl, reject) => {
  const timer = setTimeout(() => reject(new Error(`no URL in 60 s:\n${log.slice(-400)}`)), 60000);
  const look = () => {
    const found = /http:\/\/127\.0\.0\.1:(\d+)\/\?token=([A-Za-z0-9_-]+)/u.exec(log);
    if (found !== null) {
      clearTimeout(timer);
      resolveUrl(found[0]);
    }
  };
  child.stdout.on("data", look);
  child.stderr.on("data", look);
  child.on("exit", (code) => reject(new Error(`Host exited ${code}:\n${log.slice(-400)}`)));
}).catch((error) => {
  note(`FAIL ${error.message}`);
  failures.push("Host boot");
  return null;
});

try {
  if (url !== null) {
    const port = /:(\d+)\//u.exec(url)[1];
    const origin = `http://127.0.0.1:${port}`;
    note(`note ${origin}`);
    // The token URL answers with a redirect that installs the session cookie.
    const first = await fetch(url, { redirect: "manual" });
    const cookie = (first.headers.getSetCookie?.() ?? [])
      .map((line) => line.split(";")[0])
      .join("; ");
    const page = await fetch(`${origin}/`, {
      headers: cookie === "" ? {} : { cookie },
      redirect: "follow"
    });
    const html = await page.text();
    check(page.status === 200, "the browser shell answers with a token");
    check(cookie !== "", "the token URL installs an auth cookie");
    check(html.includes("dsh-vantage/client.js"), "the shell lists the client module");
    check(log.includes("did not activate") === false, "no entry reported a failed activation");
    check(!/dsh-vantage[^\n]*failed/u.test(log), "the Host did not report dsh-vantage as failed");

    const anonymous = await fetch(`${origin}/api/dsh-vantage/snapshot?session=session-accept`);
    check(anonymous.status === 401, "the route sits behind the auth fence");
    const owners = await fetch(`${origin}/api/dsh-vantage/snapshot?session=session-accept`, {
      headers: cookie === "" ? {} : { cookie }
    });
    const body = await owners.json().catch(() => null);
    check(
      owners.status === 200 || owners.status === 403,
      `the route answers without crashing (${owners.status})`
    );
    check(
      body?.error === undefined || typeof body.error.code === "string",
      "a refusal is a structured error, not a stack trace"
    );
    note(`note ${JSON.stringify(body).slice(0, 160)}`);

    // The shell may load our module alone or inside a concatenated group; only the
    // single-module URL is byte-comparable to the checkout.
    const src = /["'](plugins\/\?\?dsh-vantage\/client\.js[^"']*)["']/u.exec(html)?.[1]
      ?? /["']([^"']*dsh-vantage\/client\.js[^"']*)["']/u.exec(html)?.[1];
    if (src === undefined) {
      check(false, "the served bundle URL is discoverable");
    } else {
      const asset = await fetch(new URL(src.replaceAll("&amp;", "&"), origin), { headers: cookie === "" ? {} : { cookie } });
      const served = await asset.text();
      const source = readFileSync(join(root, "client.js"), "utf8");
      check(asset.status === 200, "the client bundle is served");
      check(served.startsWith(source), "the served bundle is this checkout's client.js");
      check(served.includes("sourceMappingURL"), "the served bundle carries its source map pointer");
    }
  }
} finally {
  if (!keep) {
    child.kill("SIGTERM");
    await new Promise((done) => child.on("exit", done));
  }
}

if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed`);
  process.exitCode = 1;
} else {
  console.log("\ninstalled acceptance passed");
}
