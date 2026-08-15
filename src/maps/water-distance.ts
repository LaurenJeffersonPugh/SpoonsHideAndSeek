import { contours } from "d3-contour";
import type { Feature, MultiPolygon } from "geojson";
import _ from "lodash";
import proj4 from "proj4";

export const BODY_OF_WATER_QUESTION =
    "Are you closer to a body of water than we are?";

const WATER_DRAWING_STRIDE = 2;

proj4.defs(
    "EPSG:27700",
    "+proj=tmerc +lat_0=49 +lon_0=-2 +k=0.9996012717 +x_0=400000 +y_0=-100000 +ellps=airy +towgs84=446.448,-125.157,542.060,0.1502,0.2470,0.8421,-20.4894 +units=m +no_defs",
);

export type WaterDistanceMetadata = {
    width: number;
    height: number;
    west: number;
    north: number;
    cellSize: number;
    scale: number;
    noData: number;
    crs: "EPSG:27700";
    source: string;
    attribution: string;
};

export type WaterDistanceGrid = {
    metadata: WaterDistanceMetadata;
    values: Uint16Array;
};

const localWaterDataUrl = (fileName: string) =>
    `${import.meta.env.BASE_URL.replace(/\/?$/, "/")}data/measuring/${fileName}`;

export const loadWaterDistanceGrid = _.memoize(
    async (): Promise<WaterDistanceGrid> => {
        const [metadataResponse, valuesResponse] = await Promise.all([
            fetch(localWaterDataUrl("body-water-distance.json")),
            fetch(localWaterDataUrl("body-water-distance.bin")),
        ]);
        if (!metadataResponse.ok || !valuesResponse.ok) {
            throw new Error(
                "Could not load static body-of-water distance data",
            );
        }
        const metadata =
            (await metadataResponse.json()) as WaterDistanceMetadata;
        const values = new Uint16Array(await valuesResponse.arrayBuffer());
        if (values.length !== metadata.width * metadata.height) {
            throw new Error(
                "Static body-of-water distance data has an unexpected size",
            );
        }
        return { metadata, values };
    },
);

const rawWaterDistance = (
    grid: WaterDistanceGrid,
    column: number,
    row: number,
) => {
    const { metadata, values } = grid;
    if (
        column < 0 ||
        column >= metadata.width ||
        row < 0 ||
        row >= metadata.height
    ) {
        return null;
    }
    const value = values[row * metadata.width + column];
    return value === metadata.noData ? null : value * metadata.scale;
};

export const waterDistanceMeters = (
    grid: WaterDistanceGrid,
    latitude: number,
    longitude: number,
) => {
    const { metadata } = grid;
    const [easting, northing] = proj4("EPSG:4326", metadata.crs, [
        longitude,
        latitude,
    ]);
    const column = (easting - metadata.west) / metadata.cellSize;
    const row = (metadata.north - northing) / metadata.cellSize;
    const left = Math.floor(column);
    const top = Math.floor(row);
    const horizontalFraction = column - left;
    const verticalFraction = row - top;
    const neighbours = [
        {
            value: rawWaterDistance(grid, left, top),
            weight: (1 - horizontalFraction) * (1 - verticalFraction),
        },
        {
            value: rawWaterDistance(grid, left + 1, top),
            weight: horizontalFraction * (1 - verticalFraction),
        },
        {
            value: rawWaterDistance(grid, left, top + 1),
            weight: (1 - horizontalFraction) * verticalFraction,
        },
        {
            value: rawWaterDistance(grid, left + 1, top + 1),
            weight: horizontalFraction * verticalFraction,
        },
    ].filter(
        (neighbour): neighbour is { value: number; weight: number } =>
            neighbour.value !== null,
    );
    const totalWeight = neighbours.reduce(
        (total, neighbour) => total + neighbour.weight,
        0,
    );
    if (totalWeight === 0) return null;
    return (
        neighbours.reduce(
            (total, neighbour) => total + neighbour.value * neighbour.weight,
            0,
        ) / totalWeight
    );
};

const projectedBounds = (
    metadata: WaterDistanceMetadata,
    bbox: [number, number, number, number],
) => {
    const [west, south, east, north] = bbox;
    const corners = [
        [west, south],
        [west, north],
        [east, south],
        [east, north],
    ].map((coordinates) => proj4("EPSG:4326", metadata.crs, coordinates));
    return {
        minimumEasting: Math.min(...corners.map(([easting]) => easting)),
        maximumEasting: Math.max(...corners.map(([easting]) => easting)),
        minimumNorthing: Math.min(...corners.map(([, northing]) => northing)),
        maximumNorthing: Math.max(...corners.map(([, northing]) => northing)),
    };
};

const minimumBlockDistance = (
    grid: WaterDistanceGrid,
    startColumn: number,
    startRow: number,
) => {
    let minimum = Number.POSITIVE_INFINITY;
    for (let rowOffset = 0; rowOffset < WATER_DRAWING_STRIDE; rowOffset++) {
        for (
            let columnOffset = 0;
            columnOffset < WATER_DRAWING_STRIDE;
            columnOffset++
        ) {
            const distance = rawWaterDistance(
                grid,
                startColumn + columnOffset,
                startRow + rowOffset,
            );
            if (distance !== null) minimum = Math.min(minimum, distance);
        }
    }
    return Number.isFinite(minimum) ? minimum : null;
};

export const waterCloserThanReferencePolygon = (
    grid: WaterDistanceGrid,
    bbox: [number, number, number, number],
    referenceDistanceMeters: number,
): Feature<MultiPolygon> | null => {
    const { metadata } = grid;
    const bounds = projectedBounds(metadata, bbox);
    const firstColumn = Math.max(
        0,
        Math.floor(
            (bounds.minimumEasting - metadata.west) / metadata.cellSize,
        ) - WATER_DRAWING_STRIDE,
    );
    const lastColumn = Math.min(
        metadata.width - 1,
        Math.ceil((bounds.maximumEasting - metadata.west) / metadata.cellSize) +
            WATER_DRAWING_STRIDE,
    );
    const firstRow = Math.max(
        0,
        Math.floor(
            (metadata.north - bounds.maximumNorthing) / metadata.cellSize,
        ) - WATER_DRAWING_STRIDE,
    );
    const lastRow = Math.min(
        metadata.height - 1,
        Math.ceil(
            (metadata.north - bounds.minimumNorthing) / metadata.cellSize,
        ) + WATER_DRAWING_STRIDE,
    );
    const columnCount =
        Math.floor((lastColumn - firstColumn) / WATER_DRAWING_STRIDE) + 1;
    const rowCount =
        Math.floor((lastRow - firstRow) / WATER_DRAWING_STRIDE) + 1;
    if (columnCount < 2 || rowCount < 2) return null;

    const contourValues = new Float32Array(columnCount * rowCount);
    for (let row = 0; row < rowCount; row++) {
        for (let column = 0; column < columnCount; column++) {
            const distance = minimumBlockDistance(
                grid,
                firstColumn + column * WATER_DRAWING_STRIDE,
                firstRow + row * WATER_DRAWING_STRIDE,
            );
            contourValues[row * columnCount + column] =
                distance === null
                    ? Number.NEGATIVE_INFINITY
                    : referenceDistanceMeters - distance;
        }
    }

    const contour = contours()
        .size([columnCount, rowCount])
        .smooth(true)
        .thresholds([0])(contourValues)[0];
    if (!contour || contour.coordinates.length === 0) return null;

    const blockCenterOffset = (WATER_DRAWING_STRIDE - 1) / 2;
    const coordinates = contour.coordinates.map((polygon) =>
        polygon.map((ring) =>
            ring.map(([column, row]) => {
                const globalColumn =
                    firstColumn +
                    (column - 0.5) * WATER_DRAWING_STRIDE +
                    blockCenterOffset;
                const globalRow =
                    firstRow +
                    (row - 0.5) * WATER_DRAWING_STRIDE +
                    blockCenterOffset;
                return proj4(metadata.crs, "EPSG:4326", [
                    metadata.west + globalColumn * metadata.cellSize,
                    metadata.north - globalRow * metadata.cellSize,
                ]);
            }),
        ),
    );
    return {
        type: "Feature",
        properties: {
            source: metadata.source,
            referenceDistanceMeters,
        },
        geometry: { type: "MultiPolygon", coordinates },
    };
};
