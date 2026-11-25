/**
 * PaySense — Blended Property Address, Live Geo-Enrichment & Suburb Matchmaker Client
 * -----------------------------------------------------------------------------------
 * Hybrid Architecture:
 *   1. Loads sharded open suburb/postcode profiles from ./data/areas/{COUNTRY}.json
 *   2. Optionally queries user's Cloudflare Worker + D1 backend if configured
 *   3. Queries live CORS-friendly public APIs in parallel (with fast timeouts & graceful fallback):
 *      - Photon (OpenStreetMap) for real street-address autocomplete & lat/lon geocoding
 *      - OpenStreetMap Overpass API for live 1km radius transit, schools, supermarkets & parks
 *      - Singapore data.gov.sg HDB Resale API for live street/town resale transactions
 */

const shardCache = new Map();
const BACKEND_URL_KEY = 'paysense_property_worker_url_v1';

const COUNTRY_BBOX_CENTER = {
  AU: { lat: -33.8688, lon: 151.2093, iso: 'au', name: 'Australia' },
  UK: { lat: 51.5072, lon: -0.1276, iso: 'gb', name: 'United Kingdom' },
  US: { lat: 37.0902, lon: -95.7129, iso: 'us', name: 'United States' },
  SG: { lat: 1.3521, lon: 103.8198, iso: 'sg', name: 'Singapore' },
  NZ: { lat: -36.8485, lon: 174.7633, iso: 'nz', name: 'New Zealand' },
  CA: { lat: 43.6532, lon: -79.3832, iso: 'ca', name: 'Canada' },
  IN: { lat: 12.9716, lon: 77.5946, iso: 'in', name: 'India' },
};

export function getBackendWorkerUrl() {
  try {
    return (localStorage.getItem(BACKEND_URL_KEY) || '').trim();
  } catch {
    return '';
  }
}

export function setBackendWorkerUrl(url) {
  try {
    localStorage.setItem(BACKEND_URL_KEY, (url || '').trim().replace(/\/$/, ''));
  } catch {
    // ignore
  }
}

export async function loadAreaShard(countryCode = 'AU') {
  const code = COUNTRY_BBOX_CENTER[countryCode] ? countryCode : 'AU';
  if (shardCache.has(code)) return shardCache.get(code);

  const res = await fetch(`./data/areas/${code}.json`);
  if (!res.ok) throw new Error(`Failed to load area shard for ${code}`);
  const data = await res.json();
  shardCache.set(code, data);
  return data;
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 4200) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(id);
  }
}

/**
 * Live street-address & suburb autocomplete combining local benchmark addresses
 * with OpenStreetMap Photon geocoder.
 */
export async function autocompleteAddress(query, countryCode = 'AU') {
  const q = (query || '').trim();
  if (q.length < 2) return [];

  const shard = await loadAreaShard(countryCode);
  const ql = q.toLowerCase();

  // 1. Instant local suburb & sample sale matches
  const localMatches = [];
  for (const area of shard.areas || []) {
    for (const sale of area.sampleSales || []) {
      if (sale.address.toLowerCase().includes(ql)) {
        localMatches.push({
          label: sale.address,
          suburb: area.suburb,
          state: area.state,
          postcode: area.postcode,
          lat: area.lat,
          lon: area.lon,
          source: 'Verified Sale Record',
        });
      }
    }
    const areaStr = `${area.suburb} ${area.state} ${area.postcode} ${area.city}`.toLowerCase();
    if (areaStr.includes(ql)) {
      localMatches.push({
        label: `12 Main St, ${area.suburb} ${area.state} ${area.postcode}`,
        suburb: area.suburb,
        state: area.state,
        postcode: area.postcode,
        lat: area.lat,
        lon: area.lon,
        source: `${area.city} Suburb Benchmark`,
      });
    }
  }

  // 2. Live Photon (OpenStreetMap) street-level autocomplete
  const bias = COUNTRY_BBOX_CENTER[countryCode] || COUNTRY_BBOX_CENTER.AU;
  try {
    const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(`${q} ${bias.name}`)}&lat=${bias.lat}&lon=${bias.lon}&limit=5&lang=en`;
    const res = await fetchWithTimeout(url, {}, 2800);
    if (res.ok) {
      const geo = await res.json();
      for (const feat of geo.features || []) {
        const p = feat.properties || {};
        const coords = feat.geometry?.coordinates || [];
        const cc = (p.countrycode || '').toLowerCase();
        if (cc && cc !== bias.iso) continue;

        const parts = [
          [p.housenumber, p.street || p.name].filter(Boolean).join(' '),
          p.suburb || p.district || p.city || p.town,
          p.state,
          p.postcode,
        ].filter(Boolean);
        const label = parts.join(', ');
        if (label && !localMatches.some((m) => m.label.toLowerCase() === label.toLowerCase())) {
          localMatches.push({
            label,
            suburb: p.suburb || p.district || p.city || p.town || '',
            state: p.state || '',
            postcode: p.postcode || '',
            lat: coords[1],
            lon: coords[0],
            source: 'OpenStreetMap Geocode',
          });
        }
      }
    }
  } catch {
    // Offline or blocked — localMatches still work seamlessly!
  }

  return localMatches.slice(0, 6);
}

/**
 * Live 1km Infrastructure & Walkability scan around exact coordinates using OpenStreetMap Overpass API.
 */
async function scanLiveOsmAmenities(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const overpassQuery = `[out:json][timeout:4];(
    nwr["railway"~"station|tram_stop|subway_entrance"](around:1200,${lat},${lon});
    nwr["amenity"="school"](around:1200,${lat},${lon});
    nwr["shop"="supermarket"](around:1200,${lat},${lon});
    nwr["leisure"="park"](around:1000,${lat},${lon});
    nwr["amenity"~"cafe|hospital|clinic"](around:1000,${lat},${lon});
  );out tags;`;

  try {
    const res = await fetchWithTimeout(
      'https://overpass-api.de/api/interpreter',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
        body: `data=${encodeURIComponent(overpassQuery)}`,
      },
      4000
    );
    if (!res.ok) return null;
    const json = await res.json();
    let transit = 0;
    let schools = 0;
    let supermarkets = 0;
    let parks = 0;
    let lifestyle = 0;
    const namedHighlights = [];

    for (const el of json.elements || []) {
      const t = el.tags || {};
      if (t.railway) {
        transit++;
        if (t.name && namedHighlights.length < 3) namedHighlights.push(`${t.name} Station/Stop`);
      } else if (t.amenity === 'school') {
        schools++;
        if (t.name && namedHighlights.length < 4) namedHighlights.push(t.name);
      } else if (t.shop === 'supermarket') {
        supermarkets++;
      } else if (t.leisure === 'park') {
        parks++;
      } else {
        lifestyle++;
      }
    }

    return {
      isLive: true,
      transit,
      schools,
      supermarkets,
      parks,
      lifestyle,
      namedHighlights: [...new Set(namedHighlights)].slice(0, 4),
    };
  } catch {
    return null;
  }
}

/**
 * Live Singapore HDB Resale transactions lookup from data.gov.sg (no API key required!).
 */
async function fetchLiveSgHdbSales(townOrStreet) {
  if (!townOrStreet) return [];
  try {
    const q = encodeURIComponent(townOrStreet.split(',')[0].replace(/^\d+\s*/, '').trim());
    const url = `https://data.gov.sg/api/action/datastore_search?resource_id=f1765b54-a209-4718-8d38-a39237f502b3&q=${q}&limit=4`;
    const res = await fetchWithTimeout(url, {}, 3500);
    if (!res.ok) return [];
    const json = await res.json();
    const records = json?.result?.records || [];
    return records.map((r) => ({
      address: `Blk ${r.block} ${r.street_name} (${r.storey_range})`,
      type: `${r.flat_type} · ${r.floor_area_sqm}m² (Built ${r.lease_commence_date})`,
      soldDate: r.month,
      soldPrice: Number(r.resale_price) || 0,
    }));
  } catch {
    return [];
  }
}

/**
 * Match an address or coordinates to the closest Suburb/Area benchmark in our shard.
 */
function matchClosestArea(shard, { address = '', suburb = '', postcode = '', lat, lon }) {
  const areas = shard.areas || [];
  if (!areas.length) return null;

  const addrLower = `${address} ${suburb} ${postcode}`.toLowerCase();

  // 1. Exact postcode or suburb name match
  for (const a of areas) {
    if (postcode && a.postcode && a.postcode.toLowerCase() === String(postcode).toLowerCase()) {
      return { area: a, matchKind: 'Exact Postcode Match' };
    }
    const cleanSub = a.suburb.split('(')[0].trim().toLowerCase();
    if (cleanSub && addrLower.includes(cleanSub)) {
      return { area: a, matchKind: 'Suburb Match' };
    }
  }

  // 2. Nearest spatial neighbor by lat/lon
  if (Number.isFinite(lat) && Number.isFinite(lon)) {
    let best = areas[0];
    let bestKm = Infinity;
    for (const a of areas) {
      const km = haversineKm(lat, lon, a.lat, a.lon);
      if (km < bestKm) {
        bestKm = km;
        best = a;
      }
    }
    return {
      area: best,
      matchKind: bestKm < 12 ? `Nearby Area (${bestKm.toFixed(1)} km)` : `Nearest Metro Benchmark (${best.city})`,
    };
  }

  return { area: areas[0], matchKind: `${areas[0].city} Market Benchmark` };
}

/**
 * Main Blended Address Lookup & Multi-Source Enrichment!
 */
export async function enrichPropertyByAddress({
  address,
  country = 'AU',
  propertyType = 'unit', // 'house' | 'unit'
  bedrooms = 2,
  selectedCandidate = null,
}) {
  const shard = await loadAreaShard(country);

  // 0. Check if optional Cloudflare Worker + D1 backend is configured
  const workerUrl = getBackendWorkerUrl();
  let workerEnrichment = null;
  if (workerUrl) {
    try {
      const wRes = await fetchWithTimeout(
        `${workerUrl}/api/property?address=${encodeURIComponent(address)}&country=${country}&type=${propertyType}&beds=${bedrooms}`,
        {},
        4000
      );
      if (wRes.ok) {
        workerEnrichment = await wRes.json();
      }
    } catch {
      // Fall back cleanly to hybrid client enrichment
    }
  }

  // 1. Geocode if user typed raw text without picking a candidate
  let geo = selectedCandidate;
  if (!geo) {
    const candidates = await autocompleteAddress(address, country);
    geo = candidates[0] || null;
  }

  const lat = geo?.lat;
  const lon = geo?.lon;

  // 2. Match closest area profile
  const { area, matchKind } = matchClosestArea(shard, {
    address,
    suburb: geo?.suburb,
    postcode: geo?.postcode,
    lat: lat ?? undefined,
    lon: lon ?? undefined,
  });

  // 3. Run live OpenStreetMap Overpass 1km scan (+ live SG HDB API if Singapore) in parallel
  const [liveAmenities, sgLiveSales] = await Promise.all([
    scanLiveOsmAmenities(lat ?? area.lat, lon ?? area.lon),
    country === 'SG' ? fetchLiveSgHdbSales(geo?.suburb || area.suburb) : Promise.resolve([]),
  ]);

  // 4. Blend valuation, rent, land-vs-building split & build year by propertyType + bedrooms
  const isHouse = propertyType === 'house';
  const baseMedian = isHouse ? area.houseMedian : area.unitMedian;
  const baseRentWk = isHouse ? area.houseRentWk : area.unitRentWk;

  // Adjust by bedroom count relative to standard (3-bed house / 2-bed unit)
  const stdBeds = isHouse ? 3 : 2;
  const bedDiff = clampBeds(bedrooms) - stdBeds;
  const bedPriceFactor = 1 + bedDiff * 0.14;
  const bedRentFactor = 1 + bedDiff * 0.12;

  const estimatedValue = workerEnrichment?.estimatedValue || Math.round((baseMedian * bedPriceFactor) / 1000) * 1000;
  const estimatedLow = Math.round((estimatedValue * 0.91) / 1000) * 1000;
  const estimatedHigh = Math.round((estimatedValue * 1.09) / 1000) * 1000;
  const estimatedWeeklyRent = workerEnrichment?.estimatedWeeklyRent || Math.round((baseRentWk * bedRentFactor) / 5) * 5;

  const landShare = isHouse ? area.landShareHouse : area.landShareUnit;
  const estimatedLandValue = Math.round(estimatedValue * landShare);
  const estimatedBuildingValue = Math.round(estimatedValue * (1 - landShare) * 0.88);
  const estimatedFixturesValue = Math.round(estimatedValue * (isHouse ? 0.035 : 0.045));

  // Check if exact address matched a known historical sale record
  const allSales = [
    ...(workerEnrichment?.salesHistory || []),
    ...sgLiveSales,
    ...(area.sampleSales || []),
  ];
  const exactSaleMatch = (area.sampleSales || []).find((s) =>
    s.address.toLowerCase().includes((address || '').split(',')[0].trim().toLowerCase())
  );

  // Build Walkability / Infrastructure summary (live OSM or high-confidence suburb baseline)
  const amenities = liveAmenities || {
    isLive: false,
    transit: isHouse ? 2 : 3,
    schools: 3,
    supermarkets: 2,
    parks: 4,
    lifestyle: 8,
    namedHighlights: [`${area.suburb} Local Centre`, `${area.city} Transit Corridor`],
  };

  // Compute 5-Pillar Blended Investment Score (out of 100)
  const growth5y = isHouse ? area.growth5yrPct : area.unitGrowth5yrPct;
  const grossYieldPct = ((estimatedWeeklyRent * 52) / Math.max(1, estimatedValue)) * 100;
  const growthScore = Math.min(25, Math.round(growth5y * 0.45));
  const yieldScore = Math.min(25, Math.round(grossYieldPct * 4.2));
  const tenantHealthScore = area.rentToIncomePct <= 28 ? 20 : area.rentToIncomePct <= 33 ? 15 : 10;
  const stabilityScore = area.ownerOccupierPct >= 60 ? 15 : area.ownerOccupierPct >= 50 ? 12 : 9;
  const transitScore = Math.min(15, (amenities.transit > 0 ? 7 : 3) + Math.min(8, amenities.schools + amenities.supermarkets));
  const totalScore = Math.min(98, growthScore + yieldScore + tenantHealthScore + stabilityScore + transitScore);

  const sourcesUsed = [
    ...(shard.sources || [`${country} Public Housing & Census Benchmarks`]),
    geo?.source === 'OpenStreetMap Geocode' ? 'OSM Photon Geocoder' : null,
    amenities.isLive ? 'Live OpenStreetMap 1km Overpass Scan' : null,
    sgLiveSales.length ? 'Live Singapore data.gov.sg HDB API' : null,
    workerEnrichment ? 'Cloudflare D1 Edge Property DB' : null,
  ].filter(Boolean);

  return {
    resolvedAddress: geo?.label || address,
    country,
    propertyType,
    bedrooms: clampBeds(bedrooms),
    matchKind,
    area,
    estimatedValue,
    estimatedLow,
    estimatedHigh,
    estimatedWeeklyRent,
    grossYieldPct: Number(grossYieldPct.toFixed(2)),
    estimatedLandValue,
    estimatedBuildingValue,
    estimatedFixturesValue,
    typicalBuildYear: area.typicalBuildYear || 2016,
    growth5yrPct: growth5y,
    cityBenchmark5yrPct: shard.cityBenchmark5yr || 30,
    historySeries: isHouse ? area.houseHistory : area.unitHistory,
    cityHistorySeries: area.cityBenchmarkHistory,
    exactSaleMatch,
    recentSales: allSales.slice(0, 4),
    amenities,
    totalScore,
    scoreBreakdown: { growthScore, yieldScore, tenantHealthScore, stabilityScore, transitScore },
    sourcesUsed,
  };
}

function clampBeds(b) {
  const n = Number(b);
  if (!Number.isFinite(n)) return 2;
  return Math.max(1, Math.min(6, Math.round(n)));
}
