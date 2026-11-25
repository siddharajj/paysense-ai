-- PaySense Property & Suburb Intelligence — Cloudflare D1 (SQLite) Schema
-- Supports millions of NSW Valuer General / DataVic / UK Land Registry / HDB records on Cloudflare's $0 Free Tier (5 GB).

CREATE TABLE IF NOT EXISTS suburb_profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  country TEXT NOT NULL,
  state TEXT NOT NULL,
  postcode TEXT NOT NULL,
  suburb TEXT NOT NULL,
  city TEXT NOT NULL,
  lat REAL,
  lon REAL,
  house_median INTEGER,
  house_rent_wk INTEGER,
  unit_median INTEGER,
  unit_rent_wk INTEGER,
  growth_5yr_pct REAL,
  growth_10yr_pct REAL,
  median_household_income INTEGER,
  owner_occupier_pct REAL,
  vacancy_pct REAL,
  zoning TEXT,
  highlights TEXT,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(country, postcode, suburb)
);

CREATE INDEX IF NOT EXISTS idx_suburb_lookup ON suburb_profiles(country, postcode);
CREATE INDEX IF NOT EXISTS idx_suburb_name ON suburb_profiles(country, suburb);

CREATE TABLE IF NOT EXISTS sales_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  country TEXT NOT NULL,
  state TEXT,
  postcode TEXT NOT NULL,
  suburb TEXT,
  normalized_address TEXT NOT NULL,
  display_address TEXT NOT NULL,
  property_type TEXT,
  bedrooms INTEGER,
  land_sqm REAL,
  floor_sqm REAL,
  build_year INTEGER,
  sold_date TEXT NOT NULL,
  sold_price INTEGER NOT NULL,
  source TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sales_addr ON sales_history(country, normalized_address);
CREATE INDEX IF NOT EXISTS idx_sales_postcode ON sales_history(country, postcode, sold_date DESC);

CREATE TABLE IF NOT EXISTS enrichment_cache (
  cache_key TEXT PRIMARY KEY,
  payload_json TEXT NOT NULL,
  cached_at INTEGER NOT NULL
);
