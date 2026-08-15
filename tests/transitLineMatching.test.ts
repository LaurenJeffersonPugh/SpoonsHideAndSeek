import fs from "node:fs";

import * as turf from "@turf/turf";
import type { FeatureCollection, Point, Polygon } from "geojson";
import { describe, expect, it } from "vitest";

import { mapGeoJSON } from "@/lib/context";
import {
    adjustPerMatching,
    determineMatchingBoundary,
} from "@/maps/questions/matching";
import { questionSchema } from "@/maps/schema";
import {
    type SelectedTransitStop,
    selectedTransitStopFromFeature,
    type SpoonsStopFeature,
    spoonsStopId,
    TRANSIT_LINE_QUESTION,
    transitLineStopsAt,
} from "@/maps/spoons-stops";

const gameBoundary = JSON.parse(
    fs.readFileSync("public/data/game-boundary.geojson", "utf8"),
);
const stops = JSON.parse(
    fs.readFileSync("public/data/stops.geojson", "utf8"),
) as FeatureCollection<Point>;
const hidingZones = JSON.parse(
    fs.readFileSync("public/data/hiding-zone-circles.geojson", "utf8"),
) as FeatureCollection<Polygon>;
const firstStop = stops.features[0] as SpoonsStopFeature;
const selectedStop = selectedTransitStopFromFeature(firstStop);

const parseQuestion = (selectedStops?: SelectedTransitStop[]) => {
    const parsed = questionSchema.parse({
        id: "matching",
        data: {
            type: "same-train-line",
            lat: 0,
            lng: 0,
            selectedStops,
        },
    });
    if (parsed.id !== "matching" || parsed.data.type !== "same-train-line") {
        throw new Error("Transit line question did not parse correctly");
    }
    return parsed.data;
};

describe("manual transit line matching", () => {
    it("uses the current-line question wording", () => {
        expect(TRANSIT_LINE_QUESTION).toBe(
            "Does the transit line I'm currently on stop at your hiding zone station?",
        );
    });

    it("keeps old saved questions valid with an empty selection", () => {
        expect(parseQuestion().selectedStops).toEqual([]);
    });

    it("persists manually selected valid stops", () => {
        expect(parseQuestion([selectedStop]).selectedStops).toEqual([
            selectedStop,
        ]);
        expect(transitLineStopsAt([selectedStop], selectedStop.id)).toBe(true);
        expect(transitLineStopsAt([], selectedStop.id)).toBe(false);
    });

    it("uses the same stop IDs as the generated hiding zones", () => {
        const circle = hidingZones.features.find(
            (feature) =>
                feature.properties?.properties?.id === spoonsStopId(firstStop),
        );
        expect(circle).toBeDefined();
    });

    it("keeps or excludes the selected stop's 500 metre zone", async () => {
        mapGeoJSON.set(gameBoundary);
        const selectedPoint = turf.point(firstStop.geometry.coordinates);
        const included = await adjustPerMatching(
            { ...parseQuestion([selectedStop]), same: true },
            gameBoundary,
        );
        const excluded = await adjustPerMatching(
            { ...parseQuestion([selectedStop]), same: false },
            gameBoundary,
        );

        expect(turf.booleanPointInPolygon(selectedPoint, included!)).toBe(true);
        expect(turf.booleanPointInPolygon(selectedPoint, excluded!)).toBe(
            false,
        );
    });

    it("recalculates after stops are selected", async () => {
        mapGeoJSON.set(gameBoundary);
        const emptyQuestion = parseQuestion();
        expect(await determineMatchingBoundary(emptyQuestion)).toBe(false);

        const selectedQuestion = parseQuestion([selectedStop]);
        const excluded = await adjustPerMatching(
            { ...selectedQuestion, same: false },
            gameBoundary,
        );

        expect(
            turf.booleanPointInPolygon(
                turf.point(firstStop.geometry.coordinates),
                excluded!,
            ),
        ).toBe(false);
    });
});
