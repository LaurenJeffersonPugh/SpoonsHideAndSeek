import fs from "node:fs";
import path from "node:path";

import * as turf from "@turf/turf";
import { describe, expect, it } from "vitest";

import { nearestFeatureDistancesMeters } from "@/maps/feature-distance";
import { hiderifyTentacles } from "@/maps/questions/tentacles";
import { hiderifyThermometer } from "@/maps/questions/thermometer";
import {
    decodeStreetPathIndex,
    nearestStreetPathNameFromIndex,
} from "@/maps/street-path-index";

describe("fast Hider question calculations", () => {
    it("matches Turf's distance to the nearest line", () => {
        const line = turf.lineString([
            [-1.5, 54.8],
            [-1.2, 55.1],
        ]);
        const coordinate: [number, number] = [-1.35, 54.92];
        const [distance] = nearestFeatureDistancesMeters([line], [coordinate]);
        const expected = turf.pointToLineDistance(
            turf.point(coordinate),
            line,
            { units: "meters" },
        );

        expect(distance).toBeCloseTo(expected, 6);
    });

    it("returns zero for a point inside a polygon", () => {
        const polygon = turf.polygon([
            [
                [-1.4, 54.8],
                [-1.2, 54.8],
                [-1.2, 55],
                [-1.4, 55],
                [-1.4, 54.8],
            ],
        ]);

        expect(
            nearestFeatureDistancesMeters([polygon], [[-1.3, 54.9]])[0],
        ).toBe(0);
    });

    it("answers Tentacles with the nearest point without a Voronoi build", async () => {
        const question = {
            lat: 54.9,
            lng: -1.4,
            radius: 2,
            unit: "kilometers",
            locationType: "custom",
            places: [
                turf.point([-1.399, 54.9], { name: "Near" }),
                turf.point([-1.38, 54.9], { name: "Far" }),
            ],
            location: false,
        } as any;

        const answer = await hiderifyTentacles(question, {
            latitude: 54.9,
            longitude: -1.398,
        });

        expect(answer.location?.properties?.name).toBe("Near");
    });

    it("rejects an out-of-radius Tentacles hider before loading places", async () => {
        const question = {
            lat: 54.9,
            lng: -1.4,
            radius: 500,
            unit: "meters",
            locationType: "custom",
            places: [],
            location: false,
        } as any;

        const answer = await hiderifyTentacles(question, {
            latitude: 55,
            longitude: -1.4,
        });

        expect(answer.location).toBe(false);
    });

    it("answers Thermometer by comparing the two distances", () => {
        const question = {
            latA: 54.9,
            lngA: -1.4,
            latB: 54.9,
            lngB: -1.3,
            warmer: false,
        } as any;

        expect(
            hiderifyThermometer(question, {
                latitude: 54.9,
                longitude: -1.31,
            }).warmer,
        ).toBe(true);
    });
});

describe("compact static question data", () => {
    it("decodes and searches the street/path binary layout", () => {
        const buffer = new ArrayBuffer(20);
        new Float32Array(buffer, 0, 4).set([-1.4, 54.9, -1.2, 55]);
        new Uint16Array(buffer, 16, 2).set([0, 1]);
        const index = decodeStreetPathIndex(
            {
                version: 1,
                count: 2,
                coordinatesByteLength: 16,
                names: ["First Road", "Second Road"],
            },
            buffer,
        );

        expect(nearestStreetPathNameFromIndex(index, 54.9, -1.39)).toBe(
            "First Road",
        );
    });

    it("ships compact regional and street/path datasets", () => {
        const root = process.cwd();
        const size = (relativePath: string) =>
            fs.statSync(path.join(root, relativePath)).size;

        expect(size("public/data/street-path-index.bin")).toBeLessThan(
            size("public/data/street-path-samples.geojson") / 10,
        );
        expect(size("public/data/measuring/coastline.geojson")).toBeLessThan(
            size("public/coastline50.geojson") / 10,
        );
        expect(
            size("public/data/measuring/international-borders.geojson"),
        ).toBeLessThan(250_000);
    });
});
