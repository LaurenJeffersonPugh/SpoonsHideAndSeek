import * as turf from "@turf/turf";
import type { Feature, Geometry, Position } from "geojson";

const EARTH_RADIUS_METERS = 6_371_008.8;
const METERS_PER_DEGREE = (Math.PI * EARTH_RADIUS_METERS) / 180;

type Coordinate = [number, number];

type DistanceState = {
    coordinate: Coordinate;
    longitudeScale: number;
    nearestPointDistance: number;
    nearestSegmentDistanceSquared: number;
    nearestSegment: [Coordinate, Coordinate] | null;
};

const asCoordinate = (position: Position): Coordinate | null => {
    const longitude = Number(position[0]);
    const latitude = Number(position[1]);
    return Number.isFinite(longitude) && Number.isFinite(latitude)
        ? [longitude, latitude]
        : null;
};

const haversineDistanceMeters = (first: Coordinate, second: Coordinate) => {
    const firstLatitude = (first[1] * Math.PI) / 180;
    const secondLatitude = (second[1] * Math.PI) / 180;
    const latitudeDelta = secondLatitude - firstLatitude;
    const longitudeDelta = ((second[0] - first[0]) * Math.PI) / 180;
    const haversine =
        Math.sin(latitudeDelta / 2) ** 2 +
        Math.cos(firstLatitude) *
            Math.cos(secondLatitude) *
            Math.sin(longitudeDelta / 2) ** 2;
    return (
        2 *
        EARTH_RADIUS_METERS *
        Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine))
    );
};

const updatePointDistance = (state: DistanceState, point: Coordinate) => {
    state.nearestPointDistance = Math.min(
        state.nearestPointDistance,
        haversineDistanceMeters(state.coordinate, point),
    );
};

const updateSegmentDistance = (
    state: DistanceState,
    start: Coordinate,
    end: Coordinate,
) => {
    const startX = (start[0] - state.coordinate[0]) * state.longitudeScale;
    const startY = (start[1] - state.coordinate[1]) * METERS_PER_DEGREE;
    const endX = (end[0] - state.coordinate[0]) * state.longitudeScale;
    const endY = (end[1] - state.coordinate[1]) * METERS_PER_DEGREE;
    const deltaX = endX - startX;
    const deltaY = endY - startY;
    const segmentLengthSquared = deltaX * deltaX + deltaY * deltaY;
    const fraction =
        segmentLengthSquared === 0
            ? 0
            : Math.max(
                  0,
                  Math.min(
                      1,
                      -(startX * deltaX + startY * deltaY) /
                          segmentLengthSquared,
                  ),
              );
    const nearestX = startX + fraction * deltaX;
    const nearestY = startY + fraction * deltaY;
    const distanceSquared = nearestX * nearestX + nearestY * nearestY;
    if (distanceSquared < state.nearestSegmentDistanceSquared) {
        state.nearestSegmentDistanceSquared = distanceSquared;
        state.nearestSegment = [start, end];
    }
};

const visitLine = (states: DistanceState[], positions: Position[]) => {
    let previous: Coordinate | null = null;
    for (const position of positions) {
        const coordinate = asCoordinate(position);
        if (!coordinate) continue;
        if (previous) {
            for (const state of states) {
                updateSegmentDistance(state, previous, coordinate);
            }
        } else {
            for (const state of states) updatePointDistance(state, coordinate);
        }
        previous = coordinate;
    }
};

const visitGeometry = (states: DistanceState[], geometry: Geometry) => {
    switch (geometry.type) {
        case "Point": {
            const coordinate = asCoordinate(geometry.coordinates);
            if (coordinate) {
                for (const state of states) {
                    updatePointDistance(state, coordinate);
                }
            }
            break;
        }
        case "MultiPoint":
            for (const position of geometry.coordinates) {
                const coordinate = asCoordinate(position);
                if (!coordinate) continue;
                for (const state of states) {
                    updatePointDistance(state, coordinate);
                }
            }
            break;
        case "LineString":
            visitLine(states, geometry.coordinates);
            break;
        case "MultiLineString":
        case "Polygon":
            for (const line of geometry.coordinates) visitLine(states, line);
            break;
        case "MultiPolygon":
            for (const polygon of geometry.coordinates) {
                for (const ring of polygon) visitLine(states, ring);
            }
            break;
        case "GeometryCollection":
            for (const child of geometry.geometries) {
                visitGeometry(states, child);
            }
            break;
    }
};

const stateDistanceMeters = (state: DistanceState) => {
    let distance = state.nearestPointDistance;
    if (state.nearestSegment) {
        distance = Math.min(
            distance,
            turf.pointToLineDistance(
                turf.point(state.coordinate),
                turf.lineString(state.nearestSegment),
                { units: "meters" },
            ),
        );
    }
    return distance;
};

export const nearestFeatureDistancesMeters = (
    features: Feature<Geometry>[],
    coordinates: Coordinate[],
) => {
    const states = coordinates.map<DistanceState>((coordinate) => ({
        coordinate,
        longitudeScale:
            METERS_PER_DEGREE * Math.cos((coordinate[1] * Math.PI) / 180),
        nearestPointDistance: Number.POSITIVE_INFINITY,
        nearestSegmentDistanceSquared: Number.POSITIVE_INFINITY,
        nearestSegment: null,
    }));

    for (const feature of features) {
        if (!feature.geometry) continue;
        if (
            feature.geometry.type === "Polygon" ||
            feature.geometry.type === "MultiPolygon"
        ) {
            for (const state of states) {
                if (
                    turf.booleanPointInPolygon(
                        turf.point(state.coordinate),
                        feature,
                    )
                ) {
                    state.nearestPointDistance = 0;
                }
            }
        }
        visitGeometry(states, feature.geometry);
    }

    return states.map(stateDistanceMeters);
};
