# Security — zgrey.github.io

## CI/CD Pipeline

The GitHub Actions workflow (`.github/workflows/deploy.yml`) runs on every push to `main` and every pull request targeting `main`.

### Build Checks (run on all pushes and PRs)

| Step | Tool | What it does |
|------|------|-------------|
| Install | `npm ci --ignore-scripts` | Deterministic install from `package-lock.json`; fails on lockfile drift. Runs no dependency install scripts (nothing in the tree needs one) |
| Dependency audit | `node scripts/audit-gate.mjs` | Fails the build on high-severity vulnerabilities, except documented exceptions (see [Accepted advisories](#accepted-advisories)) |
| Linting | ESLint 10 (flat config, `@eslint/js` recommended) | Static analysis with relaxed rules for legacy code |
| Secret scanning | [`gitleaks/gitleaks-action@v2`](https://github.com/gitleaks/gitleaks-action) | Official Gitleaks GitHub Action scans for leaked secrets |
| Build | `npx @11ty/eleventy` | Generates static site to `_site/` |
| HTML validation | `html-validate` | Validates all generated HTML against recommended rules |

### Accepted advisories

`npm run audit` runs `scripts/audit-gate.mjs` rather than `npm audit --audit-level=high`
directly. The gate is the same — **any** high or critical advisory fails the build — but
advisories listed in `audit-allowlist.json` are reported and tolerated. An entry there is
only ever legitimate when **upstream has no patched version**; anything fixable gets a
version bump or an `overrides` entry instead, as every previous advisory in this repo did.

The allowlist is deliberately self-cleaning, which is why this is a small script and not
a looser `--audit-level=critical`. The gate fails if an entry is past its `expires` date
(forcing a re-review) and *also* if an entry no longer matches anything `npm audit` reports
(forcing its removal once upstream ships a fix). An exception cannot quietly outlive the
problem it was written for. `advisory`, `reason` and `expires` are all required on an entry;
a missing or malformed `expires` blocks the build rather than being waved through, as does an
advisory whose severity the gate does not recognize. The gate also cross-checks its own parse
against npm's summary counts (`metadata.vulnerabilities`): if npm reports high or critical
findings that the gate could not read as advisories — say, because npm reshaped its JSON — it
fails as `UNPARSED` instead of passing a vulnerable tree. Without this, a format change would
pass silently once the allowlist is empty, since there would be no stale entry left to trip.
The failure modes — blocking, expired, stale, malformed, unparsed — are each exercised by hand
before shipping a change to the gate; the unparsed case needs a stub `npm` on `PATH` that
emits a reshaped copy of a real report.

**Currently accepted: none.** `audit-allowlist.json` has an empty `allow` list.

The last entry was [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)
(CVE-2026-93687, stack-exhaustion DoS in `braces` `<=3.0.3`, no patched version). It was
accepted because its only consumer, `chokidar` 3.6.0, runs only under Eleventy's
`--watch`/`--serve`. GitHub **withdrew** the advisory on 2026-10-23. `npm audit` stopped
reporting it, the gate flagged the entry `STALE`, and #20 deleted it. That is the self-cleaning
path working as designed. `braces` 3.0.3 is still in the tree via `chokidar` and leaves it when
Eleventy 4 ships `chokidar ^5`.

One finding from that review still matters if `braces` or `chokidar` comes up again: **do not
override `chokidar` to `>=4`.** chokidar 4 dropped glob support, so every Eleventy watch target
and ignore pattern matches nothing. `npm run dev` keeps serving but silently stops rebuilding.

### Code scanning (separate from `deploy.yml`)

CodeQL runs on the same pushes and PRs via GitHub's **default setup**, configured in
repository Settings → Code security, *not* by a committed workflow. There is deliberately
no `.github/workflows/codeql.yml`; if you go looking for one, that is why. It surfaces as
four additional checks on every PR: `CodeQL`, plus `Analyze (actions)`,
`Analyze (javascript-typescript)`, and `Analyze (python)`.

The Python analysis is not vestigial — the repo carries Python under `scripts/`, `manim/`,
and `src/python/` even though none of it ships to the site. Switching to an advanced
(committed-workflow) setup would let you pin the query suite and language matrix, at the
cost of maintaining the workflow.

### Deploy (main branch only)

Artifacts are uploaded and deployed to GitHub Pages **only** on pushes to `main`. Pull requests run the full check suite without deploying.

### Permissions

```yaml
permissions:          # workflow default, so the build job's
  contents: read      # token is read-only

jobs:
  deploy:
    permissions:      # granted to this job alone
      pages: write    # publish the Pages artifact
      id-token: write # OIDC token deploy-pages exchanges for that publish
```

Minimal privilege model: no job can write repository contents, and only `deploy` can
publish. The build job runs `npm ci` and the whole toolchain (third-party code) on PR branches
as well as `main`, so it gets no Pages or OIDC grant to misuse. `upload-pages-artifact` does not
need one; it uploads with the runner's own artifact token. Because `deploy` runs only on pushes
to `main`, a PR cannot exercise its permissions. The first merge after any change to this block
is the real test, and if it fails Pages keeps serving the last good deploy.

## Configuration Files

| File | Purpose |
|------|---------|
| `eslint.config.js` | ESLint 10 flat config; `@eslint/js` recommended with `no-undef`/`no-unused-vars` off for legacy browser code, `_site/` ignored |
| `.htmlvalidate.json` | HTML validation; allows inline styles, void-style, and trailing whitespace (template artifacts) |
| `.gitleaks.toml` | Gitleaks baseline config (extend to allowlist known false positives) |
| `scripts/audit-gate.mjs` | Dependency audit gate; fails on high/critical advisories outside the allowlist, and on expired or stale allowlist entries |
| `audit-allowlist.json` | Advisories permitted to not fail the build, each with a reason and an expiry date |

## Dependency Management

- ESLint is on v10 with flat config (`eslint.config.js`). `eslint-config-standard` was dropped in the v8->v10 migration: it was never ported to flat config (it still peer-deps `eslint ^8`) and its stylistic ruleset was already switched off, so `@eslint/js` recommended is the equivalent baseline.
- CI runs Node 24. `html-validate` 11 requires Node `^22.22.0 || >=24.8.0`, so Node 20 is no longer supported by the toolchain.
- `package.json` `overrides` force patched transitive dependencies; each entry is explained in the adjacent `comments` block. An override is always the preferred fix; `audit-allowlist.json` is only for advisories with no patched version anywhere upstream. The `comments` block also explains dependencies that are not overrides when the reason is security-relevant (`katex`). `@11ty/recursive-copy` is overridden to `^5.0.2` because Eleventy 3.1.6 still pins `^4.0.4`, whose `minimatch` 3.x pulls a `brace-expansion` vulnerable to GHSA-mh99-v99m-4gvg. Re-check on each Eleventy release and drop the override when it is no longer needed.
- **No third-party scripts from CDNs.** Anything the site ships to browsers is an npm
  `dependency`, copied into `_site/assets/vendor/` by `eleventy.config.js`. A CDN `<script>` is
  invisible to `npm audit` and Dependabot. That is how KaTeX sat on 0.16.11 inside two advisories
  (GHSA-cg87-wmx4-v546, GHSA-238p-pmpm-9mq7) with every check green. KaTeX is now self-hosted;
  `package.json` `comments` has the details. Google Fonts is the one remaining remote origin, and
  it serves CSS and fonts only, no script.
- The `gitleaks` npm package was removed from `devDependencies` (non-functional placeholder). Secret scanning in CI uses the official GitHub Action; local scanning requires the [gitleaks binary](https://github.com/gitleaks/gitleaks#installing).

## Already in place

- **Dependabot security updates** are active — they have opened and merged PRs against this
  repo (#4, #5, #9). Note there is **no `.github/dependabot.yml`**, so this is security-alert
  updates only; scheduled *version* updates are not configured. Adding that file is the
  remaining half of the story if you want routine bumps rather than only advisory-driven ones.
- **CodeQL** code scanning, via default setup (see above).
- **Secret scanning and push protection**, enabled 2026-10-27 and confirmed through the API
  (`security_and_analysis`). Push protection blocks a secret at `git push`, which Gitleaks in CI
  cannot do; it only reports after the fact.

## Recommendations for Further Hardening

- **Add Content Security Policy** via a `<meta>` tag in `base.njk`. With KaTeX self-hosted,
  scripts are same-origin only. The remote origins left are:
  - `style-src` / `font-src`: `fonts.googleapis.com`, `fonts.gstatic.com`
  - `img-src`: `www.nist.gov` (the footer NIST logo is a remote `<img src>`, not a local asset)

  Gotcha before attempting this: `base.njk` contains **two inline `<script>` blocks** (the
  anti-flash theme bootstrap and the KaTeX auto-render call). A naive policy will break both.
  They need either hashes (workable — the build is static, so the hashes are stable) or
  `'unsafe-inline'`, which would defeat much of the point. KaTeX also writes inline `style`
  attributes on the elements it renders, so `style-src` will need `'unsafe-inline'` regardless.
  That is the usual compromise; inline styles are a far smaller hole than inline scripts.
  `/evie/` frames the generated dashboard at `/evie/app/` (same origin), so the policy also needs
  `frame-src 'self'`. The dashboard itself is already inline-script-free: in TDA-SST it runs
  under its own `script-src 'self'` policy, and a test there pins that.
- **Configure Dependabot version updates** (`.github/dependabot.yml`) — see above. Include the
  `github-actions` ecosystem: the workflow's actions are on tag pins (`checkout@v4`,
  `upload-pages-artifact@v3`, `deploy-pages@v4`, `gitleaks-action@v2`), and nothing bumps them.
- **Re-enable strict ESLint rules** gradually (`no-undef`, `no-unused-vars`) as code is cleaned
  up; the stylistic rules (`semi`, `quotes`) are no longer enforced by the config at all since
  `eslint-config-standard` was dropped.
- **Drop the `@11ty/recursive-copy` override** once Eleventy ships a stable release depending on
  `recursive-copy >=5`. As of this writing the only such release is `4.0.0-alpha.10` (canary),
  which already pins `^5.0.2` — so the fix is coming upstream, but pinning a live site to an
  Eleventy 4.0 alpha is not a reasonable trade for removing a two-line override. Re-check on each
  Eleventy release; Eleventy 4.0 will be a major with its own migration, so this is not a
  drive-by change.
