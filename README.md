# ⚡ PaySense AI — Multi-Country & Contractor Pay Calculator

An **AI-first**, privacy-first, **$0-to-host** salary and contractor pay calculator built with zero build dependencies so you can deploy it straight to **GitHub Pages** for free forever.

## Highlights

- **Form-First UI + Natural Language Command Bar (`⌘K`)** — Use the tactile country-aware form *or* just type plain English:
  - `"AU contractor $950/day, 220 days, incl super, compare with $165k FTE"`
  - `"US $150k salary in California, married, 6% 401k"`
  - `"UK £600/day contractor outside IR35, 220 days, 10% pension"`
  - `"India 36L freelancer under 44ADA vs 32L salary"`
  - `"How much do I need to earn in Australia to take home $10,000/month?"`
  - Incremental follow-ups like `"drop to 200 days"`, `"add $8k expenses"`, or `"15% raise"`.
- **7 Global Tax Engines (2025/26 Rules)**:
  - 🇦🇺 **Australia** (FY 2025–26 Stage 3 brackets, 12% SG super, Medicare + MLS, FY25–26 marginal HECS-HELP, GST invoicing)
  - 🇺🇸 **United States** (2025 Federal, 17 states incl. CA/NY/NYC/TX/FL/WA, FICA & 1099 SE Tax, 401(k)/Solo 401(k), 20% QBI)
  - 🇬🇧 **United Kingdom** (England/Wales/NI + Scotland, £100k PA taper trap, Class 1/4 NI, Student Loans, Sole Trader / Inside & Outside IR35 Ltd Co)
  - 🇨🇦 **Canada** (Federal + ON/BC/AB/QC/MB/NS, CPP & CPP2 incl. 2× self-employed, EI, RRSP, GST/HST)
  - 🇮🇳 **India** (FY 2025–26 Budget New Regime with ₹12L Sec 87A rebate, Old Regime, Contractor Section 44ADA 50% presumptive tax, Export LUT / 18% GST)
  - 🇳🇿 **New Zealand** (2025/26 PAYE, ACC Levy, KiwiSaver, Student Loan, 15% GST)
  - 🇸🇬 **Singapore** (YA 2026 IRAS brackets, Citizen/PR CPF vs Expat EP, SRS relief)
- **Contractor vs Full-Time (FTE) Reality Check** — Automatically solves the equivalent FTE salary (or equivalent contractor day rate) factoring in unpaid leave, public holidays, retirement/super, and self-employment taxes, plus a **Monthly Tax Vault** set-aside rule.
- **Role & Market Intelligence Explorer (`roles.html`)** — Dedicated second page backed by open government benchmarks (**Jobs and Skills Australia (JSA)**, **US BLS OEWS/Projections**, **UK ONS ASHE**, and **O\*NET Pathways**) across 24 roles × 7 countries:
  - Workforce headcount & annual openings
  - Full-time salary bands (25th/Median/75th) & contractor day-rate ranges with real localized after-tax take-home
  - Dual 5-year growth (financial wage growth + headcount/job growth)
  - Competition & shortage fill-rate meter + root market drivers
  - Interactive career growth pathways showing exact after-tax net gains + 1-click **"Load in Pay Calculator"** deep links
  - Optional weekly **\$0 GitHub Actions data refresh** (`scripts/sync_open_data.py` + `.github/workflows/sync-data.yml`): add free `ADZUNA_APP_ID` and `ADZUNA_APP_KEY` repo secrets (`developer.adzuna.com`) to refresh live vacancies and salary pulses automatically without exposing keys in the browser.
- **100% Free ($0) Architecture**:
  - Works offline out of the box with a fast built-in client-side natural language parser & smart advisor.
  - Optional **BYOK Free Tier AI** modal (supports Google Gemini API Free Tier or Groq/OpenAI-compatible endpoints — API key stays strictly in your browser `localStorage`).
  - Zero backend, zero database: share scenarios via URL hash (`#s=...`), pin up to 4 multi-country comparisons in `localStorage`, and export to CSV.

## Local Preview

Because the app uses standard ES Modules, serve it with any lightweight static server (no `npm install` required):

```bash
python3 -m http.server 8080
```

Then open `http://localhost:8080`.

## Deploy Free ($0) to GitHub Pages

1. Create a new public repository on GitHub (e.g. `paysense-ai`).
2. Push this folder:
   ```bash
   git init
   git add .
   git commit -m "Initial commit: PaySense AI"
   git branch -M main
   git remote add origin https://github.com/<your-username>/paysense-ai.git
   git push -u origin main
   ```
3. In your GitHub repo, go to **Settings → Pages → Build and deployment → Source** and choose **GitHub Actions** (the included `.github/workflows/pages.yml` deploys automatically on every push to `main`).

## Run Automated Tests

Works with macOS built-in JavaScriptCore (`jsc`):

```bash
/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc -m tests/run-tests.js
```
