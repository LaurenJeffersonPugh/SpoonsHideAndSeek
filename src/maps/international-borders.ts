import * as turf from "@turf/turf";
import type { Feature, Geometry, LineString, MultiLineString } from "geojson";

const CALCULATION_MARGIN_MILES = 1;

export const relevantInternationalBorders = (
    borders: Feature[],
    seeker: [number, number],
    playableArea: Feature<Geometry>,
): Feature<LineString | MultiLineString>[] => {
    if (borders.length <= 1) {
        return borders as Feature<LineString | MultiLineString>[];
    }

    const seekerPoint = turf.point(seeker);
    const distances = borders.map((border) =>
        turf.pointToLineDistance(seekerPoint, border, { units: "miles" }),
    );
    const nearestDistance = Math.min(...distances);
    const calculationArea = turf.buffer(
        turf.bboxPolygon(turf.bbox(playableArea)),
        nearestDistance + CALCULATION_MARGIN_MILES,
        { units: "miles" },
    );
    const relevant = borders.filter((border) =>
        turf.booleanIntersects(border, calculationArea),
    ) as Feature<LineString | MultiLineString>[];

    if (relevant.length === 0) {
        return [
            borders[distances.indexOf(nearestDistance)] as Feature<
                LineString | MultiLineString
            >,
        ];
    }

    const combined = turf.combine(turf.featureCollection(relevant)).features;
    return combined.map((border) =>
        turf.simplify(border, { tolerance: 0.0001, highQuality: true }),
    ) as Feature<LineString | MultiLineString>[];
};
