# DevOps / dependencies audit

Auditor: devops-deps-auditor
Date: 2026-10-03
Scope: `package.json`, `package-lock.json`, `vercel.json`, `public/`, `src/` (env use only), `supabase/` (deploy/ops aspects only), git history, README.
Method: read the files; ran `npm audit` (lockfile only), `npm ls`, `npm outdated`, and one real `react-scripts build` into the scratchpad (nothing written to the repo; `node_modules/` appeared untracked in `git status` from a parallel install, not from this audit).

## Totals

| Severity | Count |
|---|---|
| Critical | 0 |
| High | 5 |
| Medium | 11 |
| Low | 5 |
| Info | 1 |
| Total | 22 |

Things I could not see from the repo and marked `Verified: no`: the Vercel project settings (env scoping, preview protection), the Supabase plan/backup settings, and whether the production WhatsApp token is set.

## Measured baseline

- Node 22.22 / npm 10.9. Lockfile v3, 1356 entries, in sync with `package.json` (`npm ls` clean).
- `npm audit`: 95 vulnerabilities (2 critical, 74 high, 13 moderate, 6 low). The tool reports all of them as "prod" and 0 as "dev" because `react-scripts` and its whole toolchain sit in `dependencies`. Only 1 direct dependency is flagged at runtime: `xlsx`. The other 94 are build/dev-server tooling that never ships to the browser (see DEP-2).
- `npm audit fix --force` suggests `react-scripts@0.0.0`, which is a downgrade to nothing. Do not run it.
- Production build: "Compiled successfully", zero warnings. Main bundle 125 kB gzip plus 4 small chunks, so code splitting works. 34 `.map` files (9.0 MB) are emitted.
- `npm outdated` (current -> latest): react 18.3.1 -> 19.3.0, react-router-dom 6.30.3 -> 7.18.4, recharts 2.15.4 -> 3.10.1, lucide-react 0.294.0 -> 1.51.0, date-fns 3.6.0 -> 4.4.0 (unused), `@supabase/supabase-js` 2.108.2 -> 2.117.2 (inside its caret range).
- Tests: 0 test files. Lint config: no `eslintConfig` in `package.json`, no `.eslintrc`.
- Git: 47 commits, most titled "Add files via upload" (GitHub web upload). Branches `main` and `claude/friendly-bohr-ed3jya`. No `.github/`.

---

## Dependencies

### [DEP-1] xlsx 0.18.5 (unpatched npm copy) parses user-uploaded files in the browser
- Severity: High
- Effort: S (<1h)
- Location: `package.json:13`, `src/pages/Import.jsx:4,157-159`
- Evidence: `"xlsx": "^0.18.5"` resolves to 0.18.5. `npm audit` flags it as a direct dependency with no fix available: "Prototype Pollution in sheetJS" and "SheetJS Regular Expression Denial of Service (ReDoS)". `Import.jsx:157` runs `XLSX.read(data, { type: "array" })` on a file the user picks, then `sheet_to_json`.
- Impact: A crafted .xlsx (for example one forwarded to the office by a parent or a vendor) can pollute `Object.prototype` or hang the tab while an admin imports students. Prototype pollution in a page that also holds the Supabase session and drives permission checks is a realistic escalation path. SheetJS stopped publishing fixes to npm after 0.18.5; the patched versions (0.19.3 and later) are only on their own CDN.
- Fix: Either (a) install the maintained SheetJS build: `npm i https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz` (pin the exact URL, vendor the tarball into the repo if the CDN availability worries you), or (b) swap to `exceljs`, which is on npm and maintained (about 1 hour, the code only uses `read`, `sheet_to_json`, `aoa_to_sheet`, `book_new`, `book_append_sheet` and `writeFile`; 6 call sites, all in `Import.jsx`). Also add a file-size cap (for example 5 MB) and a row cap before parsing.
- Verified: yes (audit output and code path); exploitation not attempted.

### [DEP-2] Create React App (react-scripts 5.0.1) is deprecated; 94 build-tooling advisories cannot be fixed in place
- Severity: Medium
- Effort: M (<1 day)
- Location: `package.json:16,20-23`
- Evidence: `"react-scripts": "5.0.1"` is the last release and is no longer maintained. Audit highlights, all transitive: `shell-quote` and `websocket-driver` (critical), `webpack-dev-server`, `serialize-javascript` (RCE in a build-time plugin), `nth-check`, `postcss`, `svgo`, `jest` family, `workbox-build`, `lodash`, `braces`, `micromatch`, `ws`. `fixAvailable` for most is `react-scripts@0.0.0` (semver-major downgrade), i.e. no real fix exists.
- Impact: These run on the developer machine or on Vercel's build container, not in the user's browser, so production exposure is low today. The real cost is that `npm audit` will always be red, which trains everyone to ignore it, and that no new Node/React/ESLint versions are supported.
- Fix: Migrate to Vite. Cost estimate from reading the repo (about 4 to 6 hours):
  1. `npm i -D vite @vitejs/plugin-react vitest jsdom @testing-library/react`; remove `react-scripts`.
  2. Move `public/index.html` to repo root as `index.html`; replace `%PUBLIC_URL%` with `/`; add `<script type="module" src="/src/index.jsx"></script>`.
  3. Rename `src/index.js` and `src/App.js` to `.jsx` (these are the only two `.js` files containing JSX; confirmed by grep). The `hooks/` and `utils/` `.js` files have no JSX.
  4. Replace `process.env.REACT_APP_*` with `import.meta.env.VITE_*`. There are only 11 references in 5 files: `src/lib/supabaseClient.js`, `src/utils/whatsapp.js`, `src/pages/Settings.jsx`, `src/pages/ReminderLogs.jsx` (plus comments). Rename the Vercel variables at the same time.
  5. `vite.config.js` with `build.outDir: "build"` (keeps `vercel.json` happy) and `build.sourcemap: false`.
  6. Scripts: `dev`, `build`, `preview`, `test` (vitest).
  7. Move all tooling to `devDependencies`, so `npm audit --omit=dev` becomes meaningful and can gate CI.
  Risk is low: 20 lazy-loaded pages, no CRA-specific features (no `eject`, no proxy, no `homepage`). Re-test the print windows (`window.open` + `document.write`) and the realtime channels after the move.
- Verified: yes

### [DEP-3] `date-fns` and `react-hook-form` are listed but never imported
- Severity: Low
- Effort: S (<1h)
- Location: `package.json:5,10`
- Evidence: `grep -rn "date-fns\|react-hook-form\|useForm" src` returns nothing. Date handling is done in `src/utils/dates.js`. Every form uses local `useState`.
- Impact: Extra install weight, extra advisory surface, and a false impression that forms are validated by a library. Tree-shaking keeps them out of the bundle, so this is hygiene only.
- Fix: `npm rm date-fns react-hook-form`. Everything else listed (`recharts`, `lucide-react`, `react-hot-toast`, `react-router-dom`, `@supabase/supabase-js`, `xlsx`) is imported.
- Verified: yes

### [DEP-4] Loose version ranges, no Node pin, no automated dependency updates
- Severity: Low
- Effort: S (<1h)
- Location: `package.json` (whole file)
- Evidence: Caret ranges everywhere except `react-scripts`. No `engines`, no `.nvmrc`, no `.npmrc` with `save-exact`. No `.github/dependabot.yml` or `renovate.json`. `lucide-react` is at 0.294 (Dec 2023) while the package is now 1.x.
- Impact: The lockfile pins what is installed, so builds are reproducible as long as `npm ci` is used. But the Vercel default Node version can change under you, and nobody is told when `@supabase/supabase-js` ships a security fix.
- Fix: Add `"engines": { "node": ">=20 <23" }` and a `.nvmrc` containing `20`. Use `npm ci` in CI and Vercel (`installCommand` in `vercel.json`). Add Dependabot (weekly, grouped minor/patch, separate npm and github-actions ecosystems). Do not chase majors (react 19, router 7, recharts 3) until after the Vite move; they are not security-driven.
- Verified: yes

### [DEP-5] No `.gitignore`; a `.env` file was committed in history
- Severity: Medium
- Effort: S (<1h)
- Location: repo root; git commits `f4fb20a` (added `.env`), `6720150` (deleted `.env`), `da6c1ab` ("Delete .gitignore")
- Evidence: `ls -a` shows no `.gitignore`. `git status` shows `?? node_modules/`, so one `git add .` stages about 900 packages. `git ls-files` currently contains no `node_modules`, `.env` or `build/` (checked, clean). But history contains `.env` with six `REACT_APP_FIREBASE_*` values and three `REACT_APP_WHATSAPP_*` lines. The WhatsApp phone-id and token values begin with `leave_`, which looks like placeholders, so I do not believe a real WhatsApp token leaked. The Firebase keys are real-format values for a project called `skofi-...`. Firebase web keys are not secrets by design, but the project is obsolete (the app was ported to Supabase; `src/firebase.js` is now only a shim).
- Impact: A single careless `git add .` commits `node_modules`, `build/` or a new `.env` with a real Supabase or WhatsApp value. The old Firebase project may still accept requests if its rules were open.
- Fix: Restore `.gitignore` (text below). Delete or lock down the old Firebase project (disable Auth and Firestore, or set rules to deny-all) and rotate its API key. If any real WhatsApp token was ever in history, revoke it in Meta Business settings; history rewrite is optional once revoked. Enable GitHub secret scanning and push protection on the repo.

```gitignore
# dependencies
/node_modules
/.pnp
.pnp.js

# build / test output
/build
/dist
/coverage

# env (keep .env.example committed)
.env
.env.*
!.env.example

# misc
.DS_Store
npm-debug.log*
yarn-debug.log*
yarn-error.log*
.vercel
supabase/.temp
supabase/.branches
```
- Verified: yes

---

## Build and deploy

### [DEP-6] Build script disables warnings-as-errors with `CI=`
- Severity: Medium
- Effort: S (<1h)
- Location: `package.json:20`
- Evidence: `"build": "CI= react-scripts build"`. Vercel sets `CI=true` automatically, which makes CRA treat ESLint warnings as build failures; the `CI=` prefix overrides that to empty on purpose. It is also POSIX-only syntax and fails on Windows `cmd`. There is no `eslintConfig` in `package.json`, so only CRA's base rule set runs.
- Impact: Any lint warning (unused variable, missing hook dependency, which in a realtime app can mean stale data bugs) ships silently. Today the build is clean (verified: "Compiled successfully", no warnings), so turning the strict mode on costs nothing now and is cheapest to adopt now.
- Fix: Set `"build": "react-scripts build"`, add `"eslintConfig": { "extends": ["react-app", "react-app/jest"] }`, and add `"lint": "eslint src --max-warnings 0"`. After the Vite move, use ESLint flat config with `eslint-plugin-react-hooks`.
- Verified: yes

### [DEP-7] Source maps are published to production
- Severity: Low
- Effort: S (<1h)
- Location: build output; `package.json:20`
- Evidence: A real build produced 34 `.map` files totalling 9.0 MB under `build/static/js/`. CRA emits them by default and Vercel serves everything in `build/`.
- Impact: Anyone can download the original, commented source of every page, including the permission model (`UserContext`) and every Supabase table and column name. This does not break RLS, but it hands an attacker a free map and reveals comments such as "safe to re-run" operational hints.
- Fix: Set `GENERATE_SOURCEMAP=false` for the Production environment in Vercel (or `build.sourcemap: false` after Vite). If you adopt Sentry (DEP-17), upload the maps in CI with the Sentry CLI and then delete them from the deploy output.
- Verified: yes

### [DEP-8] `vercel.json` has only a rewrite: no security headers, no cache policy
- Severity: Medium
- Effort: S (<1h)
- Location: `vercel.json:1-3`
- Evidence: The whole file is `{"rewrites":[{"source":"/(.*)","destination":"/index.html"}]}`. No `headers`. `public/robots.txt` is `User-agent: *` / `Disallow:` (allow all).
- Impact: No CSP, no clickjacking protection (the app can be framed), no HSTS preference, no `nosniff`. The app builds HTML with `document.write` in `src/utils/exportUtils.js:16-17` and `src/pages/Payslips.jsx:235-236`, so a CSP is a meaningful second layer if any student/employee field is ever interpolated unescaped (the security-auditor should rate that separately). Default Vercel caching is already fine for hashed assets, but `index.html` and any future service worker should be explicitly non-cacheable.
- Fix: Replace `vercel.json` with the following (review the CSP in report-only mode first; `style-src 'unsafe-inline'` is needed because the app uses inline styles; replace the Supabase host with your project ref):

```json
{
  "installCommand": "npm ci",
  "rewrites": [{ "source": "/((?!api/|static/|assets/).*)", "destination": "/index.html" }],
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        { "key": "Strict-Transport-Security", "value": "max-age=63072000; includeSubDomains; preload" },
        { "key": "X-Content-Type-Options", "value": "nosniff" },
        { "key": "X-Frame-Options", "value": "DENY" },
        { "key": "Referrer-Policy", "value": "strict-origin-when-cross-origin" },
        { "key": "Permissions-Policy", "value": "camera=(), microphone=(), geolocation=(), payment=()" },
        { "key": "Content-Security-Policy", "value": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://<PROJECT_REF>.supabase.co; connect-src 'self' https://<PROJECT_REF>.supabase.co wss://<PROJECT_REF>.supabase.co; font-src 'self' data:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'" }
      ]
    },
    { "source": "/static/(.*)", "headers": [{ "key": "Cache-Control", "value": "public, max-age=31536000, immutable" }] },
    { "source": "/index.html", "headers": [{ "key": "Cache-Control", "value": "no-cache" }] },
    { "source": "/", "headers": [{ "key": "Cache-Control", "value": "no-cache" }] }
  ]
}
```
  Also change `robots.txt` to `Disallow: /` (the app is login-only; there is nothing to index). After the Vite move, the static path becomes `/assets/`.
- Verified: yes (file contents); CSP compatibility with the print windows not tested.

### [DEP-9] Service worker file is named `sw.js ` (trailing space), so it never registers; its contents are also broken
- Severity: Medium
- Effort: S (<1h)
- Location: `public/sw.js ` (note the trailing space; `git ls-files` shows `public/sw.js `), `src/index.js:12-17`
- Evidence: `git ls-files | cat -A` prints `public/sw.js $`. The production build copies it as `sw.js ` as well. `src/index.js` registers `/sw.js`, which does not exist, so Vercel's catch-all rewrite answers with `index.html` (text/html) and registration fails with a MIME error that is only logged as `SW failed`. If the file name were fixed, it would still fail: the precache list is `["/", "/static/js/main.chunk.js", "/static/css/main.chunk.css"]`, and CRA 5 emits hashed names (`main.996b7a82.js`), so `cache.addAll` rejects and install aborts. The fetch handler is cache-first for everything, which would serve a stale `index.html` after each deploy pointing at deleted hashed chunks (lazy pages then fail to load). `manifest.json` declares one `zmi_logo.png` as both 192x192 and 512x512; the file is 205x246 px, so the install icon is invalid.
- Impact: The advertised PWA/offline behaviour does not exist today. Do not "fix" it by just renaming the file: that would create the stale-shell bug on every release, which for a fee-collection tool means staff running old code after a patch.
- Fix: Decide: (a) remove the service worker and the registration (cheapest; the app needs the network anyway because RLS data is live), or (b) use `vite-plugin-pwa` / Workbox with `registerType: "autoUpdate"`, network-first for navigation, and never cache Supabase responses. In either case produce real 192 and 512 px PNG icons (square) for the manifest.
- Verified: yes

### [DEP-10] Secrets exposed in the client bundle: `REACT_APP_WHATSAPP_TOKEN`
- Severity: High
- Effort: M (<1 day)
- Location: `src/utils/whatsapp.js:17-19,28-33`; callers `src/pages/Fees.jsx:12,157,188,291,307,389`, `src/pages/QuickPayment.jsx:5,63`, `src/pages/Settings.jsx:2,12-14,27`; README "Environment variables"
- Evidence: `token: process.env.REACT_APP_WHATSAPP_TOKEN` is read in browser code and sent as `Authorization: Bearer ${token}` straight to the Meta Graph API from the user's browser. CRA inlines every `REACT_APP_*` value into the JavaScript at build time. The README tells you to set the permanent token as a Vercel variable. The comment in `whatsapp.js:6` says "a permanent access token".
- Impact: If the variable is set in Vercel, the token is in a static JS file that anyone on the internet can download without logging in. They can send WhatsApp messages as your school number, burn the template quota, get the number flagged or banned, and read the account's phone-number metadata. The Settings page text "Keys can't be edited here for security" is misleading because the key is already public. Whether the production value is set is unknown from the repo.
- Fix: Move sending server-side. Create a Supabase Edge Function `send-whatsapp` (or a Vercel `/api` function) that verifies the caller's JWT and role, holds `WHATSAPP_TOKEN` as a server secret, and accepts only `{studentId | invoiceId, templateName}` rather than arbitrary phone numbers and text. Replace `whatsapp.js` `post()` with a call to that function. Then delete `REACT_APP_WHATSAPP_*` from Vercel and rotate the token in Meta Business settings (treat the old one as burned). Use an approved template for first contact (the 24-hour rule is already documented in the file).
- Verified: yes (mechanism traced from source to Graph API call); production value unknown

### [DEP-11] `REACT_APP_CRON_SECRET` is a shared secret shipped to the browser; the `/api/send-reminders` handler is not in the repo
- Severity: High
- Effort: M (<1 day)
- Location: `src/pages/ReminderLogs.jsx:68-76`; no `api/` directory exists
- Evidence: `fetch("/api/send-reminders", { method: "POST", headers: { "x-cron-secret": process.env.REACT_APP_CRON_SECRET || "" } })`. `ls /home/user/school-erp/api` fails; `vercel.json` has no `crons` entry; the variable is not mentioned in the README or any `.env` example.
- Impact: (1) A header secret that is inlined into the public bundle is not a secret; anyone can call the endpoint and trigger a mass WhatsApp send to every overdue parent. (2) The server code that holds the service-role key or WhatsApp token for reminders is somewhere outside version control (or does not exist), so it cannot be reviewed, tested, or redeployed from this repo, and the "daily automatic" claim in the UI (`ReminderLogs.jsx` header) cannot be confirmed. The UI error text "Make sure it is deployed" suggests it may not be.
- Fix: Add the handler to the repo (`api/send-reminders.js` or a Supabase Edge Function scheduled by `pg_cron`/Supabase Cron). Authenticate scheduled calls with a server-only `CRON_SECRET` (Vercel Cron sends it as `Authorization: Bearer`), and authenticate the "Send now" button with the user's Supabase JWT plus an admin role check, not a shared secret. Remove `REACT_APP_CRON_SECRET`. Document it in `.env.example`.
- Verified: yes (client side); server side unknown

### [DEP-12] `.env.example` does not exist, and the README misses variables
- Severity: Low
- Effort: S (<1h)
- Location: `README.md:15-25`
- Evidence: README: "copy `.env.example` to `.env`", but there is no such file (`git ls-files` has none). `REACT_APP_CRON_SECRET` is used in code and not documented. README says the app "needs two variables" while code reads five to seven.
- Impact: New contributors guess the variable names; `supabaseClient.js` only `console.error`s when they are missing and then calls `createClient(undefined, undefined)`, which throws at import time and shows a white screen.
- Fix: Add the file below (commit it; `.gitignore` above already allows it). After DEP-10/11 are done, the three WhatsApp/cron lines disappear from the client list.

```dotenv
# .env.example  -- copy to .env.local (never commit real values)
# Everything prefixed REACT_APP_ is PUBLIC: it is compiled into the browser bundle.
# Never put a secret, a service_role key or a WhatsApp token here.

# Supabase -> Project Settings -> API
REACT_APP_SUPABASE_URL=https://YOUR-PROJECT-REF.supabase.co
REACT_APP_SUPABASE_ANON_KEY=your-anon-public-key

# --- Legacy / to be removed (see audit DEP-10, DEP-11) ---
# REACT_APP_WHATSAPP_API_URL=https://graph.facebook.com/v21.0
# REACT_APP_WHATSAPP_PHONE_ID=
# REACT_APP_WHATSAPP_TOKEN=      # SECRET: do NOT set this in a browser build
# REACT_APP_CRON_SECRET=         # SECRET: do NOT set this in a browser build

# --- Server-side only (Supabase Edge Function secrets / Vercel server env, NOT REACT_APP_) ---
# supabase secrets set SERVICE_ROLE_KEY=...  PROJECT_URL=https://YOUR-PROJECT-REF.supabase.co
# supabase secrets set WHATSAPP_TOKEN=...  WHATSAPP_PHONE_ID=...  CRON_SECRET=...
```
- Verified: yes

### [DEP-22] No separation of Preview and Production environments on Vercel
- Severity: Medium
- Effort: S (<1h)
- Location: Vercel project settings (not in repo); `README.md:15-17,57`
- Evidence: README says "set the two env vars" once and deploy. Vercel scopes new variables to Production, Preview and Development unless you untick them, so every pull-request preview would be built with production Supabase credentials. Preview URLs are public by default unless Deployment Protection is on.
- Impact: Anyone testing a branch writes into the live fee/payment tables; preview URLs are guessable and reachable without Vercel login, and unreleased code runs against real student data.
- Fix: Create a second Supabase project (staging, see DEP-15) and set its URL/anon key for Preview only; keep production values for Production only. Turn on Vercel Deployment Protection (Standard or Vercel Authentication) for previews. Set `GENERATE_SOURCEMAP=false` for Production only if you want maps in previews.
- Verified: no (cannot see the Vercel project)

---

## CI/CD and tests

### [DEP-13] No CI, no branch protection; changes are pushed by GitHub web upload
- Severity: Medium
- Effort: M (<1 day)
- Location: repo root (`.github/` absent); `git log` ("Add files via upload" x 9 of the first 10 commits)
- Evidence: `ls .github` fails. Commit messages show files uploaded straight to `main` through the browser. Nothing runs before Vercel deploys `main`.
- Impact: A broken build, a committed secret, or an RLS change that locks everyone out goes live without any check or second pair of eyes, and there is no audit trail of who approved a schema change.
- Fix: Add the workflow below, protect `main` (require PR, 1 review, required status checks `web` and `secrets` and `sql`, no force push, linear history, dismiss stale approvals), enable Dependabot and GitHub secret scanning with push protection. Notes for the reviewer: `npm audit` is non-blocking at first because of DEP-2 (the CRA tree is permanently red); flip it to blocking `--omit=dev --audit-level=high` after the Vite move. The SQL job applies the SQL files to a throwaway Postgres with a minimal Supabase stub; confirm the file order against how you really deploy (I assumed schema, trash, accounting, security, realtime).

```yaml
# .github/workflows/ci.yml
name: CI

on:
  pull_request:
  push:
    branches: [main]

permissions:
  contents: read

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

jobs:
  web:
    name: lint, test, build, audit
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - name: Lint
        run: npx eslint src --max-warnings 0
      - name: Test
        run: npm test -- --watchAll=false --passWithNoTests   # vitest: npm test -- --run
        env:
          CI: "true"
      - name: Build (warnings are errors)
        run: npm run build
        env:
          CI: "true"
          GENERATE_SOURCEMAP: "false"
          REACT_APP_SUPABASE_URL: https://example.supabase.co
          REACT_APP_SUPABASE_ANON_KEY: ci-placeholder
      - name: npm audit (production, blocking only on critical until CRA is removed)
        run: npm audit --omit=dev --audit-level=critical
        continue-on-error: true   # remove after Vite migration and use --audit-level=high
      - name: Fail if build output contains secrets-looking env names
        run: |
          ! grep -R --include=*.js -E "WHATSAPP_TOKEN|CRON_SECRET|service_role" build/static || (echo "secret name found in bundle" && exit 1)

  secrets:
    name: gitleaks
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: gitleaks/gitleaks-action@v2
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}

  sql:
    name: SQL applies cleanly
    runs-on: ubuntu-latest
    timeout-minutes: 10
    services:
      postgres:
        image: postgres:15
        env:
          POSTGRES_PASSWORD: postgres
        ports: ["5432:5432"]
        options: >-
          --health-cmd "pg_isready -U postgres"
          --health-interval 5s --health-timeout 5s --health-retries 10
    env:
      PGHOST: localhost
      PGUSER: postgres
      PGPASSWORD: postgres
      PGDATABASE: postgres
    steps:
      - uses: actions/checkout@v4
      - name: Minimal Supabase stub (auth schema, roles, realtime publication)
        run: |
          psql -v ON_ERROR_STOP=1 <<'SQL'
          create role anon nologin;
          create role authenticated nologin;
          create role service_role nologin bypassrls;
          create schema auth;
          create table auth.users (id uuid primary key default gen_random_uuid(), email text);
          create function auth.uid() returns uuid language sql stable
            as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
          create publication supabase_realtime;
          SQL
      - name: Apply in order, then re-apply (idempotency)
        run: |
          for pass in 1 2; do
            for f in schema trash accounting security realtime; do
              echo "== pass $pass: $f.sql"
              psql -v ON_ERROR_STOP=1 -f supabase/$f.sql
            done
          done
      - name: Lint SQL style (non-blocking)
        run: |
          pip install sqlfluff
          sqlfluff lint supabase/*.sql --dialect postgres || true
```
- Verified: yes (absence of CI); workflow itself not executed here

### [DEP-14] No automated tests; `npm test` is not runnable in CI as configured
- Severity: Medium
- Effort: L (>1 day)
- Location: `package.json:21` (`"test": "react-scripts test"`); no `*.test.*` files
- Evidence: `find . -name "*.test.*" -not -path "./node_modules/*"` returns nothing. `react-scripts test` starts in watch mode and, with no tests, exits with code 1 unless `--passWithNoTests` is added.
- Impact: Money logic (`src/utils/accounting.js`, invoice/concession maths, payslips) and the Firestore-to-Supabase mapping layer (`src/firebase.js` `encode`/`decode`, which silently routes unknown keys into `extra`) can regress unnoticed. An RLS regression locks out a branch or, worse, opens one.
- Fix: Start small, in this order: (1) unit tests for `src/utils/accounting.js`, `dates.js`, `branchFilter.js`, `bulk.js`; (2) tests for `encode`/`decode`/`updateDocs` extra-merge in `src/firebase.js` with a mocked `supabase`; (3) pgTAP or plain-SQL tests that set `request.jwt.claim.sub` and assert per-role/per-branch access against `security.sql` in the CI `sql` job; (4) one Playwright smoke test (login, create invoice, record payment) against the staging project. Add `--watchAll=false --passWithNoTests` to the CI test command now so the job works from day one.
- Verified: yes

---

## Environments and database operations

### [DEP-15] Single Supabase project, no migrations, and the README setup is incomplete
- Severity: High
- Effort: M (<1 day)
- Location: `README.md:28-40`, `supabase/` (no `config.toml`, no `migrations/`), `src/firebase.js:123-140,205-215`
- Evidence: Nothing in the repo distinguishes dev from prod: one `REACT_APP_SUPABASE_URL`, no `supabase/config.toml`, no seed file. Schema changes are loose SQL files run by hand in the dashboard SQL Editor. README step list is only `schema.sql` then `security.sql`, but the client queries `deleted_at` on ten tables (`applyQuery` calls `.is("deleted_at", null)`), and that column is created by `trash.sql`; `accounting.sql` and `realtime.sql` are also required for chart-of-accounts behaviour and live updates. `fix_duplicate_accounts.sql` and `fix_duplicate_branches.sql` are one-off data repairs sitting beside setup scripts with no marking. Files are written to be re-runnable (`if not exists`, `drop policy if exists`, `create or replace`), which is good.
- Impact: A fresh environment built from the README fails on every list view with "column deleted_at does not exist" and has no live updates. With only one project, every schema or RLS experiment is done on real fee data. There is no record of which SQL has been applied to production, so drift is likely.
- Fix: (1) Run `supabase init`; move the SQL into `supabase/migrations/<timestamp>_*.sql` in the real order (baseline = current production dump via `supabase db dump`); put the `fix_*` scripts in `supabase/oneoff/`. (2) Create a staging project (or Supabase Branching on Pro: each PR gets a preview DB from the migrations) and a `supabase/seed.sql` with fake students. (3) Deploy through CI: `supabase link` + `supabase db push` on merge to `main` using a `SUPABASE_ACCESS_TOKEN` GitHub secret, with a manual approval environment for production. (4) Fix the README order immediately (below).
- Verified: yes (README vs client code); whether a second project exists is unknown

### [DEP-16] No evidence of backups, point-in-time recovery or a restore drill; hard deletes exist
- Severity: High
- Effort: M (<1 day)
- Location: `supabase/` and `README.md` (no mention); `src/firebase.js:96-100,129-135` (hard delete paths); `src/pages/Trash.jsx`
- Evidence: Neither the README nor any script mentions backups, retention, or recovery. Soft delete covers ten tables, but `users`, `custom_roles` and `audit_log` are hard-deleted by design (`trash.sql` last comment), "empty trash" and "delete forever" run real `DELETE`s (`emptyTrash`, `hardDeleteDoc`), and there is no automatic purge or retention rule. The `receipts` bucket is separate from the database; database backups never include Storage objects.
- Impact: One bad bulk edit (the app has bulk update/delete helpers), a wrong `DELETE` in the SQL editor, or a project pause/deletion loses the school's complete financial record. Supabase's free plan has no downloadable backups; Pro keeps daily backups for 7 days; PITR is a paid add-on. A backup nobody has restored is not a backup.
- Fix: (1) Confirm the plan: move to Pro and enable PITR (2-minute granularity) before the next fee cycle. (2) Add a nightly off-site logical backup from CI: `pg_dump` of the `public` schema (and `auth.users` via `supabase db dump` with `--data-only`) to encrypted object storage (for example an S3/R2 bucket with 30-day lifecycle), plus `rclone` of the `receipts` bucket. (3) Do a restore drill once per term into the staging project and record the date and RTO/RPO in the runbook. (4) Make "empty trash" admin-only and add a retention rule (for example `pg_cron` purge of rows trashed over 90 days, never for `payments`/`journals`). (5) Make `audit_log` append-only (revoke UPDATE/DELETE) so history survives.
- Verified: no (cannot see the Supabase dashboard); the absence of any documentation in the repo is verified

### [DEP-18] Edge Function: manual deploy, unpinned remote import, wildcard CORS, no config
- Severity: Medium
- Effort: S (<1h)
- Location: `supabase/functions/create-user/index.ts:17,19-24`; `README.md:35-39`
- Evidence: `import { createClient } from "https://esm.sh/@supabase/supabase-js@2"` (floating major, fetched from a third-party CDN at cold start); CORS `"Access-Control-Allow-Origin": "*"`; no `supabase/config.toml` so `verify_jwt` and function settings are not versioned; README says to deploy it by hand in the dashboard and set secrets named `SERVICE_ROLE_KEY` and `PROJECT_URL` (custom names because `SUPABASE_*` is reserved, which is fine). No rate limit on the endpoint other than Supabase's platform limits. (The role and password inputs are not validated; that is a security-auditor topic.)
- Impact: A bad upstream release or CDN incident can break user creation or, in the worst case, run attacker code that has your service-role key in memory. A hand-deployed function can drift from the file in the repo with no one noticing.
- Fix: Pin `npm:@supabase/supabase-js@2.108.2` (or `jsr:`) with a `deno.json` import map; restrict CORS to the production and staging origins; add `[functions.create-user] verify_jwt = true` to `config.toml`; deploy from CI (`supabase functions deploy create-user --project-ref $REF`) on merge, from the same workflow as DEP-15. Keep the admin check in the function as is.
- Verified: yes

---

## Reliability and observability

### [DEP-17] No error monitoring, no error boundary, no uptime check, no log retention plan
- Severity: Medium
- Effort: M (<1 day)
- Location: `src/` (whole app); `src/index.js:7-12`
- Evidence: `grep -rin "ErrorBoundary\|componentDidCatch\|sentry" src` returns nothing. There are 18 `console.log/error` calls, which only exist in the user's own browser. `Suspense` is used for lazy routes but with no error fallback, so a failed chunk load (common after a deploy) shows a blank page.
- Impact: Failed payment saves, RLS denials ("new row violates row-level security") and chunk-load failures are invisible to you; you learn about them when a branch accountant phones. Realtime errors are swallowed to `console.error` in `onSnapshot`.
- Fix: Add `@sentry/react` with `tracesSampleRate: 0.1`, a React error boundary around the routes (with a "reload" button that handles `ChunkLoadError`), user id and branch as tags, and scrub PII (names, phones, amounts) with `beforeSend`. Add a free uptime monitor (UptimeRobot/Better Stack) on the site root and a Supabase REST `HEAD` check. In Supabase, review the Auth and Postgres logs weekly and set up alerts (Pro: log drains) for spikes in 401/403/500s. Turn on the Supabase "Advisors" (security and performance) and treat their findings as CI-grade.
- Verified: yes

---

## Documentation

### [DEP-19] README gaps and no runbooks
- Severity: Medium
- Effort: M (<1 day)
- Location: `README.md`
- Evidence: README covers setup only. Specific problems: (1) SQL order is incomplete (DEP-15); (2) refers to the missing `.env.example` (DEP-12); (3) "Create a `receipts` storage bucket (public)" with no mention that public bucket URLs are guessable-by-link and expose payment receipts of students, flagged for the ux-compliance and security auditors; (4) no Node version, no `npm` scripts, no test/lint commands; (5) no explanation of the Firestore shim's pitfalls (unknown fields silently go to `extra`; the `COLUMNS` map in `src/firebase.js` must be kept in sync with `schema.sql`); (6) the filename `src/firebase.js` suggests Firebase is still used.
- Impact: Only the original developer can run, recover, or hand over this system.
- Fix: Update the setup block to this order, then add a `docs/runbooks/` folder with the four runbooks below (each: who, when, steps, rollback, verification).

README order fix:
```
Run in the SQL Editor, in order (or `supabase db push` once migrations exist):
1. supabase/schema.sql
2. supabase/trash.sql      (adds deleted_at; REQUIRED, the app filters on it)
3. supabase/accounting.sql
4. supabase/security.sql   (RLS)
5. supabase/realtime.sql   (live updates)
supabase/fix_*.sql are one-off repairs, do not run on a fresh project.
```

Runbook outlines to write:
- Onboard a new branch: insert into `branches` (via the Branches page), seed per-branch chart of accounts and fee heads, create the branch manager through the Users page (calls `create-user`), assign branch id and role, log in as that user and confirm they see only their branch (RLS check), add the branch to the nightly backup verification, record in the audit log.
- Start a new academic year: take a manual backup first; archive or flag last year's invoices (do not delete); roll forward grades/classes (script, dry-run on staging); generate monthly invoices with `recurring_fee`; carry forward opening balances as journals, not edits; close the old year in accounts; verify trial balance before and after.
- Restore from Trash: Trash page for soft-deleted rows (admin); for hard-deleted rows use PITR or the nightly dump into a scratch project, copy the rows back with `insert ... select`; note that `users` and `audit_log` are not in Trash; list who may do it and how to record the incident in the audit log.
- Rotate keys: Supabase anon key and JWT secret (dashboard, redeploy Vercel with the new anon key, expect all sessions to drop), service-role key (update Edge Function secret `SERVICE_ROLE_KEY`), WhatsApp token (Meta, update the server secret only), GitHub tokens/PATs, Vercel tokens; order of operations to avoid downtime; how to verify.
- Verified: yes

---

## Low-priority items

### [DEP-20] `robots.txt` allows all crawlers on a login-only application
- Severity: Low
- Effort: S (<1h)
- Location: `public/robots.txt:1-3`
- Evidence: `User-agent: *` followed by an empty `Disallow:`, which means "allow everything".
- Impact: The login page and any link the app leaks can be indexed. Low risk; mostly noise and reputational.
- Fix: Use `User-agent: *` / `Disallow: /`, and add `<meta name="robots" content="noindex">` to `index.html`. (The viewport tag in `index.html:6` disables zoom: leave to the ux-compliance-auditor.)
- Verified: yes

### [DEP-21] What is already in good shape
- Severity: Info
- Effort: S (<1h)
- Location: `src/App.js:10-34`, `package-lock.json`, `supabase/*.sql`, `README.md:26-28`
- Evidence: Pages are lazy-loaded (main bundle 125 kB gzip); build passes with no warnings; lockfile is v3 and consistent; SQL scripts are idempotent (`if not exists`, `drop policy if exists`, `create or replace function`); no real secret values found in the working tree or in history by pattern scan (the committed `.env` held placeholder WhatsApp values and a Firebase web config); the service-role key is correctly kept out of the browser and confined to the Edge Function.
- Impact: These make the fixes above cheap; nothing to do.
- Fix: Keep them when migrating (keep `React.lazy`, keep idempotent SQL).
- Verified: yes

---

## Suggested order of work

1. Today (under 2 hours): DEP-5 (`.gitignore`), DEP-1 (xlsx), DEP-3 (remove unused deps), DEP-12 (`.env.example`), DEP-20, README SQL order fix (DEP-19).
2. This week: DEP-10 and DEP-11 (move WhatsApp and cron server-side, rotate token), DEP-8 + DEP-7 (headers, no source maps), DEP-16 (confirm plan, enable PITR, first restore drill), DEP-13 (CI + branch protection), DEP-22.
3. This month: DEP-15 (staging + migrations), DEP-2 (Vite), DEP-17 (Sentry), DEP-18, DEP-14 (tests), DEP-9 (drop or rebuild the service worker), DEP-6, DEP-4, runbooks.
