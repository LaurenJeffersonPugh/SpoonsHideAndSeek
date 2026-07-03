import fs from "node:fs/promises";
import path from "node:path";

import * as turf from "@turf/turf";

// POI categories used by the "(Small+Medium Games)" ("-full") matching and
// measuring questions, mapped to their primary OSM tag. Kept in sync with
// LOCATION_FIRST_TAG in src/maps/api/constants.ts.
const POI_TYPES = {
    aquarium: "tourism",
    zoo: "tourism",
    theme_park: "tourism",
    peak: "natural",
    museum: "tourism",
    hospital: "amenity",
    cinema: "amenity",
    library: "amenity",
    golf_course: "leisure",
    consulate: "diplomatic",
    park: "leisure",
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
        const endpoint = OVERPASS_ENDPOINTS[attempt % OVERPASS_ENDPOINTS.length];
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

// One combined query for every category (grouped by OSM tag) keeps us to a
// single Overpass request instead of eleven — far friendlier to rate limits.
const tags = [...new Set(Object.values(POI_TYPES))];
const query = `
[out:json][timeout:120];
(
${tags
    .map((tag) => {
        const values = Object.entries(POI_TYPES)
            .filter(([, t]) => t === tag)
            .map(([location]) => location);
        return `nwr["${tag}"~"^(${values.join("|")})$"](${bbox});`;
    })
    .join("\n")}
);
out center;
`;

console.log("Fetching all POI categories in one Overpass request...");
const data = await fetchOverpass(query);

await fs.mkdir(outputDir, { recursive: true });

// Route each element to its category by matching its tag value.
const buckets = Object.fromEntries(
    Object.keys(POI_TYPES).map((location) => [location, []]),
);
const seen = Object.fromEntries(
    Object.keys(POI_TYPES).map((location) => [location, new Set()]),
);

for (const element of data.elements ?? []) {
    const lon = element.center ? element.center.lon : element.lon;
    const lat = element.center ? element.center.lat : element.lat;
    if (typeof lon !== "number" || typeof lat !== "number") continue;

    const point = turf.point([lon, lat]);
    if (!turf.booleanPointInPolygon(point, clipRegion)) continue;

    for (const [location, tag] of Object.entries(POI_TYPES)) {
        if (element.tags?.[tag] !== location) continue;

        const key = `${lat},${lon}`;
        if (seen[location].has(key)) continue;
        seen[location].add(key);

        point.properties = {
            name: element.tags?.["name:en"] ?? element.tags?.name ?? undefined,
        };
        buckets[location].push(turf.clone(point));
    }
}

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
