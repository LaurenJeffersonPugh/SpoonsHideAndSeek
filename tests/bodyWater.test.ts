import fs from "node:fs";

import * as turf from "@turf/turf";
import type { FeatureCollection, MultiPolygon, Polygon } from "geojson";
import { describe, expect, it } from "vitest";

import { modifyMapData } from "@/maps/geo-utils";
import {
    BODY_OF_WATER_QUESTION,
    waterCloserThanReferencePolygon,
    type WaterDistanceGrid,
    type WaterDistanceMetadata,
    waterDistanceMeters,
} from "@/maps/water-distance";

const metadata = JSON.parse(
    fs.readFileSync("public/data/measuring/body-water-distance.json", "utf8"),
) as WaterDistanceMetadata;
const distanceBytes = fs.readFileSync(
    "public/data/measuring/body-water-distance.bin",
);
const grid: WaterDistanceGrid = {
    metadata,
    values: new Uint16Array(
        distanceBytes.buffer,
        distanceBytes.byteOffset,
        distanceBytes.byteLength / Uint16Array.BYTES_PER_ELEMENT,
    ),
};

describe("body of water measuring questions", () => {
    it("uses the requested wording", () => {
        expect(BODY_OF_WATER_QUESTION).toBe(
            "Are you closer to a body of water than we are?",
        );
    });

    it("looks up distances from the static water grid", () => {
        const riverWear = waterDistanceMeters(grid, 54.9096, -1.385);
        const sheriffHill = waterDistanceMeters(grid, 54.935924, -1.581288);

        expect(riverWear).toBeLessThan(50);
        expect(sheriffHill).toBeGreaterThan(1000);
    });

    it("draws a smoothed nearest-water contour", () => {
        const region = waterCloserThanReferencePolygon(
            grid,
            [-1.75, 54.85, -1.35, 55.06],
            1000,
        );
        const longestRing =
            region?.geometry.coordinates
                .flat()
                .sort((first, second) => second.length - first.length)[0] ?? [];

        expect(region?.geometry.type).toBe("MultiPolygon");
        expect(longestRing.length).toBeGreaterThan(20);
    });

    it("clips the static contour to the game boundary", () => {
        const mapData = JSON.parse(
            fs.readFileSync("public/data/game-boundary.geojson", "utf8"),
        ) as FeatureCollection<Polygon | MultiPolygon>;
        const referenceDistance = waterDistanceMeters(
            grid,
            54.935924,
            -1.581288,
        );
        const region = waterCloserThanReferencePolygon(
            grid,
            turf.bbox(mapData) as [number, number, number, number],
            referenceDistance!,
        );
        const result = modifyMapData(mapData, region!, true);

        expect(result).not.toBeNull();
    });
});
