/**
 * PaySense — Edge Property & Suburb Intelligence API (Cloudflare Worker + D1 SQLite)
 * ----------------------------------------------------------------------------------
 * Runs on Cloudflare's $0 Free Tier (100,000 req/day + 5 GB D1 SQLite).
 * Blends D1 historical sales (NSW Valuer General PSI, UK Land Registry, etc.)
 * with optional secret provider keys (Domain, GOV.UK EPC, RentCast) and caches results.
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json; charset=utf-8',
};

const CACHE_TTL_SECONDS = 7 * 24 * 3600; // 7 days

function normalizeAddr(str) {
  return String(str || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\b(street|st)\b/g, 'st')
    .replace(/\b(road|rd)\b/g, 'rd')
    .replace(/\b(avenue|ave)\b/g, 'ave')
    .replace(/\b(drive|dr)\b/g, 'dr')
    .replace(/\s+/g, ' ')
    .trim();
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    try {
      if (url.pathname === '/api/health') {
        const countRow = env.DB
          ? await env.DB.prepare('SELECT COUNT(*) AS cnt FROM sales_history').first()
          : { cnt: 0 };
        return jsonResponse({ ok: true, d1Connected: Boolean(env.DB), salesCount: countRow?.cnt || 0 });
      }

      if (url.pathname === '/api/suburbs') {
        const country = (url.searchParams.get('country') || 'AU').toUpperCase();
        if (!env.DB) return jsonResponse({ areas: [] });
        const { results } = await env.DB.prepare(
          'SELECT * FROM suburb_profiles WHERE country = ? ORDER BY house_median DESC LIMIT 200'
        )
          .bind(country)
          .all();
        return jsonResponse({ country, areas: results || [] });
      }

      if (url.pathname === '/api/property') {
        const address = (url.searchParams.get('address') || '').trim();
        const country = (url.searchParams.get('country') || 'AU').toUpperCase();
        const type = url.searchParams.get('type') || 'unit';
        const beds = Number(url.searchParams.get('beds') || 2);

        if (!address) {
          return jsonResponse({ error: 'Missing address parameter' }, 400);
        }

        const norm = normalizeAddr(address);
        const cacheKey = `${country}:${type}:${beds}:${norm}`;
        const nowSec = Math.floor(Date.now() / 1000);

        // 1. Check D1 enrichment cache
        if (env.DB) {
          const cached = await env.DB.prepare(
            'SELECT payload_json, cached_at FROM enrichment_cache WHERE cache_key = ?'
          )
            .bind(cacheKey)
            .first();
          if (cached && nowSec - cached.cached_at < CACHE_TTL_SECONDS) {
            return new Response(cached.payload_json, { status: 200, headers: CORS_HEADERS });
          }
        }

        // 2. Query D1 historical sales matching street/address or postcode
        let salesHistory = [];
        if (env.DB) {
          const postcodeMatch = address.match(/\b(\d{4,6}|[A-Z]{1,2}\d[A-Z\d]?)\b/i);
          const pc = postcodeMatch ? postcodeMatch[1].toUpperCase() : '';

          const exactRows = await env.DB.prepare(
            'SELECT display_address AS address, property_type AS type, sold_date AS soldDate, sold_price AS soldPrice, build_year AS buildYear, floor_sqm AS floorSqm FROM sales_history WHERE country = ? AND normalized_address LIKE ? ORDER BY sold_date DESC LIMIT 5'
          )
            .bind(country, `%${norm.slice(0, 24)}%`)
            .all();

          salesHistory = exactRows?.results || [];

          if (!salesHistory.length && pc) {
            const pcRows = await env.DB.prepare(
              'SELECT display_address AS address, property_type AS type, sold_date AS soldDate, sold_price AS soldPrice FROM sales_history WHERE country = ? AND postcode = ? ORDER BY sold_date DESC LIMIT 5'
            )
              .bind(country, pc)
              .all();
            salesHistory = pcRows?.results || [];
          }
        }

        // 3. Optional external API enrichment (keys stay 100% private in Cloudflare Worker Secrets!)
        let externalEstimate = null;
        if (country === 'US' && env.RENTCAST_API_KEY) {
          externalEstimate = await fetchRentCastEstimate(address, env.RENTCAST_API_KEY);
        } else if (country === 'UK' && env.UK_EPC_TOKEN) {
          externalEstimate = await fetchUkEpcMetadata(address, env.UK_EPC_TOKEN);
        }

        const payload = {
          address,
          country,
          estimatedValue: externalEstimate?.estimatedValue || null,
          estimatedWeeklyRent: externalEstimate?.estimatedWeeklyRent || null,
          floorSqm: externalEstimate?.floorSqm || null,
          buildYear: externalEstimate?.buildYear || null,
          salesHistory,
          enrichedAt: new Date().toISOString(),
        };

        const serialized = JSON.stringify(payload);
        if (env.DB) {
          await env.DB.prepare(
            'INSERT OR REPLACE INTO enrichment_cache (cache_key, payload_json, cached_at) VALUES (?, ?, ?)'
          )
            .bind(cacheKey, serialized, nowSec)
            .run();
        }

        return new Response(serialized, { status: 200, headers: CORS_HEADERS });
      }

      return jsonResponse({ error: 'Not found' }, 404);
    } catch (err) {
      return jsonResponse({ error: err.message || 'Internal Worker Error' }, 500);
    }
  },
};

async function fetchRentCastEstimate(address, apiKey) {
  try {
    const res = await fetch(
      `https://api.rentcast.io/v1/avm/value?address=${encodeURIComponent(address)}`,
      { headers: { 'X-Api-Key': apiKey, Accept: 'application/json' } }
    );
    if (!res.ok) return null;
    const data = await res.json();
    return {
      estimatedValue: data.price ? Math.round(data.price) : null,
      buildYear: data.subjectProperty?.yearBuilt || null,
    };
  } catch {
    return null;
  }
}

async function fetchUkEpcMetadata(address, basicAuthToken) {
  try {
    const res = await fetch(
      `https://epc.opendatacommunities.org/api/v1/domestic/search?address=${encodeURIComponent(address)}&size=1`,
      { headers: { Authorization: `Basic ${basicAuthToken}`, Accept: 'application/json' } }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const row = data?.rows?.[0];
    if (!row) return null;
    return {
      floorSqm: Number(row['total-floor-area']) || null,
      epcRating: row['current-energy-rating'] || null,
    };
  } catch {
    return null;
  }
}

function jsonResponse(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: CORS_HEADERS });
}
