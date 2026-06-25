# SCE Tender Builder

An internal tool that generates tender/proposal Word documents (`.docx`) from a
guided multi-step form, pulling boilerplate content (policies, capability
statement text, warranty data, testimonials, etc.) live from the
**📚 Smart Tender Content Library** Notion database.

- `public/index.html` — the entire frontend: the multi-step form UI and the
  client-side logic that assembles the final `.docx` using the `docx` library.
- `api/library.js` — a small serverless function that queries Notion
  server-side and returns the content library as JSON. This exists so the
  Notion secret token never has to live in browser-visible code.

## How it fits together

```
Browser (public/index.html)
   │  fetch('/api/library')
   ▼
Vercel serverless function (api/library.js)
   │  Notion API (using NOTION_TOKEN, kept server-side only)
   ▼
📚 Smart Tender Content Library (Notion database)
```

Nothing else changed from the original tool — the form fields, the document
layout, and the `.docx` generation logic in `index.html` are untouched. Only
how the content library is fetched changed (was: JSONBin public URL, now: our
own API endpoint backed by Notion).

## One-time setup

### 1. Create a Notion integration token

This is the credential that lets the deployed tool read your Notion content
library. Anthropic/Claude should never see or handle this value — you create
and store it yourself.

1. Go to https://www.notion.so/my-integrations
2. Click **+ New integration**
3. Name it something like `SCE Tender Builder`, pick the right workspace, and
   give it **Read content** capability only (it doesn't need to write anything)
4. Click **Submit** — you'll get a token starting with `secret_` or `ntn_`.
   Copy it somewhere safe for now (e.g. a password manager). You'll paste it
   into Vercel in step 4, not into any file in this repo.
5. Open the **📚 Smart Tender Content Library** database in Notion, click the
   `•••` menu in the top right → **Connections** → connect your new
   `SCE Tender Builder` integration. Without this step the integration can
   authenticate but won't be able to see the database — Notion requires both.

### 2. Push this project to GitHub

```bash
cd sce-tender-builder
git add -A
git commit -m "Initial commit: SCE Tender Builder"
```

Then create a new repository on GitHub (an empty one, no README/license, so
there's nothing to conflict with what you already have):

1. Go to https://github.com/new
2. Pick a name, e.g. `sce-tender-builder`. Visibility can be **Private** —
   nothing about deploying to Vercel requires a public repo.
3. Don't initialize with a README, .gitignore, or license (we already have
   those).
4. After creating it, GitHub shows you the remote URL. Run:

```bash
git remote add origin https://github.com/<your-username>/sce-tender-builder.git
git branch -M main
git push -u origin main
```

### 3. Connect the repo to Vercel

1. Go to https://vercel.com and sign in (you can sign in directly with your
   GitHub account, which makes the next step automatic).
2. Click **Add New… → Project**.
3. Select the `sce-tender-builder` GitHub repo and click **Import**.
4. Leave the framework preset as **Other** — there's no build step needed,
   Vercel will serve `public/` as static files and `api/library.js` as a
   serverless function automatically.

### 4. Add the Notion token as an environment variable

Still in the Vercel project setup (or afterwards under
**Settings → Environment Variables**):

| Name | Value |
|---|---|
| `NOTION_TOKEN` | the `secret_...` / `ntn_...` token from step 1 |

Leave `NOTION_DATA_SOURCE_ID` unset unless you ever move the content library
to a different Notion database — the correct ID is already wired in as a
fallback default.

Click **Deploy**. Vercel will build and give you a live URL like
`https://sce-tender-builder.vercel.app`. That's the link to share with your
team.

## After the first deploy

Any time you (or I) push a new commit to `main` on GitHub, Vercel
automatically redeploys — there's no manual republish step.

## Local development (optional)

Only needed if you want to test changes on your own machine before pushing.

```bash
npm install -g vercel
cp .env.example .env
# edit .env and paste your real NOTION_TOKEN
vercel dev
```

This serves the app at `http://localhost:3000` with both the frontend and the
`/api/library` function running locally.

## Content library conventions (for whoever maintains the Notion database)

The `/api/library` function expects rows in the **📚 Smart Tender Content
Library** database to follow a few conventions already in use:

- **Status**: rows marked `Retired` or `Under Review` are excluded from the
  live tool automatically — only `Current` (and unset) content is served.
- **Block Type = Content**: general boilerplate text. Multiple paragraphs are
  separated with a blank line — in Notion's `Content` text field, type two
  consecutive `<br>` (or just press enter twice if your field renders that
  way) between paragraphs.
- **Block Type = Link / Linked Graphic**: should contain a Markdown-style
  link in the form `[Label](https://...)`. Until a real URL is added,
  leave placeholder text like `Paste SharePoint datasheet URL here` — the
  tool automatically detects and skips these so unfinished links never reach
  a real tender document.
- **Block Name starting with "Warranty Data —"**: parsed specially. The
  `Content` field should contain lines like:
  ```
  Supplier: Sungrow
  Equipment: SG5RT
  Product Warranty: 10 years
  Performance Warranty: —
  ```
- **Block Name starting with "Testimonial"**: should include the referee's
  full name somewhere in the block name (e.g. `Testimonial — Daniel Bryant,
  ProTen`), since the form matches testimonials by name.

## Security note

The deployed link is accessible to anyone who has it, with no login. The
`/api/library` endpoint only ever returns content that's already meant to go
into tender documents (policies, capability statements, warranty tables,
etc.) — never the Notion token itself, and never any other content from your
wider Notion workspace. Still, don't put anything in this specific content
library (pricing, margins, internal-only notes) that you wouldn't want a
stranger with the link to read.
