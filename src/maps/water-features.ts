import * as turf from "@turf/turf";
import type { Feature, Geometry, MultiPolygon, Polygon } from "geojson";

export const MINIMUM_UNNAMED_LAKE_POND_AREA_SQUARE_METERS = 500;

const featureName = (feature: Feature<Geometry>) => {
    const value = feature.properties?.["name:en"] ?? feature.properties?.name;
    if (typeof value !== "string") return null;
    const name = value.trim();
    return name && name.toLowerCase() !== "unnamed body of water" ? name : null;
};

const isLakeOrPond = (feature: Feature<Geometry>) => {
    const water = String(feature.properties?.water ?? "").toLowerCase();
    return (
        water === "lake" ||
        water === "pond" ||
        (feature.properties?.natural === "water" && water === "")
    );
};

export const bodyOfWaterAreaSquareMeters = (feature: Feature<Geometry>) => {
    if (
        feature.geometry.type !== "Polygon" &&
        feature.geometry.type !== "MultiPolygon"
    ) {
        return null;
    }
    const storedArea = Number(feature.properties?.areaSquareMeters);
    if (Number.isFinite(storedArea)) return storedArea;
    return turf.area(feature as Feature<Polygon | MultiPolygon>);
};

export const isEligibleBodyOfWater = (feature: Feature<Geometry>) => {
    if (featureName(feature)) return true;
    if (!isLakeOrPond(feature)) return false;

    const area = bodyOfWaterAreaSquareMeters(feature);
    return (
        area !== null && area >= MINIMUM_UNNAMED_LAKE_POND_AREA_SQUARE_METERS
    );
};
