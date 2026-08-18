import fs from "node:fs/promises";
import path from "node:path";

import * as turf from "@turf/turf";

import { generateStreetPathIndex } from "./generate-street-path-index.mjs";

const OVERPASS_ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
];

const SAMPLE_INTERVAL_METERS = 40;
const BUFFER_MILES = 1;

const root = process.cwd();
const boundaryPath = path.join(root, "public", "data", "game-boundary.geojson");
const outputPath = path.join(
    root,
    "public",
    "data",
    "street-path-samples.geojson",
);
const outputLinesPath = path.join(
    root,
    "public",
    "data",
    "street-path-lines.geojson",
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
const lineFeatures = [];
const seen = new Set();
const rawLines = [];

const roundCoordinates = (coordinates) =>
    coordinates.map((coordinate) => Number(coordinate.toFixed(6)));

const coordinateKey = (coordinates) =>
    coordinates.map((coordinate) => coordinate.toFixed(5)).join(",");

const addSample = (name, streetPathId, coordinates) => {
    const point = turf.point(roundCoordinates(coordinates), {
        name,
        streetPathId,
    });
    if (!turf.booleanPointInPolygon(point, clipRegion)) return;

    const key = `${streetPathId}:${coordinateKey(coordinates)}`;
    if (seen.has(key)) return;
    seen.add(key);
    features.push(point);
};

const find = (parents, index) => {
    while (parents[index] !== index) {
        parents[index] = parents[parents[index]];
        index = parents[index];
    }
    return index;
};

const union = (parents, a, b) => {
    const rootA = find(parents, a);
    const rootB = find(parents, b);
    if (rootA !== rootB) parents[rootB] = rootA;
};

for (const element of data.elements ?? []) {
    const name = element.tags?.name?.trim();
    if (!name || !Array.isArray(element.geometry)) continue;

    const coordinates = element.geometry
        .map((coordinate) => roundCoordinates([coordinate.lon, coordinate.lat]))
        .filter(
            (coordinate) =>
                typeof coordinate[0] === "number" &&
                typeof coordinate[1] === "number",
        );
    if (coordinates.length < 2) continue;

    const line = turf.lineString(coordinates, { name });
    if (!turf.booleanIntersects(line, clipRegion)) continue;

    rawLines.push({
        name,
        osmId: element.id,
        coordinates,
    });
}

const groupedByName = new Map();
for (const line of rawLines) {
    const lines = groupedByName.get(line.name) ?? [];
    lines.push(line);
    groupedByName.set(line.name, lines);
}

for (const [name, lines] of groupedByName) {
    const parents = lines.map((_, index) => index);
    const coordinateToLines = new Map();

    lines.forEach((line, index) => {
        for (const coordinates of line.coordinates) {
            const key = coordinateKey(coordinates);
            const connected = coordinateToLines.get(key);
            if (connected !== undefined) {
                union(parents, index, connected);
            } else {
                coordinateToLines.set(key, index);
            }
        }
    });

    const componentNumbers = new Map();

    for (const [index, rawLine] of lines.entries()) {
        const rootIndex = find(parents, index);
        if (!componentNumbers.has(rootIndex)) {
            componentNumbers.set(rootIndex, componentNumbers.size + 1);
        }
        const streetPathId = `${name}#${componentNumbers.get(rootIndex)}`;
        const line = turf.lineString(rawLine.coordinates, {
            name,
            osmId: rawLine.osmId,
            streetPathId,
        });

        lineFeatures.push(
            turf.lineString(rawLine.coordinates, line.properties),
        );

        const lengthMeters = turf.length(line, { units: "meters" });
        if (!Number.isFinite(lengthMeters) || lengthMeters <= 0) continue;

        for (
            let distance = 0;
            distance < lengthMeters;
            distance += SAMPLE_INTERVAL_METERS
        ) {
            addSample(
                name,
                streetPathId,
                turf.along(line, distance, {
                    units: "meters",
                }).geometry.coordinates,
            );
        }

        addSample(
            name,
            streetPathId,
            rawLine.coordinates[rawLine.coordinates.length - 1],
        );
    }
}

await fs.writeFile(
    outputPath,
    `${JSON.stringify({
        type: "FeatureCollection",
        features,
    })}\n`,
);
await fs.writeFile(
    outputLinesPath,
    `${JSON.stringify({
        type: "FeatureCollection",
        features: lineFeatures,
    })}\n`,
);
await generateStreetPathIndex();

console.log(
    `Done. Wrote ${features.length} street/path sample points to ${path.relative(
        root,
        outputPath,
    )}.`,
);
console.log(
    `Wrote ${lineFeatures.length} street/path lines to ${path.relative(
        root,
        outputLinesPath,
    )}.`,
);
