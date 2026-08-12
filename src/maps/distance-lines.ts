import * as turf from "@turf/turf";
import type { Feature, Geometry, LineString, MultiLineString } from "geojson";

const CALCULATION_MARGIN_MILES = 1;

export const relevantDistanceLines = (
    lines: Feature[],
    seeker: [number, number],
    playableArea: Feature<Geometry>,
): Feature<LineString | MultiLineString>[] => {
    const cleaned = lines.map((line) => turf.cleanCoords(line)) as Feature<
        LineString | MultiLineString
    >[];
    if (cleaned.length <= 1) return cleaned;

    const seekerPoint = turf.point(seeker);
    const distances = cleaned.map((line) =>
        turf.pointToLineDistance(seekerPoint, line, { units: "miles" }),
    );
    const nearestDistance = Math.min(...distances);
    const calculationArea = turf.buffer(
        turf.bboxPolygon(turf.bbox(playableArea)),
        nearestDistance + CALCULATION_MARGIN_MILES,
        { units: "miles" },
    );
    const relevant = cleaned.filter((line) =>
        turf.booleanIntersects(line, calculationArea),
    );

    if (relevant.length === 0) {
        return [cleaned[distances.indexOf(nearestDistance)]];
    }

    const combined = turf.combine(turf.featureCollection(relevant)).features;
    return combined.map((line) =>
        turf.simplify(line, { tolerance: 0.0001, highQuality: true }),
    ) as Feature<LineString | MultiLineString>[];
};
