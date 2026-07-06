import fs from "node:fs/promises";
import path from "node:path";

import * as turf from "@turf/turf";

// POI categories used by the "(Small+Medium Games)" ("-full") matching,
// measuring, and tentacle questions. Each is written to
// public/data/pois/<location>.geojson and matched by an OSM key=value tag.
// NOTE: the "theme_park" slot is repurposed as Greggs (a Newcastle bakery
// brand) — the internal key stays "theme_park" so all existing plumbing keeps
// working, but it queries brand=Greggs and displays as "Greggs".
const POI_SELECTORS = [
    { location: "aquarium", key: "tourism", value: "aquarium" },
    { location: "zoo", key: "tourism", value: "zoo" },
    { location: "theme_park", key: "brand", value: "Greggs" },
    { location: "peak", key: "natural", value: "peak" },
    { location: "museum", key: "tourism", value: "museum" },
    { location: "hospital", key: "amenity", value: "hospital" },
    { location: "cinema", key: "amenity", value: "cinema" },
    { location: "library", key: "amenity", value: "library" },
    { location: "golf_course", key: "leisure", value: "golf_course" },
    { location: "consulate", key: "diplomatic", value: "consulate" },
    { location: "park", key: "leisure", value: "park" },
];

// Greggs are all named "Greggs", so add a location suffix to keep them
// distinguishable (the tentacle question identifies locations by name).
const buildName = (location, tags) => {
    const base = tags?.["name:en"] ?? tags?.name ?? undefined;
    if (location !== "theme_park") return base;

    // Only trust an explicit street address; anything without one is left bare
    // so it gets reverse-geocoded to its actual road below (avoids naming a
    // Greggs after its town, which causes collisions like "Greggs, Washington").
    const street = tags?.["addr:street"];
    if (!street) return "Greggs";
    const house = tags?.["addr:housenumber"];
    return `Greggs, ${house ? `${house} ${street}` : street}`;
};

// Make every name in a bucket unique by suffixing repeats " (2)", " (3)", …
// so locations stay individually selectable.
const dedupeNames = (features) => {
    const counts = {};
    for (const feature of features) {
        const name = feature.properties.name ?? "Unnamed";
        counts[name] = (counts[name] ?? 0) + 1;
        if (counts[name] > 1) {
            feature.properties.name = `${name} (${counts[name]})`;
        }
    }
};

// Reverse-geocode a point to a street/area name (OpenStreetMap Nominatim),
// used to name Greggs that have no address tags in OSM. Returns undefined on
// failure. Nominatim asks for <= 1 request/second and a descriptive User-Agent.
const reverseGeocodeStreet = async (lat, lon) => {
    try {
        const res = await fetch(
            `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}&zoom=18&addressdetails=1`,
            {
                headers: {
                    "User-Agent": "SpoonsHideAndSeek/1.0 (map generation)",
                },
            },
        );
        if (!res.ok) return undefined;
        const a = (await res.json()).address ?? {};
        // Prefer the actual road; fall back to a local area, but never the
        // town/city (that would re-create ambiguous "Greggs, Washington" names).
        return (
            a.road ??
            a.pedestrian ??
            a.footway ??
            a.path ??
            a.cycleway ??
            a.suburb ??
            a.neighbourhood ??
            a.quarter ??
            a.city_district ??
            undefined
        );
    } catch {
        return undefined;
    }
};

const OVERPASS_ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
];

const root = process.cwd();
const boundaryPath = path.join(root, "public", "data", "game-boundary.geojson");
const outputDir = path.join(root, "public", "data", "pois");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Fetch with patience: the public Overpass servers rate-limit aggressively, so
// on 429/504 we back off for a while and retry rather than hammering them.
const fetchOverpass = async (query) => {
    let lastError;
    const maxAttempts = 24;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const endpoint =
            OVERPASS_ENDPOINTS[attempt % OVERPASS_ENDPOINTS.length];
        // Backoff grows once per full pass through the mirror list, capped at 60s.
        const wait = Math.min(
            10000 * (Math.floor(attempt / OVERPASS_ENDPOINTS.length) + 1),
            60000,
        );
        try {
            const response = await fetch(endpoint, {
                method: "POST",
                body: `data=${encodeURIComponent(query)}`,
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded",
                },
            });

            if (response.ok) {
                return await response.json();
            }

            console.log(
                `  ${endpoint} responded ${response.status}; waiting ${wait / 1000}s...`,
            );
            lastError = new Error(`${endpoint} responded ${response.status}`);
        } catch (error) {
            console.log(
                `  ${endpoint} failed (${error?.message ?? error}); waiting ${wait / 1000}s...`,
            );
            lastError = error;
        }
        await sleep(wait);
    }
    throw lastError ?? new Error("Overpass request failed");
};

const boundary = JSON.parse(await fs.readFile(boundaryPath, "utf8"));

// Tentacles search a radius (up to ~15 miles) around a point inside the game
// area, so it can reach POIs just outside the boundary. Buffer the boundary
// before clipping so those edge POIs are included (this also improves matching/
// measuring accuracy near the boundary). Matching/measuring only ever use the
// in-boundary subset, so the extra points are harmless there.
const BUFFER_MILES = 16;
const clipRegion = turf.buffer(boundary.features[0], BUFFER_MILES, {
    units: "miles",
});
const [west, south, east, north] = turf.bbox(clipRegion);
const bbox = `${south},${west},${north},${east}`;

// One combined query for every category keeps us to a single Overpass request
// instead of eleven — far friendlier to rate limits.
const query = `
[out:json][timeout:120];
(
${POI_SELECTORS.map(
    ({ key, value }) => `nwr["${key}"="${value}"](${bbox});`,
).join("\n")}
);
out center;
`;

console.log("Fetching all POI categories in one Overpass request...");
const data = await fetchOverpass(query);

await fs.mkdir(outputDir, { recursive: true });

// Route each element to its category by matching its OSM key=value tag.
const buckets = Object.fromEntries(
    POI_SELECTORS.map(({ location }) => [location, []]),
);
const seen = Object.fromEntries(
    POI_SELECTORS.map(({ location }) => [location, new Set()]),
);

for (const element of data.elements ?? []) {
    const lon = element.center ? element.center.lon : element.lon;
    const lat = element.center ? element.center.lat : element.lat;
    if (typeof lon !== "number" || typeof lat !== "number") continue;

    const point = turf.point([lon, lat]);
    if (!turf.booleanPointInPolygon(point, clipRegion)) continue;

    for (const { location, key, value } of POI_SELECTORS) {
        if (element.tags?.[key] !== value) continue;

        const dedupeKey = `${lat},${lon}`;
        if (seen[location].has(dedupeKey)) continue;
        seen[location].add(dedupeKey);

        point.properties = { name: buildName(location, element.tags) };
        buckets[location].push(turf.clone(point));
    }
}

// Name any address-less Greggs by reverse geocoding their coordinates, so the
// tentacle "Location" dropdown shows a real street/area for every one.
for (const feature of buckets.theme_park) {
    if (feature.properties.name && feature.properties.name !== "Greggs") {
        continue;
    }
    const [lon, lat] = feature.geometry.coordinates;
    const suffix = await reverseGeocodeStreet(lat, lon);
    feature.properties.name = suffix
        ? `Greggs, ${suffix}`
        : `Greggs (${lat.toFixed(4)}, ${lon.toFixed(4)})`;
    await sleep(1200);
}

dedupeNames(buckets.theme_park);

const summary = [];
for (const [location, features] of Object.entries(buckets)) {
    const collection = { type: "FeatureCollection", features };
    await fs.writeFile(
        path.join(outputDir, `${location}.geojson`),
        `${JSON.stringify(collection)}\n`,
    );
    summary.push(`${location}: ${features.length}`);
}

console.log(`\nDone. Counts within the boundary + ${BUFFER_MILES}mi buffer:`);
console.log(summary.join("\n"));
