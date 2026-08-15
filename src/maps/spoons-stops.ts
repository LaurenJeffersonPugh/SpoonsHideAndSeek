import type { Feature, FeatureCollection, Point } from "geojson";
import _ from "lodash";

export const TRANSIT_LINE_QUESTION =
    "Does the transit line I'm currently on stop at your hiding zone station?";

export type SpoonsStopProperties = {
    name?: string;
    "icon-color"?: string;
};

export type SpoonsStopFeature = Feature<Point, SpoonsStopProperties>;

export type SelectedTransitStop = {
    id: string;
    name: string;
    latitude: number;
    longitude: number;
};

const localStopsUrl = () =>
    `${import.meta.env.BASE_URL.replace(/\/?$/, "/")}data/stops.geojson`;

export const loadSpoonsStops = _.memoize(
    async (): Promise<SpoonsStopFeature[]> => {
        const response = await fetch(localStopsUrl());
        if (!response.ok) {
            throw new Error(
                `Failed to load valid game stops: ${response.status} ${response.statusText}`,
            );
        }
        const collection = (await response.json()) as FeatureCollection<
            Point,
            SpoonsStopProperties
        >;
        return collection.features;
    },
);

export const spoonsStopId = (stop: SpoonsStopFeature) => {
    const [longitude, latitude] = stop.geometry.coordinates;
    return `${latitude},${longitude}`;
};

export const selectedTransitStopFromFeature = (
    stop: SpoonsStopFeature,
): SelectedTransitStop => {
    const [longitude, latitude] = stop.geometry.coordinates;
    return {
        id: spoonsStopId(stop),
        name: stop.properties?.name ?? "Unnamed stop",
        latitude,
        longitude,
    };
};

export const isBusStop = (stop: SpoonsStopFeature) =>
    stop.properties?.["icon-color"] === "#9c27b0";

export const spoonsStopType = (stop: SpoonsStopFeature) =>
    isBusStop(stop) ? "Bus stop" : "Metro / rail / ferry stop";

export const transitLineStopsAt = (
    selectedStops: SelectedTransitStop[] | undefined,
    stopId: string,
) => selectedStops?.some((stop) => stop.id === stopId) ?? false;
