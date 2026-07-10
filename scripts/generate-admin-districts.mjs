import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

import AdmZip from "adm-zip";
import proj4 from "proj4";
import shapefile from "shapefile";

// Administrative-district boundaries for the "same administration district?"
// matching question. Two levels for Tyne & Wear:
//   councils  -> Local Authority Districts (the 5 boroughs)
//   districts -> Electoral wards within them
//
// Why ONS and not OSM: OSM has the councils (admin_level 8) but England's urban
// areas are largely unparished, so admin_level 10 (civil parish) barely covers
// Tyne & Wear and there are no electoral-ward boundaries in OSM. ONS has both,
// so we use ONS for council boundaries.
//
// Sunderland's ward boundaries changed for the 2026 local elections. ONS's
// December 2024/2025 ward files still contain the previous Sunderland wards, so
// we use LGBCE's official Sunderland final recommendation mapping files for
// Sunderland wards and ONS for the other Tyne & Wear wards.

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
const LGBCE_SUNDERLAND_WARDS_ZIP =
    "https://www.lgbce.org.uk/sites/default/files/2024-07/sunderland_f_so_zipfiles.zip";

proj4.defs(
    "EPSG:27700",
    "+proj=tmerc +lat_0=49 +lon_0=-2 +k=0.9996012717 +x_0=400000 +y_0=-100000 +ellps=airy +datum=OSGB36 +units=m +no_defs",
);

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

const reprojectCoordinates = (coordinates) => {
    if (
        Array.isArray(coordinates) &&
        coordinates.length >= 2 &&
        typeof coordinates[0] === "number" &&
        typeof coordinates[1] === "number"
    ) {
        const [longitude, latitude] = proj4("EPSG:27700", "EPSG:4326", [
            coordinates[0],
            coordinates[1],
        ]);
        return [
            Number(longitude.toFixed(6)),
            Number(latitude.toFixed(6)),
            ...coordinates.slice(2),
        ];
    }

    return coordinates.map(reprojectCoordinates);
};

const loadSunderlandFinalWards = async () => {
    console.log("Fetching Sunderland 2026 wards from LGBCE mapping files...");
    const response = await fetch(LGBCE_SUNDERLAND_WARDS_ZIP);
    if (!response.ok) {
        throw new Error(
            `LGBCE Sunderland mapping files responded ${response.status} ${response.statusText}`,
        );
    }

    const tempDir = await fs.mkdtemp(
        path.join(os.tmpdir(), "sunderland-wards-"),
    );
    const zipPath = path.join(tempDir, "sunderland-wards.zip");
    await fs.writeFile(zipPath, Buffer.from(await response.arrayBuffer()));
    new AdmZip(zipPath).extractAllTo(tempDir, true);

    const shpPath = path.join(
        tempDir,
        "Sunderland_F_SO_zipfiles",
        "Sunderland_F_Ward_polygons.shp",
    );
    const source = await shapefile.open(shpPath);
    const features = [];

    for (;;) {
        const result = await source.read();
        if (result.done) break;

        const rawName = result.value.properties?.Name ?? "Unnamed";
        const name = rawName.replace(/\s+Ward$/i, "");
        features.push({
            type: "Feature",
            properties: { name },
            geometry: {
                type: result.value.geometry.type,
                coordinates: reprojectCoordinates(
                    result.value.geometry.coordinates,
                ),
            },
        });
    }

    await fs.rm(tempDir, { recursive: true, force: true });
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

    if (file === "admin-districts.geojson") {
        const sunderlandFinalWards = await loadSunderlandFinalWards();
        const otherTyneAndWearWards = features.filter(
            (feature) =>
                ![
                    "Barnes",
                    "Castle",
                    "Copt Hill",
                    "Doxford",
                    "Fulwell",
                    "Hendon",
                    "Hetton",
                    "Houghton",
                    "Millfield",
                    "Pallion",
                    "Redhill",
                    "Ryhope",
                    "Sandhill",
                    "Shiney Row",
                    "Silksworth",
                    "Southwick",
                    "St Anne's",
                    "St Chad's",
                    "St Michael's",
                    "St Peter's",
                    "Washington Central",
                    "Washington East",
                    "Washington North",
                    "Washington South",
                    "Washington West",
                ].includes(feature.properties.name),
        );
        features.splice(
            0,
            features.length,
            ...otherTyneAndWearWards,
            ...sunderlandFinalWards,
        );
    }

    await fs.writeFile(
        path.join(outputDir, file),
        `${JSON.stringify({ type: "FeatureCollection", features })}\n`,
    );
    summary.push(`${label}: ${features.length} -> ${file}`);
}

console.log("\nDone.");
console.log(summary.join("\n"));
