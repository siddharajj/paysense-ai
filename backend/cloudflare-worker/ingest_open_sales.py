#!/usr/bin/env python3
"""
PaySense — Open Property Registry ETL Ingestion Script for Cloudflare D1
------------------------------------------------------------------------
Zero external dependencies (Python 3 standard library).

Modes:
  1. Generate SQL seed from our bundled data/areas/*.json shards:
       python3 ingest_open_sales.py --seed-shards > seed_shards.sql

  2. Convert NSW Valuer General PSI CSV / HM Land Registry Price Paid CSV
     into batched SQLite INSERT statements for Cloudflare D1:
       python3 ingest_open_sales.py --uk-ppd pp-2025.csv > uk_sales.sql
       python3 ingest_open_sales.py --nsw-csv nsw_sales.csv > nsw_sales.sql
"""

import argparse
import csv
import glob
import json
import os
import re


def sql_str(val):
    if val is None:
        return "NULL"
    return "'" + str(val).replace("'", "''") + "'"


def normalize_addr(s):
    s = re.sub(r"[^a-z0-9\s]", " ", (s or "").lower())
    s = re.sub(r"\b(street|st)\b", "st", s)
    s = re.sub(r"\b(road|rd)\b", "rd", s)
    s = re.sub(r"\b(avenue|ave)\b", "ave", s)
    return re.sub(r"\s+", " ", s).strip()


def seed_from_shards(shards_dir):
    out = []
    for path in sorted(glob.glob(os.path.join(shards_dir, "*.json"))):
        with open(path, "r", encoding="utf-8") as f:
            doc = json.load(f)
        country = doc["country"]
        for a in doc.get("areas", []):
            out.append(
                f"INSERT OR REPLACE INTO suburb_profiles "
                f"(country, state, postcode, suburb, city, lat, lon, house_median, house_rent_wk, unit_median, unit_rent_wk, "
                f"growth_5yr_pct, growth_10yr_pct, median_household_income, owner_occupier_pct, vacancy_pct, zoning, highlights) VALUES ("
                f"{sql_str(country)}, {sql_str(a['state'])}, {sql_str(a['postcode'])}, {sql_str(a['suburb'])}, {sql_str(a['city'])}, "
                f"{a['lat']}, {a['lon']}, {a['houseMedian']}, {a['houseRentWk']}, {a['unitMedian']}, {a['unitRentWk']}, "
                f"{a['growth5yrPct']}, {a['growth10yrPct']}, {a['medianHouseholdIncome']}, {a['ownerOccupierPct']}, {a['vacancyPct']}, "
                f"{sql_str(a.get('zoning'))}, {sql_str(a.get('highlights'))});"
            )
            for s in a.get("sampleSales", []):
                norm = normalize_addr(s["address"])
                out.append(
                    f"INSERT INTO sales_history (country, state, postcode, suburb, normalized_address, display_address, property_type, sold_date, sold_price, source) VALUES ("
                    f"{sql_str(country)}, {sql_str(a['state'])}, {sql_str(a['postcode'])}, {sql_str(a['suburb'])}, "
                    f"{sql_str(norm)}, {sql_str(s['address'])}, {sql_str(s.get('type'))}, {sql_str(s['soldDate'])}, {int(s['soldPrice'])}, 'Open Registry Seed');"
                )
    return "\n".join(out)


def convert_uk_ppd(csv_path, limit=50000):
    """Parse standard HM Land Registry Price Paid CSV (no header)."""
    out = []
    with open(csv_path, "r", encoding="utf-8", errors="replace") as f:
        reader = csv.reader(f)
        for i, row in enumerate(reader):
            if i >= limit or len(row) < 14:
                break
            price = int(row[1] or 0)
            date_str = (row[2] or "")[:10]
            postcode = row[3]
            prop_type = {"D": "House (Detached)", "S": "House (Semi)", "T": "Terrace", "F": "Flat / Unit"}.get(row[4], "Residential")
            paon, saon, street, town, county = row[7], row[8], row[9], row[11], row[13]
            disp = ", ".join(filter(None, [" ".join(filter(None, [saon, paon, street])), town, postcode]))
            norm = normalize_addr(disp)
            if price > 0 and postcode:
                out.append(
                    f"INSERT INTO sales_history (country, state, postcode, suburb, normalized_address, display_address, property_type, sold_date, sold_price, source) VALUES ("
                    f"'UK', {sql_str(county)}, {sql_str(postcode)}, {sql_str(town)}, {sql_str(norm)}, {sql_str(disp)}, {sql_str(prop_type)}, {sql_str(date_str)}, {price}, 'HM Land Registry PPD');"
                )
    return "\n".join(out)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--seed-shards", action="store_true", help="Emit D1 SQL from ../../data/areas/*.json")
    parser.add_argument("--uk-ppd", help="Path to HM Land Registry Price Paid CSV")
    args = parser.parse_args()

    if args.seed_shards:
        shards_dir = os.path.join(os.path.dirname(__file__), "..", "..", "data", "areas")
        print(seed_from_shards(shards_dir))
    elif args.uk_ppd:
        print(convert_uk_ppd(args.uk_ppd))
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
