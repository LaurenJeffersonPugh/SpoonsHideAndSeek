import fs from "node:fs";

import { describe, expect, it } from "vitest";

import { isCloserToSeaLevel } from "@/maps/sea-level";
import {
    terrainCloserToSeaLevelPolygon,
    terrainElevationMeters,
    type TerrainGrid,
    type TerrainMetadata,
} from "@/maps/terrain";

const metadata = JSON.parse(
    fs.readFileSync("public/data/measuring/terrain-50.json", "utf8"),
) as TerrainMetadata;
const terrainBytes = fs.readFileSync("public/data/measuring/terrain-50.bin");
const terrain: TerrainGrid = {
    metadata,
    values: new Int16Array(
        terrainBytes.buffer,
        terrainBytes.byteOffset,
        terrainBytes.byteLength / Int16Array.BYTES_PER_ELEMENT,
    ),
};

describe("sea level measuring questions", () => {
    it("compares absolute elevation from zero metres", () => {
        expect(isCloserToSeaLevel(25, 80)).toBe(true);
        expect(isCloserToSeaLevel(-25, 80)).toBe(true);
        expect(isCloserToSeaLevel(80, -25)).toBe(false);
    });

    it("does not call equal elevations closer", () => {
        expect(isCloserToSeaLevel(-25, 25)).toBe(false);
    });

    it("uses the official terrain summit at Sheriff Hill", () => {
        const sheriffHill = terrainElevationMeters(
            terrain,
            54.935924,
            -1.581288,
        );
        const wrekenton = terrainElevationMeters(
            terrain,
            54.9253141,
            -1.5745803,
        );

        expect(sheriffHill).toBeGreaterThan(160);
        expect(wrekenton).toBeGreaterThan(140);
        expect(sheriffHill!).toBeGreaterThan(wrekenton! + 10);
    });

    it("draws an interpolated terrain contour instead of grid cells", () => {
        const region = terrainCloserToSeaLevelPolygon(
            terrain,
            [-1.75, 54.85, -1.45, 55.02],
            100,
        );
        const longestRing =
            region?.geometry.coordinates
                .flat()
                .sort((first, second) => second.length - first.length)[0] ?? [];

        expect(region?.geometry.type).toBe("MultiPolygon");
        expect(longestRing.length).toBeGreaterThan(20);
    });
});
