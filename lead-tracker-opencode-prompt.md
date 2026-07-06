# Lead Tracker: Add Firebase Cloud Sync + Custom Query Management

Please add the following two feature sets to this existing lead-tracker web app.
Read `index.html` in full before changing anything. Preserve its visual style
(colors, layout, fonts) and all existing behavior except where instructed
otherwise below — this is an extension, not a rewrite. Work through the
sections in order. If you hit a decision that only the project owner should
make (especially anything security-related), ask instead of guessing.

## Context: what exists today

Single-file vanilla HTML/CSS/JS app, no framework, no build step.

- Lead fields: `leadName, contactNumber, emailId, inquiryDate, source, product,
  status, followupDate, notes`, plus internal `id, sno, updatedAt`.
- Data layer: tries to fetch/save `./api/db` (a local endpoint started by a
  batch file) and falls back to browser `localStorage` if that's unreachable.
  Neither is really "online" — nothing syncs across devices or team members.
- Filtering: one free-text search box plus four dropdowns (Status, Product,
  Source, Follow-up due). No way to build or save a more complex query.
- UI: gradient header, 5 dashboard stat cards, paginated table, a modal for
  add/edit, CSV export, a "Download DB" JSON backup button, toasts, responsive
  layout, PWA manifest + service worker.

## Goal

1. **Go fully online, at zero cost.** Replace the local-server/localStorage
   data layer with **Firebase** (Firestore for data, Firebase Authentication
   for login), and host the static site on **GitHub Pages**. Data should
   sync in real time across every device that's signed in.
2. **Add Custom Query Management** — a saved, reusable, advanced filter
   builder. Full spec below.

Zero ongoing cost is a hard constraint: only use Firebase's free **Spark**
plan (no billing account attached) and GitHub's free tier.

## Why Firebase + GitHub together

GitHub Pages is free static hosting but has no database. Firebase's Spark
plan gives you a real database (Firestore) and real login (Auth), free, with
no server to run. GitHub hosts the code, Firebase holds the data — $0/month.

(A pure "GitHub-as-database" approach — reading/writing a JSON file through
the GitHub API — was considered and rejected: no real-time sync, low rate
limits, and it can't be done securely from a public page without exposing a
personal access token. Firebase is the better free option. If the project
owner would rather keep hosting inside the Firebase console too, Firebase
Hosting's free tier is a drop-in swap for GitHub Pages in the deploy step.)

## Hard constraints

- Stay static: plain HTML/CSS/JS. Load Firebase via the CDN-hosted **modular**
  SDK (`<script type="module">` + `import` from `gstatic.com`) — no npm, no
  bundler. Check https://firebase.google.com/docs/web/setup for the current
  CDN URL/version rather than hardcoding one here. It must deploy by just
  pushing files — no build pipeline.
- No paid Firebase features: no phone-auth, no Cloud Functions unless truly
  unavoidable, nothing that requires the Blaze (pay-as-you-go) plan.
- Fine to split into a few files (`index.html`, `app.js`, `firebase-config.js`,
  `queries.js`) for readability, but don't introduce React/Vue/a bundler —
  the app's simplicity is intentional.
- Keep every existing feature working: dashboard cards, search, the four
  existing dropdown filters, pagination, add/edit/delete modal, CSV export,
  JSON backup download, responsive layout, toasts.
- Add a one-time **Import** tool that reads an old `leadtracker_db.json`
  (from the existing "Download DB" button) and bulk-loads those leads into
  Firestore, deduping by `id`, so nobody loses data when migrating.
- **Out of scope** — don't build these: role-based permissions, a public
  self-serve sign-up page, phone/SMS auth, payments, a native mobile app.

## Architecture

- **Hosting**: GitHub Pages, served from a **public** repo (see note below).
- **Data**: Firestore, two collections — `leads` and `savedQueries` (schema
  below).
- **Auth**: Firebase Authentication, Email/Password provider only. Gate the
  entire app behind sign-in.
- Use a single `onSnapshot` listener on the whole `leads` collection to keep
  a live in-memory array, then **keep doing search/filter/sort in JavaScript**
  exactly like the current `filtered()` function does today — just extend it
  to also evaluate custom query conditions. Don't try to translate custom
  queries into native Firestore compound queries: Firestore's query language
  doesn't handle arbitrary AND/OR/"contains" combinations well and would need
  composite indexes for little benefit. At small-business data volumes
  (hundreds to a few thousand leads), client-side filtering is simpler,
  matches the existing code, and comfortably stays inside the free daily
  read quota.
- Turn on Firestore's offline persistence (`persistentLocalCache` /
  `enableIndexedDbPersistence`). This keeps the app usable — showing cached
  data, queueing writes — when the connection drops, preserving the
  offline-friendly feel of the original app while being online-first.

### Repo visibility note

GitHub Pages on a free account only serves **public** repos. That's fine
here: the Firebase web config that ends up in your public code (`apiKey`,
`projectId`, etc.) is an identifier, not a secret — it's meant to be visible
in client-side apps. What actually protects the data is the Firestore
security rules below, not hiding the code. The leads themselves live in
Firestore, not in the git repo, so a public repo does not expose customer
data.

## Data schema

```
leads/{leadId}
  leadName: string
  contactNumber: string
  emailId: string
  inquiryDate: string (YYYY-MM-DD)
  source: string
  product: string
  status: string
  followupDate: string (YYYY-MM-DD)
  notes: string
  sno: string
  createdAt: timestamp
  updatedAt: timestamp

savedQueries/{queryId}
  name: string
  match: "all" | "any"              // AND vs OR across conditions
  conditions: [
    { field: string, operator: string, value: string }
  ]
  sortBy: { field: string, direction: "asc"|"desc" } | null
  createdBy: string (uid)
  createdAt: timestamp
```

## Feature: Custom Query Management

Add a "Queries" control near the existing filter bar (keep the search box
and four dropdowns — see the interaction rule below).

**Query builder UI**
- "New Query" opens a builder: add one or more condition rows —
  `Field → Operator (depends on field type) → Value`.
- A top-level toggle: Match **All** (AND) / Match **Any** (OR).
- Live count of matching leads as conditions are edited.
- Buttons: **Save** (prompts for a name), **Apply** (use without saving),
  **Cancel**.

**Operators by field type**
- Categorical fields (`source, product, status`): contains, equals, is one
  of *(multi-select)*, is empty, is not empty.
- Free-text fields (`leadName, contactNumber, emailId, notes`): contains,
  does not contain, equals, is empty, is not empty.
- Date fields (`inquiryDate, followupDate`): before, after, on, between, in
  the last N days, is empty. *(Note: Firestore can't express "last N days"
  directly — compute the concrete cutoff date in JavaScript first, then
  compare against it client-side.)*

**Saved queries list**
- Show saved queries as clickable chips (or a dropdown), each with a live
  match-count badge and edit / duplicate / delete actions.
- Clicking one applies it immediately. A visible "Clear query" control
  returns to the default view.

**Interaction rule with existing filters**: when a saved/custom query is
active, hide or disable the four legacy dropdowns to avoid double-filtering
confusion, and show the active query's name plus Clear instead. The
free-text search box stays active always and further narrows whatever is
currently shown.

**Storage**: persist saved queries to the `savedQueries` collection so they
sync across every device/team member.

## Authentication

- Add a simple email/password sign-in screen using Firebase Auth. Nothing
  in the app renders until the user is signed in.
- Do **not** build a public sign-up page. For a small team, the safe,
  zero-admin approach is adding users by hand in the Firebase Console
  (Authentication → Users → Add user). Say this in the README you write.

## Firestore security rules

Ship this — it's the real protection for the data, since the code and
config are public:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /leads/{leadId} {
      allow read, write: if request.auth != null;
    }
    match /savedQueries/{queryId} {
      allow read, write: if request.auth != null;
    }
  }
}
```

Optional extra hardening to mention in the README (don't block on it):
restrict the Firebase Web API key to the GitHub Pages domain under Google
Cloud Console → APIs & Services → Credentials.

## Build steps

1. Read `index.html` fully; reuse existing element IDs, function names, and
   CSS variables wherever reasonable, to keep the diff focused.
2. Decide single-file vs. split-into-modules; note the choice in a comment
   at the top of `index.html`.
3. Add the Firebase modular SDK via CDN `<script type="module">` imports
   (app, auth, firestore).
4. Create a clearly-marked config section with placeholder values and a
   comment pointing to exactly where to paste the real values (Firebase
   Console → Project Settings → Your apps → SDK setup and configuration).
5. Build the sign-in screen and auth-gate the app.
6. Replace `loadDB` / `saveDB` / `queueSave` / the localStorage fallback with
   the Firestore `onSnapshot` listener and `setDoc` / `updateDoc` /
   `deleteDoc` writes.
7. Add the "Import legacy JSON" button described above.
8. Build Custom Query Management exactly as specified above.
9. Update the manifest/service worker only if needed so the app stays
   installable as a PWA.
10. Write a short `README.md` covering: Firebase project setup, where to
    paste config, the security rules to paste in, how to add users, how to
    enable GitHub Pages, and the free-tier limits to stay under.
11. Test locally before deploying: ES module imports need the page served
    over `http://`, not opened as a `file://` path — use e.g. `npx serve` or
    `python3 -m http.server` in the project folder while testing.

## Manual steps only the project owner can do

List these back before writing code — they need a human clicking through
web consoles, not something an agent can script:

1. Create a free Firebase project at console.firebase.google.com — stay on
   the **Spark** (free) plan, no credit card needed.
2. Enable **Firestore Database** (production mode, nearest region) and
   **Authentication → Email/Password**.
3. Add at least one user under Authentication → Users.
4. Copy the web app config snippet from Project Settings and paste it where
   the code indicates.
5. Push the repo to GitHub as a **public** repository, then enable Pages
   under Settings → Pages → Deploy from a branch.

## Acceptance checklist

- [ ] The same leads appear, live, on two different browsers/devices once
      both are signed in.
- [ ] Reloading, or opening a new incognito window (after signing in), still
      shows the data — no longer localStorage-dependent.
- [ ] Search, the four legacy filters, pagination, add/edit/delete, CSV
      export, and JSON download all still work.
- [ ] A saved query can be created, applied, edited, duplicated, and
      deleted, and survives logout/login and a different device.
- [ ] Signed-out reads/writes to Firestore are rejected (check via the
      Firebase Console's Rules Playground, or by inspecting network calls
      while logged out).
- [ ] Nothing in the app relies on a paid Firebase feature; the project
      stays on Spark.
