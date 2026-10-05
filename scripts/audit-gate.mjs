#!/usr/bin/env node
// Dependency-free replacement for `npm audit --audit-level=high`.
//
// Same gate as before -- any high or critical advisory fails the build -- except
// that advisories listed in audit-allowlist.json are reported and tolerated.
// An entry there is only ever legitimate when upstream has no patched version;
// anything fixable gets an upgrade or a package.json override instead.
//
// The allowlist is self-cleaning, which is the point of doing this by hand
// rather than loosening --audit-level: the gate fails if an entry is past its
// `expires` date (forcing a re-review) and also if an entry no longer matches
// anything npm reports (forcing its removal once upstream ships a fix). An
// exception therefore cannot quietly outlive the problem it was written for.

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const RANK = { info: 0, low: 1, moderate: 2, high: 3, critical: 4 };
const THRESHOLD = RANK.high;

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const allowlistPath = resolve(repoRoot, "audit-allowlist.json");

// `npm audit` exits non-zero whenever it finds anything, so a non-zero status is
// not an error in itself -- but unparseable output is, and must never pass.
const run = spawnSync("npm", ["audit", "--json"], {
  cwd: repoRoot,
  encoding: "utf8",
  maxBuffer: 64 * 1024 * 1024,
});

if (run.error) {
  console.error(`audit-gate: could not run npm audit: ${run.error.message}`);
  process.exit(1);
}

let report;
try {
  report = JSON.parse(run.stdout);
} catch {
  console.error("audit-gate: npm audit did not return JSON. Raw output:");
  console.error(run.stdout || run.stderr || "(no output)");
  process.exit(1);
}

if (report.error) {
  const { code, summary } = report.error;
  console.error(`audit-gate: npm audit failed${code ? ` (${code})` : ""}: ${summary ?? ""}`);
  process.exit(1);
}

// Collapse npm's per-package tree into one record per distinct advisory. A
// single root cause (one vulnerable transitive package) is otherwise reported
// once per dependent, which is why `braces` shows up as five "vulnerabilities".
const found = new Map();
for (const vuln of Object.values(report.vulnerabilities ?? {})) {
  for (const via of vuln.via ?? []) {
    if (typeof via !== "object" || !via.url) continue;
    const id = via.url.split("/").pop();
    if (!found.has(id)) {
      found.set(id, {
        id,
        url: via.url,
        severity: via.severity ?? "unknown",
        package: via.name ?? "(unknown)",
        range: via.range ?? "",
        title: via.title ?? "",
      });
    }
  }
}

let allowlist;
try {
  allowlist = JSON.parse(readFileSync(allowlistPath, "utf8"));
} catch (e) {
  console.error(`audit-gate: could not read ${allowlistPath}: ${e.message}`);
  process.exit(1);
}

const entries = allowlist.allow ?? [];
const today = new Date().toISOString().slice(0, 10);

const blocking = [];
const accepted = [];
const expired = [];
const stale = [];

// Both unknown checks below fail closed on purpose. npm only ever reports the
// five severities in RANK and the allowlist is hand-written, so these are
// guards against a format change or a typo, not expected states -- but a
// security gate that waves through what it does not understand is no gate.
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

for (const advisory of found.values()) {
  const rank = RANK[advisory.severity];
  if (rank !== undefined && rank < THRESHOLD) continue;
  if (rank === undefined) {
    blocking.push({ ...advisory, title: `${advisory.title} (unrecognized severity)` });
    continue;
  }
  const entry = entries.find((e) => e.advisory === advisory.id);
  if (!entry) {
    blocking.push(advisory);
  } else if (!entry.expires || !ISO_DATE.test(entry.expires)) {
    blocking.push({
      ...advisory,
      title: `allowlisted with a missing or malformed \`expires\` date ` +
        `(${JSON.stringify(entry.expires ?? null)}); use YYYY-MM-DD`,
    });
  } else if (entry.expires < today) {
    expired.push({ advisory, entry });
  } else {
    accepted.push({ advisory, entry });
  }
}

for (const entry of entries) {
  if (!found.has(entry.advisory)) stale.push(entry);
}

// Cross-check the per-advisory parse above against npm's own summary counts.
// Everything above reads `vulnerabilities[*].via`; if npm ever reshaped that,
// the parse would find nothing and -- with an empty allowlist, so no stale
// entry to trip -- the gate would pass a vulnerable tree. npm's summary is a
// separate field, so disagreement between the two means the parse is wrong.
// Missing counts fail too: with nothing to compare against, the check can't run.
const counts = report.metadata?.vulnerabilities;
const unparsed = [];
if (!counts || typeof counts.high !== "number" || typeof counts.critical !== "number") {
  unparsed.push("npm audit returned no metadata.vulnerabilities summary to cross-check against");
} else if (counts.high + counts.critical > 0) {
  const parsedAtThreshold = [...found.values()].filter(
    (a) => RANK[a.severity] === undefined || RANK[a.severity] >= THRESHOLD,
  );
  if (parsedAtThreshold.length === 0) {
    unparsed.push(
      `npm reports ${counts.critical} critical and ${counts.high} high, ` +
        `but no advisory at that severity could be read from the report`,
    );
  }
}

const plural = (n, word, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;
const summary = counts ?? {};
console.log(
  `audit-gate: npm audit reports ${plural(summary.total ?? 0, "vulnerability", "vulnerabilities")} ` +
    `(${summary.critical ?? 0} critical, ${summary.high ?? 0} high, ` +
    `${summary.moderate ?? 0} moderate, ${summary.low ?? 0} low), ` +
    `${plural(found.size, "distinct advisory", "distinct advisories")}.`,
);

for (const { advisory, entry } of accepted) {
  console.log(
    `\n  ACCEPTED  ${advisory.id} (${entry.cve ?? "no CVE"}) ${advisory.severity} ` +
      `in ${advisory.package} ${advisory.range}` +
      `\n            no upstream patch; exception expires ${entry.expires ?? "never"}`,
  );
}

for (const advisory of blocking) {
  console.error(
    `\n  BLOCKING  ${advisory.id} ${advisory.severity} in ${advisory.package} ${advisory.range}` +
      `\n            ${advisory.title}` +
      `\n            ${advisory.url}`,
  );
}

for (const { advisory, entry } of expired) {
  console.error(
    `\n  EXPIRED   ${advisory.id} in ${advisory.package}: exception lapsed on ${entry.expires}.` +
      `\n            Re-review it. If there is still no patched version, extend` +
      `\n            \`expires\` in audit-allowlist.json; otherwise upgrade and drop the entry.`,
  );
}

for (const entry of stale) {
  console.error(
    `\n  STALE     ${entry.advisory} (${entry.package}) is allowlisted but no longer reported.` +
      `\n            Upstream has most likely shipped a fix. Delete this entry from` +
      `\n            audit-allowlist.json.`,
  );
}

for (const problem of unparsed) {
  console.error(
    `\n  UNPARSED  ${problem}.` +
      `\n            The npm audit JSON format may have changed; run \`npm audit\` to see` +
      `\n            the findings, and update scripts/audit-gate.mjs before trusting it.`,
  );
}

if (blocking.length || expired.length || stale.length || unparsed.length) {
  console.error(
    `\naudit-gate: FAILED -- ${plural(blocking.length, "blocking advisory", "blocking advisories")}, ` +
      `${plural(expired.length, "expired exception")}, ${plural(stale.length, "stale exception")}` +
      `${unparsed.length ? ", and a report the gate could not read" : ""}.`,
  );
  process.exit(1);
}

console.log(
  `\naudit-gate: PASSED -- no unreviewed advisories at high or above` +
    `${accepted.length ? ` (${plural(accepted.length, "documented exception")})` : ""}.`,
);
