import fs from "node:fs/promises";
import path from "node:path";

// Administrative-district boundaries for the "same administration district?"
// matching question, sourced from the ONS Open Geography Portal (ArcGIS),
// December 2024 vintage, BGC = generalised & clipped to the coastline
// (web-friendly file sizes). Two levels for the 5 Tyne & Wear metropolitan
// boroughs:
//   councils  -> Local Authority Districts (the 5 boroughs)
//   districts -> Electoral wards within them
//
// Why ONS and not OSM: OSM has the councils (admin_level 8) but England's urban
// areas are largely unparished, so admin_level 10 (civil parish) barely covers
// Tyne & Wear and there are no electoral-ward boundaries in OSM. ONS has both,
// so we take both from there for one consistent, aligned dataset.

const ONS =
    "https://services1.arcgis.com/ESMARspQHYMw9BZ9/arcgis/rest/services";

// The 5 Tyne & Wear metropolitan borough LAD codes (2024).
const TYNE_AND_WEAR_LADS = [
    "E08000021", // Newcastle upon Tyne
    "E08000022", // North Tyneside
    "E08000023", // South Tyneside
    "E08000024", // Sunderland
    "E08000037", // Gateshead
];
const inClause = TYNE_AND_WEAR_LADS.map((code) => `'${code}'`).join(",");

const LAYERS = [
    {
        service: "Local_Authority_Districts_December_2024_Boundaries_UK_BGC",
        nameField: "LAD24NM",
        file: "admin-councils.geojson",
        label: "councils",
    },
    {
        service: "Wards_December_2024_Boundaries_UK_BGC",
        nameField: "WD24NM",
        file: "admin-districts.geojson",
        label: "districts (wards)",
    },
];

const outputDir = path.join(process.cwd(), "public", "data");

// ArcGIS pages large result sets; loop until the server stops flagging more.
const fetchArcgis = async (service, nameField) => {
    const features = [];
    let offset = 0;
    for (;;) {
        const params = new URLSearchParams({
            where: `LAD24CD IN (${inClause})`,
            outFields: nameField,
            returnGeometry: "true",
            outSR: "4326",
            geometryPrecision: "5",
            resultOffset: String(offset),
            resultRecordCount: "2000",
            f: "geojson",
        });
        const url = `${ONS}/${service}/FeatureServer/0/query?${params}`;
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(
                `${service} responded ${response.status} ${response.statusText}`,
            );
        }
        const data = await response.json();
        const batch = data.features ?? [];
        features.push(...batch);
        if (!data.exceededTransferLimit || batch.length === 0) break;
        offset += batch.length;
    }
    return features;
};

await fs.mkdir(outputDir, { recursive: true });

const summary = [];
for (const { service, nameField, file, label } of LAYERS) {
    console.log(`Fetching ${label} from ONS (${service})...`);
    const raw = await fetchArcgis(service, nameField);
    const features = raw
        .filter(
            (feature) =>
                feature.geometry &&
                (feature.geometry.type === "Polygon" ||
                    feature.geometry.type === "MultiPolygon"),
        )
        .map((feature) => ({
            type: "Feature",
            properties: { name: feature.properties?.[nameField] ?? "Unnamed" },
            geometry: feature.geometry,
        }));

    await fs.writeFile(
        path.join(outputDir, file),
        `${JSON.stringify({ type: "FeatureCollection", features })}\n`,
    );
    summary.push(`${label}: ${features.length} -> ${file}`);
}

console.log("\nDone.");
console.log(summary.join("\n"));
