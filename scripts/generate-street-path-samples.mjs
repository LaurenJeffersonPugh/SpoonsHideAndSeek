import fs from "node:fs/promises";
import path from "node:path";

import * as turf from "@turf/turf";

const OVERPASS_ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
];

const SAMPLE_INTERVAL_METERS = 150;
const BUFFER_MILES = 1;

const root = process.cwd();
const boundaryPath = path.join(root, "public", "data", "game-boundary.geojson");
const outputPath = path.join(
    root,
    "public",
    "data",
    "street-path-samples.geojson",
);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const fetchOverpass = async (query) => {
    let lastError;
    const maxAttempts = 24;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const endpoint =
            OVERPASS_ENDPOINTS[attempt % OVERPASS_ENDPOINTS.length];
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
const clipRegion = turf.buffer(boundary.features[0], BUFFER_MILES, {
    units: "miles",
});
const [west, south, east, north] = turf.bbox(clipRegion);
const bbox = `${south},${west},${north},${east}`;

const query = `
[out:json][timeout:180];
way["highway"]["name"](${bbox});
out geom tags;
`;

console.log("Fetching named street/path geometry from Overpass...");
const data = await fetchOverpass(query);

const features = [];
const seen = new Set();

const addSample = (name, coordinates) => {
    const point = turf.point(coordinates, { name });
    if (!turf.booleanPointInPolygon(point, clipRegion)) return;

    const key = `${name}:${coordinates
        .map((coordinate) => coordinate.toFixed(5))
        .join(",")}`;
    if (seen.has(key)) return;
    seen.add(key);
    features.push(point);
};

for (const element of data.elements ?? []) {
    const name = element.tags?.name?.trim();
    if (!name || !Array.isArray(element.geometry)) continue;

    const coordinates = element.geometry
        .map((coordinate) => [coordinate.lon, coordinate.lat])
        .filter(
            (coordinate) =>
                typeof coordinate[0] === "number" &&
                typeof coordinate[1] === "number",
        );
    if (coordinates.length < 2) continue;

    const line = turf.lineString(coordinates, { name });
    const lengthMeters = turf.length(line, { units: "meters" });
    if (!Number.isFinite(lengthMeters) || lengthMeters <= 0) continue;

    for (
        let distance = 0;
        distance < lengthMeters;
        distance += SAMPLE_INTERVAL_METERS
    ) {
        addSample(
            name,
            turf.along(line, distance, {
                units: "meters",
            }).geometry.coordinates,
        );
    }

    addSample(name, coordinates[coordinates.length - 1]);
}

await fs.writeFile(
    outputPath,
    `${JSON.stringify({
        type: "FeatureCollection",
        features,
    })}\n`,
);

console.log(
    `Done. Wrote ${features.length} street/path sample points to ${path.relative(
        root,
        outputPath,
    )}.`,
);
