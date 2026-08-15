import { Buffer } from "node:buffer";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import proj4 from "proj4";

const NO_DATA = 65535;
const MAX_DISTANCE_METERS = NO_DATA - 1;
const INFINITE_DISTANCE = 1e20;

proj4.defs(
    "EPSG:27700",
    "+proj=tmerc +lat_0=49 +lon_0=-2 +k=0.9996012717 +x_0=400000 +y_0=-100000 +ellps=airy +towgs84=446.448,-125.157,542.060,0.1502,0.2470,0.8421,-20.4894 +units=m +no_defs",
);

const projectCoordinate = ([longitude, latitude], metadata) => {
    const [easting, northing] = proj4("EPSG:4326", metadata.crs, [
        longitude,
        latitude,
    ]);
    return [
        (easting - metadata.west) / metadata.cellSize,
        (metadata.north - northing) / metadata.cellSize,
    ];
};

const markCell = (waterCells, metadata, column, row) => {
    const roundedColumn = Math.round(column);
    const roundedRow = Math.round(row);
    if (
        roundedColumn >= 0 &&
        roundedColumn < metadata.width &&
        roundedRow >= 0 &&
        roundedRow < metadata.height
    ) {
        waterCells[roundedRow * metadata.width + roundedColumn] = 1;
    }
};

const drawSegment = (waterCells, metadata, start, end) => {
    const columnDelta = end[0] - start[0];
    const rowDelta = end[1] - start[1];
    const steps = Math.max(
        1,
        Math.ceil(Math.max(Math.abs(columnDelta), Math.abs(rowDelta)) * 2),
    );
    for (let step = 0; step <= steps; step++) {
        const fraction = step / steps;
        markCell(
            waterCells,
            metadata,
            start[0] + columnDelta * fraction,
            start[1] + rowDelta * fraction,
        );
    }
};

const drawLine = (waterCells, metadata, coordinates) => {
    const projected = coordinates.map((coordinate) =>
        projectCoordinate(coordinate, metadata),
    );
    if (projected.length === 1) {
        markCell(waterCells, metadata, projected[0][0], projected[0][1]);
        return projected;
    }
    for (let index = 1; index < projected.length; index++) {
        drawSegment(
            waterCells,
            metadata,
            projected[index - 1],
            projected[index],
        );
    }
    return projected;
};

const fillPolygon = (waterCells, metadata, rings) => {
    const projectedRings = rings.map((ring) =>
        drawLine(waterCells, metadata, ring),
    );
    const rows = projectedRings.flatMap((ring) =>
        ring.map((coordinate) => coordinate[1]),
    );
    const firstRow = Math.max(0, Math.floor(Math.min(...rows)));
    const lastRow = Math.min(metadata.height - 1, Math.ceil(Math.max(...rows)));

    for (let row = firstRow; row <= lastRow; row++) {
        const intersections = [];
        for (const ring of projectedRings) {
            for (let index = 1; index < ring.length; index++) {
                const [firstColumn, firstRowCoordinate] = ring[index - 1];
                const [secondColumn, secondRowCoordinate] = ring[index];
                if (firstRowCoordinate > row === secondRowCoordinate > row) {
                    continue;
                }
                intersections.push(
                    firstColumn +
                        ((row - firstRowCoordinate) *
                            (secondColumn - firstColumn)) /
                            (secondRowCoordinate - firstRowCoordinate),
                );
            }
        }
        intersections.sort((first, second) => first - second);
        for (let index = 0; index + 1 < intersections.length; index += 2) {
            const firstColumn = Math.max(0, Math.ceil(intersections[index]));
            const lastColumn = Math.min(
                metadata.width - 1,
                Math.floor(intersections[index + 1]),
            );
            waterCells.fill(
                1,
                row * metadata.width + firstColumn,
                row * metadata.width + lastColumn + 1,
            );
        }
    }
};

const rasterizeGeometry = (waterCells, metadata, geometry) => {
    switch (geometry.type) {
        case "Point": {
            const [column, row] = projectCoordinate(
                geometry.coordinates,
                metadata,
            );
            markCell(waterCells, metadata, column, row);
            break;
        }
        case "MultiPoint":
            for (const coordinate of geometry.coordinates) {
                rasterizeGeometry(waterCells, metadata, {
                    type: "Point",
                    coordinates: coordinate,
                });
            }
            break;
        case "LineString":
            drawLine(waterCells, metadata, geometry.coordinates);
            break;
        case "MultiLineString":
            for (const line of geometry.coordinates) {
                drawLine(waterCells, metadata, line);
            }
            break;
        case "Polygon":
            fillPolygon(waterCells, metadata, geometry.coordinates);
            break;
        case "MultiPolygon":
            for (const polygon of geometry.coordinates) {
                fillPolygon(waterCells, metadata, polygon);
            }
            break;
        case "GeometryCollection":
            for (const child of geometry.geometries) {
                rasterizeGeometry(waterCells, metadata, child);
            }
            break;
    }
};

const squaredDistanceTransform = (source, length, output) => {
    let firstSource = -1;
    for (let index = 0; index < length; index++) {
        if (source[index] < INFINITE_DISTANCE) {
            firstSource = index;
            break;
        }
    }
    if (firstSource === -1) {
        output.fill(INFINITE_DISTANCE, 0, length);
        return;
    }

    const sites = new Int32Array(length);
    const boundaries = new Float64Array(length + 1);
    let siteIndex = 0;
    sites[0] = firstSource;
    boundaries[0] = -INFINITE_DISTANCE;
    boundaries[1] = INFINITE_DISTANCE;

    for (let position = firstSource + 1; position < length; position++) {
        if (source[position] >= INFINITE_DISTANCE) continue;
        let intersection =
            (source[position] +
                position * position -
                (source[sites[siteIndex]] +
                    sites[siteIndex] * sites[siteIndex])) /
            (2 * position - 2 * sites[siteIndex]);
        while (intersection <= boundaries[siteIndex]) {
            siteIndex--;
            intersection =
                (source[position] +
                    position * position -
                    (source[sites[siteIndex]] +
                        sites[siteIndex] * sites[siteIndex])) /
                (2 * position - 2 * sites[siteIndex]);
        }
        siteIndex++;
        sites[siteIndex] = position;
        boundaries[siteIndex] = intersection;
        boundaries[siteIndex + 1] = INFINITE_DISTANCE;
    }

    siteIndex = 0;
    for (let position = 0; position < length; position++) {
        while (boundaries[siteIndex + 1] < position) siteIndex++;
        const delta = position - sites[siteIndex];
        output[position] = delta * delta + source[sites[siteIndex]];
    }
};

const buildDistanceGrid = (waterCells, metadata) => {
    const intermediate = new Float64Array(waterCells.length);
    const source = new Float64Array(Math.max(metadata.width, metadata.height));
    const transformed = new Float64Array(source.length);

    for (let column = 0; column < metadata.width; column++) {
        for (let row = 0; row < metadata.height; row++) {
            source[row] = waterCells[row * metadata.width + column]
                ? 0
                : INFINITE_DISTANCE;
        }
        squaredDistanceTransform(source, metadata.height, transformed);
        for (let row = 0; row < metadata.height; row++) {
            intermediate[row * metadata.width + column] = transformed[row];
        }
    }

    const distances = new Uint16Array(waterCells.length);
    for (let row = 0; row < metadata.height; row++) {
        const offset = row * metadata.width;
        for (let column = 0; column < metadata.width; column++) {
            source[column] = intermediate[offset + column];
        }
        squaredDistanceTransform(source, metadata.width, transformed);
        for (let column = 0; column < metadata.width; column++) {
            distances[offset + column] = Math.min(
                MAX_DISTANCE_METERS,
                Math.round(Math.sqrt(transformed[column]) * metadata.cellSize),
            );
        }
    }
    return distances;
};

export const generateWaterDistanceData = async () => {
    const root = process.cwd();
    const outputDirectory = path.join(root, "public", "data", "measuring");
    const [terrainMetadata, waterData] = await Promise.all([
        fs
            .readFile(path.join(outputDirectory, "terrain-50.json"), "utf8")
            .then(JSON.parse),
        fs
            .readFile(path.join(outputDirectory, "body-water.geojson"), "utf8")
            .then(JSON.parse),
    ]);
    const metadata = {
        width: terrainMetadata.width,
        height: terrainMetadata.height,
        west: terrainMetadata.west,
        north: terrainMetadata.north,
        cellSize: terrainMetadata.cellSize,
        scale: 1,
        noData: NO_DATA,
        crs: terrainMetadata.crs,
        source: "OpenStreetMap body-of-water geometry",
        attribution: "(c) OpenStreetMap contributors",
    };
    const waterCells = new Uint8Array(metadata.width * metadata.height);
    for (const feature of waterData.features) {
        if (feature.geometry) {
            rasterizeGeometry(waterCells, metadata, feature.geometry);
        }
    }
    const waterCellCount = waterCells.reduce(
        (total, value) => total + value,
        0,
    );
    if (waterCellCount === 0) {
        throw new Error("No water geometry landed inside the distance grid");
    }

    console.log(
        `Calculating water distances for ${metadata.width} x ${metadata.height} cells...`,
    );
    const distances = buildDistanceGrid(waterCells, metadata);
    await Promise.all([
        fs.writeFile(
            path.join(outputDirectory, "body-water-distance.bin"),
            Buffer.from(distances.buffer),
        ),
        fs.writeFile(
            path.join(outputDirectory, "body-water-distance.json"),
            JSON.stringify(metadata),
        ),
    ]);
    console.log(
        `Wrote ${(distances.byteLength / 1024 / 1024).toFixed(2)} MiB static water-distance grid from ${waterData.features.length} features.`,
    );
};

if (
    process.argv[1] &&
    pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
) {
    await generateWaterDistanceData();
}
