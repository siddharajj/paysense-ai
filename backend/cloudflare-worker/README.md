# PaySense Edge Property Database (Cloudflare Worker + D1 SQLite — $0 Free Tier)

PaySense's `property.html` works **immediately out of the box on GitHub Pages** using the sharded suburb datasets (`data/areas/*.json`) plus live browser queries to OpenStreetMap Photon, Overpass (1km transit/schools/parks), and Singapore's `data.gov.sg` HDB API.

When you want to store **millions of historical street-level sales** (such as **NSW Valuer General PSI** or **UK HM Land Registry Price Paid Data**) or attach private developer API keys (`RENTCAST_API_KEY`, `UK_EPC_TOKEN`), deploy this folder to **Cloudflare Workers + D1** on the **$0 Free Tier** (100,000 requests/day + 5 GB SQLite storage).

## Quick Deploy (4 Commands)

```bash
cd backend/cloudflare-worker

# 1. Create your free 5 GB D1 database (paste the returned database_id into wrangler.toml)
npx wrangler d1 create paysense-property-db

# 2. Apply schema & seed initial suburb + sales records
npx wrangler d1 execute paysense-property-db --remote --file=schema.sql
python3 ingest_open_sales.py --seed-shards > seed.sql
npx wrangler d1 execute paysense-property-db --remote --file=seed.sql

# 3. (Optional) Add free-tier external provider secrets
# npx wrangler secret put UK_EPC_TOKEN
# npx wrangler secret put RENTCAST_API_KEY

# 4. Deploy your Worker
npx wrangler deploy
```

Then open **Rental Property** (`property.html`) → click **`⚙️ Building Cost, Growth & DB Settings`** → paste your `https://paysense-property-api.<your-subdomain>.workers.dev` URL!
