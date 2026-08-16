import fs from "node:fs";

import * as turf from "@turf/turf";
import type {
    FeatureCollection,
    Geometry,
    MultiPolygon,
    Polygon,
} from "geojson";
import { describe, expect, it } from "vitest";

import { modifyMapData } from "@/maps/geo-utils";
import {
    BODY_OF_WATER_QUESTION,
    waterCloserThanReferencePolygon,
    type WaterDistanceGrid,
    type WaterDistanceMetadata,
    waterDistanceMeters,
} from "@/maps/water-distance";
import {
    isEligibleBodyOfWater,
    MINIMUM_UNNAMED_LAKE_POND_AREA_SQUARE_METERS,
} from "@/maps/water-features";

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
const waterFeatures = JSON.parse(
    fs.readFileSync("public/data/measuring/body-water.geojson", "utf8"),
) as FeatureCollection<Geometry>;

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

    it("includes named water and only sufficiently large unnamed lakes or ponds", () => {
        const namedStream = turf.lineString(
            [
                [0, 0],
                [0.001, 0.001],
            ],
            { name: "Test Stream", waterway: "stream" },
        );
        const smallUnnamedPond = turf.circle([0, 0], 10, {
            units: "meters",
            properties: { water: "pond" },
        });
        const largeUnnamedLake = turf.circle([0, 0], 20, {
            units: "meters",
            properties: { water: "lake" },
        });
        const largeUnnamedReservoir = turf.circle([0, 0], 20, {
            units: "meters",
            properties: { water: "reservoir" },
        });

        expect(isEligibleBodyOfWater(namedStream)).toBe(true);
        expect(turf.area(smallUnnamedPond)).toBeLessThan(
            MINIMUM_UNNAMED_LAKE_POND_AREA_SQUARE_METERS,
        );
        expect(isEligibleBodyOfWater(smallUnnamedPond)).toBe(false);
        expect(turf.area(largeUnnamedLake)).toBeGreaterThan(
            MINIMUM_UNNAMED_LAKE_POND_AREA_SQUARE_METERS,
        );
        expect(isEligibleBodyOfWater(largeUnnamedLake)).toBe(true);
        expect(isEligibleBodyOfWater(largeUnnamedReservoir)).toBe(false);
    });

    it("keeps every generated static water feature within the rule", () => {
        const unnamedFeatures = waterFeatures.features.filter(
            (feature) => !feature.properties?.name,
        );

        expect(unnamedFeatures.length).toBeGreaterThan(0);
        expect(waterFeatures.features.every(isEligibleBodyOfWater)).toBe(true);
        expect(
            unnamedFeatures.every(
                (feature) =>
                    Number(feature.properties?.areaSquareMeters) >=
                    MINIMUM_UNNAMED_LAKE_POND_AREA_SQUARE_METERS,
            ),
        ).toBe(true);
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
