import fs from "node:fs/promises";
import path from "node:path";

import * as turf from "@turf/turf";

const root = process.cwd();
const stopsPath = path.join(root, "public", "data", "stops.geojson");
const outputPath = path.join(
    root,
    "public",
    "data",
    "hiding-zone-circles.geojson",
);
const noOverlapOutputPath = path.join(
    root,
    "public",
    "data",
    "hiding-zone-no-overlap.geojson",
);

const stopsGeoJson = JSON.parse(await fs.readFile(stopsPath, "utf8"));

const features = stopsGeoJson.features
    .filter((feature) => feature.geometry?.type === "Point")
    .map((feature) => {
        const [lng, lat] = feature.geometry.coordinates;
        const name = feature.properties?.name;
        const id = `${lat},${lng}`;
        const station = {
            type: "Feature",
            geometry: {
                type: "Point",
                coordinates: [lng, lat],
            },
            properties: {
                id,
                name,
            },
        };

        return turf.circle([lng, lat], 500, {
            steps: 32,
            units: "meters",
            properties: station,
        });
    });

await fs.writeFile(
    outputPath,
    `${JSON.stringify(
        {
            type: "FeatureCollection",
            features,
        },
        null,
        2,
    )}\n`,
);

const noOverlap = turf.union({
    type: "FeatureCollection",
    features,
});

if (!noOverlap) {
    throw new Error("Unable to generate no-overlap hiding zone geometry.");
}

await fs.writeFile(
    noOverlapOutputPath,
    `${JSON.stringify(
        {
            type: "FeatureCollection",
            features: [noOverlap],
        },
        null,
        2,
    )}\n`,
);

console.log(`Generated ${features.length} hiding zone circles.`);
console.log("Generated no-overlap hiding zone geometry.");
