# Lead Tracker — Firebase Edition

A shared, real-time lead tracking PWA. Data syncs instantly across every signed-in device via **Firebase Firestore**. Hosted on **GitHub Pages** at zero cost.

## Firebase Project Setup (one-time)

1. Go to [console.firebase.google.com](https://console.firebase.google.com) and open project **query-mangement** (or create a new one on the **Spark** free plan — no credit card needed).
2. **Firestore Database** → Create database → **Production mode** → choose a region.
3. **Authentication** → Sign-in method → Enable **Email/Password**.
4. **Authentication** → Users → **Add user** for each team member (no self-sign-up).
5. **Firestore Database** → Rules → paste the contents of `firestore.rules`:
   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /{document=**} {
         allow read, write: if request.auth != null;
       }
     }
   }
   ```

## Firebase Config

The Firebase web config is already in `firebase-config.js`. If you created a new project, paste your SDK snippet there.

## Adding Users

Do **not** build a self-sign-up page. Add users manually:
1. Firebase Console → Authentication → Users → **Add user**
2. Enter email + password for each team member

## GitHub Pages Deployment

1. Push this repo to GitHub as a **public** repository.
2. Go to **Settings → Pages** → Deploy from a branch → select `main` / root.
3. Your app will be live at `https://<username>.github.io/<repo>/` in about 1–2 minutes.

### (Optional) Restrict the API Key

In Google Cloud Console → APIs & Services → Credentials, edit the Web API key and add your GitHub Pages domain under **HTTP referrers** to prevent others from using your key on other domains.

## Free-Tier Limits

- **Firestore**: 1 GiB stored, 10 GiB downloads/day, 50K reads/day, 20K writes/day.
- **Auth**: 50K monthly active users (Email/Password only).
- **GitHub Pages**: 1 GB storage, 100 GB bandwidth/month.

At small-business data volumes (hundreds to a few thousand leads) these limits are more than enough.

## Local Development

ES module imports require the page to be served over `http://`. Open a terminal in this folder and run:

```bash
npx serve .
# or
python3 -m http.server 8080
```

Then open `http://localhost:8080` in your browser.

## Features

- Firebase Auth (email/password) — app is gated behind sign-in
- Real-time Firestore sync across all devices
- Offline persistence — app works when connection drops
- Dashboard cards (Total, Open, Overdue, Converted, Due Today)
- Search + 4 legacy dropdown filters (Status, Product, Source, Follow-up)
- Custom Query Management — build, save, apply, edit, duplicate, delete advanced filters
- Add / Edit / Delete leads via modal
- CSV export
- JSON backup download
- Import legacy `leadtracker_db.json` (dedup by ID)
- PWA — installable, works offline with cached assets
- Responsive layout

## Migration from the Old App

1. Export your data from the old app using the **Download DB** button — this saves `leadtracker_db.json`.
2. Sign in to the new app.
3. Click **Import JSON** and select the downloaded file.
4. Leads are bulk-loaded into Firestore; duplicates (matching `id`) are skipped.

## Out of Scope

- Role-based permissions
- Public sign-up page
- Phone/SMS auth
- Payments / billing
- Native mobile app
