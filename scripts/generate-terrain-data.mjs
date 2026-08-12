import { Buffer } from "node:buffer";
import crypto from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { pipeline } from "node:stream/promises";

import * as turf from "@turf/turf";
import AdmZip from "adm-zip";
import proj4 from "proj4";

const TERRAIN_PRODUCT_URL =
    "https://api.os.uk/downloads/v1/products/Terrain50/downloads";
const TERRAIN_FORMAT = "ASCII Grid and GML (Grid)";
const SOURCE_VERSION = "2026-07";
const BUFFER_MILES = 16;
const CELL_SIZE_METERS = 50;
const DECIMETERS_PER_METER = 10;
const NO_DATA = -32768;

proj4.defs(
    "EPSG:27700",
    "+proj=tmerc +lat_0=49 +lon_0=-2 +k=0.9996012717 +x_0=400000 +y_0=-100000 +ellps=airy +towgs84=446.448,-125.157,542.060,0.1502,0.2470,0.8421,-20.4894 +units=m +no_defs",
);

const root = process.cwd();
const outputDirectory = path.join(root, "public", "data", "measuring");
const boundary = JSON.parse(
    await fs.readFile(
        path.join(root, "public", "data", "game-boundary.geojson"),
    ),
);
const sourceArgument = process.argv.find((argument) =>
    argument.startsWith("--source="),
);

const md5 = async (filePath) => {
    const hash = crypto.createHash("md5");
    for await (const chunk of createReadStream(filePath)) hash.update(chunk);
    return hash.digest("hex");
};

const obtainArchive = async () => {
    if (sourceArgument) {
        return path.resolve(sourceArgument.slice("--source=".length));
    }

    const downloads = await fetch(TERRAIN_PRODUCT_URL).then((response) => {
        if (!response.ok) {
            throw new Error(`OS download index responded ${response.status}`);
        }
        return response.json();
    });
    const download = downloads.find((item) => item.format === TERRAIN_FORMAT);
    if (!download) throw new Error(`Could not find ${TERRAIN_FORMAT} download`);

    const archivePath = path.join(os.tmpdir(), download.fileName);
    try {
        const stats = await fs.stat(archivePath);
        if (
            stats.size === download.size &&
            (await md5(archivePath)) === download.md5
        ) {
            console.log(`Using cached ${archivePath}`);
            return archivePath;
        }
    } catch {
        // Download it below.
    }

    console.log(`Downloading ${download.fileName} (${download.size} bytes)...`);
    const response = await fetch(download.url);
    if (!response.ok || !response.body) {
        throw new Error(`OS Terrain 50 download responded ${response.status}`);
    }
    await pipeline(response.body, createWriteStream(archivePath));
    if ((await md5(archivePath)) !== download.md5) {
        throw new Error(
            "Downloaded OS Terrain 50 archive failed its MD5 check",
        );
    }
    return archivePath;
};

const gridLetterIndex = (letter) => {
    const code = letter.charCodeAt(0) - 65;
    return code > 8 ? code - 1 : code;
};

const tileOrigin = (tileReference) => {
    const first = gridLetterIndex(tileReference[0].toUpperCase());
    const second = gridLetterIndex(tileReference[1].toUpperCase());
    const hundredKmEasting =
        (((first - 2 + 25) % 5) * 5 + (second % 5)) * 100000;
    const hundredKmNorthing =
        (19 - Math.floor(first / 5) * 5 - Math.floor(second / 5)) * 100000;
    return [
        hundredKmEasting + Number(tileReference[2]) * 10000,
        hundredKmNorthing + Number(tileReference[3]) * 10000,
    ];
};

const parseAsciiGrid = (text) => {
    const lines = text.trim().split(/\r?\n/);
    const header = {};
    let dataStart = 0;
    while (dataStart < lines.length) {
        const match = lines[dataStart].match(/^([a-z]+)\s+(-?\d+(?:\.\d+)?)$/i);
        if (!match) break;
        header[match[1].toLowerCase()] = Number(match[2]);
        dataStart++;
    }
    return {
        width: header.ncols,
        height: header.nrows,
        west: header.xllcorner,
        south: header.yllcorner,
        cellSize: header.cellsize,
        rows: lines.slice(dataStart),
    };
};

const clipRegion = turf.buffer(boundary.features[0], BUFFER_MILES, {
    units: "miles",
});
const [minLongitude, minLatitude, maxLongitude, maxLatitude] =
    turf.bbox(clipRegion);
const projectedCorners = [
    [minLongitude, minLatitude],
    [minLongitude, maxLatitude],
    [maxLongitude, minLatitude],
    [maxLongitude, maxLatitude],
].map((coordinates) => proj4("EPSG:4326", "EPSG:27700", coordinates));
const eastings = projectedCorners.map(([easting]) => easting);
const northings = projectedCorners.map(([, northing]) => northing);
const minimumEasting = Math.min(...eastings);
const maximumEasting = Math.max(...eastings);
const minimumNorthing = Math.min(...northings);
const maximumNorthing = Math.max(...northings);
const west =
    Math.floor((minimumEasting - CELL_SIZE_METERS / 2) / CELL_SIZE_METERS) *
        CELL_SIZE_METERS +
    CELL_SIZE_METERS / 2;
const east =
    Math.ceil((maximumEasting - CELL_SIZE_METERS / 2) / CELL_SIZE_METERS) *
        CELL_SIZE_METERS +
    CELL_SIZE_METERS / 2;
const south =
    Math.floor((minimumNorthing - CELL_SIZE_METERS / 2) / CELL_SIZE_METERS) *
        CELL_SIZE_METERS +
    CELL_SIZE_METERS / 2;
const north =
    Math.ceil((maximumNorthing - CELL_SIZE_METERS / 2) / CELL_SIZE_METERS) *
        CELL_SIZE_METERS +
    CELL_SIZE_METERS / 2;
const width = Math.round((east - west) / CELL_SIZE_METERS) + 1;
const height = Math.round((north - south) / CELL_SIZE_METERS) + 1;
const values = new Int16Array(width * height);
values.fill(NO_DATA);

const archivePath = await obtainArchive();
const archive = new AdmZip(archivePath);
const tileEntries = archive.getEntries().filter((entry) => {
    const tileReference = path.basename(entry.entryName).slice(0, 4);
    if (!/^[a-z]{2}\d{2}$/i.test(tileReference)) return false;
    const [tileWest, tileSouth] = tileOrigin(tileReference);
    return (
        tileWest + 10000 >= west &&
        tileWest <= east &&
        tileSouth + 10000 >= south &&
        tileSouth <= north
    );
});

console.log(
    `Extracting ${tileEntries.length} OS Terrain 50 tiles into ${width} x ${height} cells...`,
);
for (const [tileIndex, entry] of tileEntries.entries()) {
    const tileArchive = new AdmZip(entry.getData());
    const asciiEntry = tileArchive
        .getEntries()
        .find((nestedEntry) =>
            nestedEntry.entryName.toLowerCase().endsWith(".asc"),
        );
    if (!asciiEntry) continue;
    const grid = parseAsciiGrid(asciiEntry.getData().toString("utf8"));
    if (grid.cellSize !== CELL_SIZE_METERS) {
        throw new Error(`Unexpected cell size in ${asciiEntry.entryName}`);
    }

    for (let sourceRow = 0; sourceRow < grid.height; sourceRow++) {
        const northing =
            grid.south + (grid.height - sourceRow - 0.5) * grid.cellSize;
        const outputRow = Math.round((north - northing) / CELL_SIZE_METERS);
        if (outputRow < 0 || outputRow >= height) continue;
        const rowValues = grid.rows[sourceRow].trim().split(/\s+/).map(Number);
        for (let sourceColumn = 0; sourceColumn < grid.width; sourceColumn++) {
            const easting = grid.west + (sourceColumn + 0.5) * grid.cellSize;
            const outputColumn = Math.round(
                (easting - west) / CELL_SIZE_METERS,
            );
            if (outputColumn < 0 || outputColumn >= width) continue;
            const elevation = rowValues[sourceColumn];
            if (!Number.isFinite(elevation) || elevation <= -9999) continue;
            values[outputRow * width + outputColumn] = Math.round(
                elevation * DECIMETERS_PER_METER,
            );
        }
    }
    if ((tileIndex + 1) % 10 === 0 || tileIndex + 1 === tileEntries.length) {
        console.log(`  terrain: ${tileIndex + 1}/${tileEntries.length} tiles`);
    }
}

const missingCells = values.reduce(
    (count, value) => count + (value === NO_DATA ? 1 : 0),
    0,
);
await fs.mkdir(outputDirectory, { recursive: true });
await fs.writeFile(
    path.join(outputDirectory, "terrain-50.bin"),
    Buffer.from(values.buffer),
);
await fs.writeFile(
    path.join(outputDirectory, "terrain-50.json"),
    JSON.stringify({
        width,
        height,
        west,
        north,
        cellSize: CELL_SIZE_METERS,
        scale: 1 / DECIMETERS_PER_METER,
        noData: NO_DATA,
        crs: "EPSG:27700",
        source: "OS Terrain 50",
        sourceVersion: SOURCE_VERSION,
        attribution:
            "Contains OS data (c) Crown copyright and database right 2026",
    }),
);

console.log(
    `Wrote ${(values.byteLength / 1024 / 1024).toFixed(2)} MiB terrain raster (${missingCells} cells without data).`,
);
