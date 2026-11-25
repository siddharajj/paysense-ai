/**
 * PaySense — Blended Property Address, Live Public Transport (PT) & Suburb Client
 * -------------------------------------------------------------------------------
 * Hybrid Architecture:
 *   1. Sharded open suburb/postcode profiles from ./data/areas/{COUNTRY}.json
 *   2. Inverse-distance spatial blending for ANY suburb/postcode not in the shard
 *      (preserving the exact geocoded suburb & postcode from Photon / Nominatim!)
 *   3. Fast multi-mirror OpenStreetMap Overpass scan for real Public Transport
 *      (Train/Metro stations, Light Rail/Tram stops with exact distances, Bus stops)
 *      plus Schools, Supermarkets & Parks.
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

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://lz4.overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

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

async function fetchWithTimeout(url, options = {}, timeoutMs = 4500) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(id);
  }
}

/**
 * Live street-address & suburb autocomplete combining local benchmark addresses
 * with OpenStreetMap Photon + Nominatim fallback.
 */
export async function autocompleteAddress(query, countryCode = 'AU') {
  const q = (query || '').trim();
  if (q.length < 2) return [];

  const shard = await loadAreaShard(countryCode);
  const ql = q.toLowerCase();
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
        label: `${area.suburb}, ${area.state} ${area.postcode}`,
        suburb: area.suburb,
        state: area.state,
        postcode: area.postcode,
        lat: area.lat,
        lon: area.lon,
        source: `${area.city} Suburb Profile`,
      });
    }
  }

  const bias = COUNTRY_BBOX_CENTER[countryCode] || COUNTRY_BBOX_CENTER.AU;

  // Try Photon first, then Nominatim fallback if needed
  try {
    const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(`${q} ${bias.name}`)}&lat=${bias.lat}&lon=${bias.lon}&limit=6&lang=en`;
    const res = await fetchWithTimeout(url, {}, 3200);
    if (res.ok) {
      const geo = await res.json();
      for (const feat of geo.features || []) {
        const p = feat.properties || {};
        const coords = feat.geometry?.coordinates || [];
        const cc = (p.countrycode || '').toLowerCase();
        if (cc && cc !== bias.iso) continue;

        const subName = p.suburb || p.district || p.locality || p.city || p.town || '';
        const parts = [
          [p.housenumber, p.street || p.name].filter(Boolean).join(' '),
          subName,
          p.state,
          p.postcode,
        ].filter(Boolean);
        const label = [...new Set(parts)].join(', ');
        if (label && !localMatches.some((m) => m.label.toLowerCase() === label.toLowerCase())) {
          localMatches.push({
            label,
            suburb: subName,
            state: p.state || '',
            postcode: p.postcode || '',
            lat: coords[1],
            lon: coords[0],
            source: 'Street Geocode',
          });
        }
      }
    }
  } catch {
    // Try Nominatim CORS-enabled public search as backup
    try {
      const nomUrl = `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=5&countrycodes=${bias.iso}&q=${encodeURIComponent(q)}`;
      const nomRes = await fetchWithTimeout(nomUrl, { headers: { Accept: 'application/json' } }, 3500);
      if (nomRes.ok) {
        const rows = await nomRes.json();
        for (const r of rows || []) {
          const ad = r.address || {};
          const subName = ad.suburb || ad.neighbourhood || ad.town || ad.city_district || ad.city || '';
          localMatches.push({
            label: r.display_name.split(',').slice(0, 4).join(',').trim(),
            suburb: subName,
            state: ad.state || '',
            postcode: ad.postcode || '',
            lat: Number(r.lat),
            lon: Number(r.lon),
            source: 'OSM Geocode',
          });
        }
      }
    } catch {
      // Offline — localMatches remain available
    }
  }

  return localMatches.slice(0, 7);
}

/**
 * Fast Multi-Mirror Public Transport (PT) & Walkability Scanner!
 * Uses fast `node` queries (~200ms) and fails over across 3 Overpass mirrors
 * so suburb PT enrichment works reliably every time.
 */
async function scanLiveOsmPublicTransportAndAmenities(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

  const overpassQuery = `[out:json][timeout:6];(
    node["railway"~"station|halt|subway_entrance"](around:1600,${lat},${lon});
    node["railway"="tram_stop"](around:1300,${lat},${lon});
    node["public_transport"="station"](around:1600,${lat},${lon});
    node["highway"="bus_stop"](around:650,${lat},${lon});
    node["amenity"~"school|kindergarten"](around:1200,${lat},${lon});
    node["shop"~"supermarket|convenience|greengrocer"](around:1200,${lat},${lon});
    node["leisure"~"park|nature_reserve"](around:1000,${lat},${lon});
    way["leisure"="park"](around:900,${lat},${lon});
    way["amenity"="school"](around:1100,${lat},${lon});
  );out center tags;`;

  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const res = await fetchWithTimeout(
        endpoint,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
          body: `data=${encodeURIComponent(overpassQuery)}`,
        },
        5000
      );
      if (!res.ok) continue;
      const json = await res.json();

      const railMap = new Map();
      const tramMap = new Map();
      let busStops = 0;
      const schoolNames = new Set();
      let schoolsCount = 0;
      const shopNames = new Set();
      let supermarkets = 0;
      let parks = 0;

      for (const el of json.elements || []) {
        const t = el.tags || {};
        const elLat = el.lat ?? el.center?.lat;
        const elLon = el.lon ?? el.center?.lon;
        const distM =
          Number.isFinite(elLat) && Number.isFinite(elLon)
            ? Math.round(haversineKm(lat, lon, elLat, elLon) * 1000)
            : null;

        if (
          t.railway === 'station' ||
          t.railway === 'halt' ||
          t.railway === 'subway_entrance' ||
          (t.public_transport === 'station' && t.tram !== 'yes')
        ) {
          const name = t.name || 'Train / Metro Station';
          if (!railMap.has(name) || (distM !== null && distM < railMap.get(name))) {
            railMap.set(name, distM);
          }
        } else if (t.railway === 'tram_stop' || t.light_rail === 'yes' || t.tram === 'yes') {
          const name = t.name || 'Light Rail / Tram Stop';
          if (!tramMap.has(name) || (distM !== null && distM < tramMap.get(name))) {
            tramMap.set(name, distM);
          }
        } else if (t.highway === 'bus_stop') {
          busStops++;
        } else if (t.amenity === 'school' || t.amenity === 'kindergarten') {
          schoolsCount++;
          if (t.name) schoolNames.add(t.name);
        } else if (t.shop === 'supermarket' || t.shop === 'greengrocer' || t.shop === 'convenience') {
          supermarkets++;
          if (t.name && t.shop === 'supermarket') shopNames.add(t.name);
        } else if (t.leisure === 'park' || t.leisure === 'nature_reserve') {
          parks++;
        }
      }

      const formatStop = ([name, dist]) =>
        dist !== null
          ? `${name} (${dist >= 1000 ? `${(dist / 1000).toFixed(1)}km` : `${dist}m`})`
          : name;

      const railList = [...railMap.entries()]
        .sort((a, b) => (a[1] ?? 9999) - (b[1] ?? 9999))
        .slice(0, 3)
        .map(formatStop);

      const tramList = [...tramMap.entries()]
        .sort((a, b) => (a[1] ?? 9999) - (b[1] ?? 9999))
        .slice(0, 3)
        .map(formatStop);

      return {
        isLive: true,
        railCount: railMap.size,
        tramCount: tramMap.size,
        busStops,
        transit: railMap.size + tramMap.size,
        railList,
        tramList,
        schools: Math.max(schoolsCount, schoolNames.size),
        schoolList: [...schoolNames].slice(0, 3),
        supermarkets,
        shopList: [...shopNames].slice(0, 3),
        parks,
      };
    } catch {
      // Try next Overpass mirror!
    }
  }

  return null;
}

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
 * Matches an exact suburb/postcode OR synthesizes an inverse-distance-weighted
 * profile for ANY geocoded suburb (preserving the user's real suburb & postcode!).
 */
function resolveOrBlendSuburbProfile(shard, { address = '', suburb = '', state = '', postcode = '', lat, lon }) {
  const areas = shard.areas || [];
  if (!areas.length) return null;

  // Parse Australian/UK/US postcode & suburb from raw address string if geo didn't split them
  let parsedPc = postcode;
  if (!parsedPc) {
    const pcMatch = address.match(/\b(\d{4,6})\b/);
    if (pcMatch) parsedPc = pcMatch[1];
  }

  const addrLower = `${address} ${suburb} ${parsedPc}`.toLowerCase();

  // 1. Exact postcode or suburb name match
  for (const a of areas) {
    if (parsedPc && a.postcode && a.postcode.toLowerCase() === String(parsedPc).toLowerCase()) {
      return { area: a, matchKind: `Exact Suburb Profile (${a.suburb} ${a.postcode})` };
    }
    const cleanSub = a.suburb.split('(')[0].trim().toLowerCase();
    if (cleanSub.length >= 4 && addrLower.includes(cleanSub)) {
      return { area: a, matchKind: `Exact Suburb Profile (${a.suburb})` };
    }
  }

  // 2. Inverse-distance-weighted spatial blend of top 3 closest benchmark suburbs!
  if (Number.isFinite(lat) && Number.isFinite(lon)) {
    const withDist = areas
      .map((a) => ({ area: a, km: Math.max(0.4, haversineKm(lat, lon, a.lat, a.lon)) }))
      .sort((x, y) => x.km - y.km);

    const nearest = withDist[0];
    const top3 = withDist.slice(0, 3);
    const weights = top3.map((item) => 1 / Math.pow(item.km, 1.35));
    const wSum = weights.reduce((s, w) => s + w, 0) || 1;
    const blend = (fn) =>
      top3.reduce((sum, item, idx) => sum + fn(item.area) * (weights[idx] / wSum), 0);

    // Preserve the user's ACTUAL geocoded suburb & postcode!
    const realSuburbName = suburb || extractSuburbFromAddress(address) || nearest.area.suburb;
    const realState = shortenState(state) || nearest.area.state;
    const realPostcode = parsedPc || nearest.area.postcode;

    const houseMedian = Math.round(blend((a) => a.houseMedian) / 5000) * 5000;
    const houseRentWk = Math.round(blend((a) => a.houseRentWk) / 5) * 5;
    const unitMedian = Math.round(blend((a) => a.unitMedian) / 5000) * 5000;
    const unitRentWk = Math.round(blend((a) => a.unitRentWk) / 5) * 5;
    const growth5yrPct = Number(blend((a) => a.growth5yrPct).toFixed(1));
    const growth10yrPct = Number(blend((a) => a.growth10yrPct).toFixed(1));
    const unitGrowth5yrPct = Number(blend((a) => a.unitGrowth5yrPct).toFixed(1));
    const medianHouseholdIncome = Math.round(blend((a) => a.medianHouseholdIncome) / 1000) * 1000;

    // Scale nearest history curve to match blended median
    const scaleH = houseMedian / Math.max(1, nearest.area.houseMedian);
    const scaleU = unitMedian / Math.max(1, nearest.area.unitMedian);

    const synthesizedArea = {
      ...nearest.area,
      suburb: realSuburbName,
      state: realState,
      postcode: realPostcode,
      lat,
      lon,
      houseMedian,
      houseRentWk,
      unitMedian,
      unitRentWk,
      growth5yrPct,
      growth10yrPct,
      unitGrowth5yrPct,
      medianHouseholdIncome,
      ownerOccupierPct: Math.round(blend((a) => a.ownerOccupierPct)),
      vacancyPct: Number(blend((a) => a.vacancyPct).toFixed(1)),
      rentToIncomePct: Number(((unitRentWk * 52 * 100) / Math.max(1, medianHouseholdIncome)).toFixed(1)),
      houseHistory: (nearest.area.houseHistory || []).map((pt) => ({ year: pt.year, price: Math.round(pt.price * scaleH) })),
      unitHistory: (nearest.area.unitHistory || []).map((pt) => ({ year: pt.year, price: Math.round(pt.price * scaleU) })),
      highlights: `Blended local profile for ${realSuburbName} (${nearest.km.toFixed(1)} km from ${nearest.area.suburb} benchmark in ${nearest.area.city}).`,
    };

    return {
      area: synthesizedArea,
      matchKind:
        nearest.km <= 15
          ? `${realSuburbName} Blended Profile (via ${top3.map((t) => t.area.suburb).join(', ')})`
          : `Regional Estimate (${nearest.area.city} corridor)`,
    };
  }

  return { area: areas[0], matchKind: `${areas[0].city} Market Benchmark` };
}

function extractSuburbFromAddress(addr) {
  const parts = String(addr || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length >= 2) {
    return parts[1].replace(/\b(NSW|VIC|QLD|WA|SA|TAS|ACT|NT|\d{4})\b/gi, '').trim() || parts[1];
  }
  return '';
}

function shortenState(st) {
  const map = {
    'new south wales': 'NSW',
    victoria: 'VIC',
    queensland: 'QLD',
    'western australia': 'WA',
    'south australia': 'SA',
    tasmania: 'TAS',
    'australian capital territory': 'ACT',
    'northern territory': 'NT',
  };
  const key = String(st || '').toLowerCase().trim();
  return map[key] || st;
}

/**
 * Main Blended Address Lookup & Multi-Source Enrichment!
 */
export async function enrichPropertyByAddress({
  address,
  country = 'AU',
  propertyType = 'unit',
  bedrooms = 2,
  selectedCandidate = null,
}) {
  const shard = await loadAreaShard(country);

  // 0. Optional Cloudflare Worker + D1 backend check
  const workerUrl = getBackendWorkerUrl();
  let workerEnrichment = null;
  if (workerUrl) {
    try {
      const wRes = await fetchWithTimeout(
        `${workerUrl}/api/property?address=${encodeURIComponent(address)}&country=${country}&type=${propertyType}&beds=${bedrooms}`,
        {},
        4000
      );
      if (wRes.ok) workerEnrichment = await wRes.json();
    } catch {
      // Fallback to client hybrid enrichment
    }
  }

  // 1. Geocode street address if not already geocoded
  let geo = selectedCandidate;
  if (!geo || !Number.isFinite(geo.lat)) {
    const candidates = await autocompleteAddress(address, country);
    geo = candidates.find((c) => Number.isFinite(c.lat)) || candidates[0] || null;
  }

  const lat = geo?.lat;
  const lon = geo?.lon;

  // 2. Match exact suburb or blend top-3 nearby suburbs while keeping user's real suburb name!
  const { area, matchKind } = resolveOrBlendSuburbProfile(shard, {
    address,
    suburb: geo?.suburb,
    state: geo?.state,
    postcode: geo?.postcode,
    lat: lat ?? undefined,
    lon: lon ?? undefined,
  });

  // 3. Run fast multi-mirror OpenStreetMap Public Transport + Amenity scan in parallel
  const scanLat = Number.isFinite(lat) ? lat : area.lat;
  const scanLon = Number.isFinite(lon) ? lon : area.lon;

  const [livePtAmenities, sgLiveSales] = await Promise.all([
    scanLiveOsmPublicTransportAndAmenities(scanLat, scanLon),
    country === 'SG' ? fetchLiveSgHdbSales(geo?.suburb || area.suburb) : Promise.resolve([]),
  ]);

  // 4. Blend valuation, rent & land/building split
  const isHouse = propertyType === 'house';
  const baseMedian = isHouse ? area.houseMedian : area.unitMedian;
  const baseRentWk = isHouse ? area.houseRentWk : area.unitRentWk;

  const stdBeds = isHouse ? 3 : 2;
  const bedDiff = clampBeds(bedrooms) - stdBeds;
  const bedPriceFactor = 1 + bedDiff * 0.12;
  const bedRentFactor = 1 + bedDiff * 0.10;

  const estimatedValue = workerEnrichment?.estimatedValue || Math.round((baseMedian * bedPriceFactor) / 5000) * 5000;
  const estimatedLow = Math.round((estimatedValue * 0.92) / 5000) * 5000;
  const estimatedHigh = Math.round((estimatedValue * 1.08) / 5000) * 5000;
  const estimatedWeeklyRent = workerEnrichment?.estimatedWeeklyRent || Math.round((baseRentWk * bedRentFactor) / 5) * 5;

  const landShare = isHouse ? area.landShareHouse : area.landShareUnit;
  const estimatedLandValue = Math.round(estimatedValue * landShare);
  const estimatedBuildingValue = Math.round(estimatedValue * (1 - landShare) * 0.88);
  const estimatedFixturesValue = Math.round(estimatedValue * (isHouse ? 0.035 : 0.045));

  const allSales = [
    ...(workerEnrichment?.salesHistory || []),
    ...sgLiveSales,
    ...(area.sampleSales || []),
  ];

  const amenities = livePtAmenities || {
    isLive: false,
    railCount: 1,
    tramCount: 0,
    busStops: 6,
    transit: 1,
    railList: [`${area.suburb} Local Station / Corridor`],
    tramList: [],
    schools: 3,
    schoolList: [`${area.suburb} Public School`],
    supermarkets: 2,
    shopList: [],
    parks: 4,
  };

  const growth5y = isHouse ? area.growth5yrPct : area.unitGrowth5yrPct;
  const grossYieldPct = ((estimatedWeeklyRent * 52) / Math.max(1, estimatedValue)) * 100;
  const growthScore = Math.min(25, Math.round(growth5y * 0.45));
  const yieldScore = Math.min(25, Math.round(grossYieldPct * 4.2));
  const tenantHealthScore = area.rentToIncomePct <= 28 ? 20 : area.rentToIncomePct <= 33 ? 15 : 10;
  const stabilityScore = area.ownerOccupierPct >= 60 ? 15 : area.ownerOccupierPct >= 50 ? 12 : 9;
  const transitScore = Math.min(
    15,
    (amenities.railCount > 0 ? 7 : 0) +
      (amenities.tramCount > 0 ? 4 : 0) +
      (amenities.busStops >= 3 ? 4 : 2) +
      Math.min(4, amenities.schools)
  );
  const totalScore = Math.min(98, growthScore + yieldScore + tenantHealthScore + stabilityScore + transitScore);

  const sourcesUsed = [
    ...(shard.sources || [`${country} Public Housing & Census Benchmarks`]),
    geo?.source ? `${geo.source} (${scanLat.toFixed(4)}, ${scanLon.toFixed(4)})` : null,
    amenities.isLive ? 'Live OpenStreetMap PT & Walkability Scan' : null,
    sgLiveSales.length ? 'Live Singapore data.gov.sg HDB API' : null,
    workerEnrichment ? 'Cloudflare D1 Edge Property DB' : null,
  ].filter(Boolean);

  return {
    resolvedAddress: geo?.label || address,
    coordinates: { lat: scanLat, lon: scanLon },
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
    typicalBuildYear: area.typicalBuildYear || 2014,
    growth5yrPct: growth5y,
    cityBenchmark5yrPct: shard.cityBenchmark5yr || 30,
    historySeries: isHouse ? area.houseHistory : area.unitHistory,
    cityHistorySeries: area.cityBenchmarkHistory,
    recentSales: allSales.slice(0, 4),
    amenities,
    totalScore,
    sourcesUsed,
  };
}

function clampBeds(b) {
  const n = Number(b);
  if (!Number.isFinite(n)) return 2;
  return Math.max(1, Math.min(6, Math.round(n)));
}
