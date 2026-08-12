import * as turf from "@turf/turf";
import { describe, expect, it } from "vitest";

import { relevantInternationalBorders } from "@/maps/international-borders";

describe("international-border calculations", () => {
    it("combines nearby border segments and excludes distant borders", () => {
        const playableArea = turf.bboxPolygon([-0.1, -0.1, 0.1, 0.1]);
        const borders = [
            turf.lineString([
                [0.5, -1],
                [0.5, 0],
            ]),
            turf.lineString([
                [0.5, 0],
                [0.5, 1],
            ]),
            turf.lineString([
                [10, -1],
                [10, 1],
            ]),
        ];

        const relevant = relevantInternationalBorders(
            borders,
            [0, 0],
            playableArea,
        );

        expect(relevant).toHaveLength(1);
        expect(relevant[0].geometry.type).toBe("MultiLineString");
        expect(
            (relevant[0].geometry as GeoJSON.MultiLineString).coordinates,
        ).toHaveLength(2);
    });
});
