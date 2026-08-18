import * as turf from "@turf/turf";
import type {
    Feature,
    FeatureCollection,
    Geometry,
    LineString,
    MultiPolygon,
    Point,
    Polygon,
} from "geojson";
import _ from "lodash";
import osmtogeojson from "osmtogeojson";
import { toast } from "react-toastify";

import {
    additionalMapGeoLocations,
    mapGeoLocation,
    polyGeoJSON,
} from "@/lib/context";
import { safeUnion } from "@/maps/geo-utils";
import type { APILocations } from "@/maps/schema";

import { cacheFetch, determineCache } from "./cache";
import {
    LOCATION_FIRST_TAG,
    OVERPASS_API,
    OVERPASS_API_FALLBACK,
} from "./constants";
import type {
    EncompassingTentacleQuestionSchema,
    HomeGameMatchingQuestions,
    HomeGameMeasuringQuestions,
    QuestionSpecificLocation,
} from "./types";
import { CacheType } from "./types";

export const getOverpassData = async (
    query: string,
    loadingText?: string,
    cacheType: CacheType = CacheType.CACHE,
) => {
    const encodedQuery = encodeURIComponent(query);
    const primaryUrl = `${OVERPASS_API}?data=${encodedQuery}`;
    let response = await cacheFetch(primaryUrl, loadingText, cacheType);

    if (!response.ok) {
        // Try the fallback, but store the result under the primary URL key so future requests are served from cache without needing to fail-over again.
        try {
            const fallbackResponse = await cacheFetch(
                `${OVERPASS_API_FALLBACK}?data=${encodedQuery}`,
                loadingText,
                cacheType,
            );
            if (fallbackResponse.ok) {
                const cache = await determineCache(cacheType);
                await cache.put(primaryUrl, fallbackResponse.clone());
            }
            response = fallbackResponse;
        } catch {
            toast.error(
                `Could not load data from Overpass: ${response.status} ${response.statusText}`,
                { toastId: "overpass-error" },
            );
            return { elements: [] };
        }
    }

    if (!response.ok) {
        toast.error(
            `Could not load data from Overpass: ${response.status} ${response.statusText}`,
            { toastId: "overpass-error" },
        );
        return { elements: [] };
    }

    const data = await response.json();
    return data;
};

const poiDataUrl = (location: string) =>
    `${import.meta.env.BASE_URL.replace(/\/?$/, "/")}data/pois/${location}.geojson`;

const localDataUrl = (path: string) =>
    `${import.meta.env.BASE_URL.replace(/\/?$/, "/")}data/${path}`;

const localFeatureCollectionPromises = new Map<
    string,
    Promise<Feature<Geometry>[]>
>();

const fetchLocalFeatureCollection = async (
    path: string,
): Promise<Feature<Geometry>[]> => {
    const response = await fetch(localDataUrl(path));
    if (!response.ok) {
        throw new Error(
            `Failed to load static question data ${path}: ${response.status} ${response.statusText}`,
        );
    }
    const geo = (await response.json()) as FeatureCollection<Geometry>;
    return geo.features;
};

const loadLocalFeatureCollection = <G extends Geometry>(
    path: string,
): Promise<Feature<G>[]> => {
    let promise = localFeatureCollectionPromises.get(path);
    if (!promise) {
        promise = fetchLocalFeatureCollection(path).catch((error) => {
            localFeatureCollectionPromises.delete(path);
            throw error;
        });
        localFeatureCollectionPromises.set(path, promise);
    }
    return promise as Promise<Feature<G>[]>;
};

export type StaticMeasuringData =
    | "airports"
    | "high-speed-rail-lines"
    | "international-borders"
    | "coastline"
    | "body-water"
    | "elevation-grid";

export const loadStaticMeasuringData = async <G extends Geometry>(
    type: StaticMeasuringData,
) => loadLocalFeatureCollection<G>(`measuring/${type}.geojson`);

export const loadTransitStations = async () =>
    loadLocalFeatureCollection<Point>("transit-stations.geojson");

/**
 * Loads a pre-generated POI dataset (see scripts/generate-spoons-pois.mjs)
 * from the local /data/pois folder. Used by the "-full" matching/measuring
 * questions so they don't hammer the public Overpass API at runtime. Throws if
 * the dataset is missing, letting callers fall back to a live Overpass query.
 */
const pregeneratedPoiPromises = new Map<
    APILocations,
    Promise<Feature<Point>[]>
>();

const fetchPregeneratedPois = async (
    location: APILocations,
): Promise<Feature<Point>[]> => {
    if (location === "zoo_aquarium") {
        const [zoos, aquariums] = await Promise.all([
            loadPregeneratedPois("zoo"),
            loadPregeneratedPois("aquarium"),
        ]);
        return _.uniqBy([...zoos, ...aquariums], (feature) =>
            String(feature.properties?.name ?? ""),
        );
    }

    const response = await fetch(poiDataUrl(location));
    if (!response.ok) {
        throw new Error(
            `Failed to load pregenerated POIs for ${location}: ${response.status} ${response.statusText}`,
        );
    }
    const geo = (await response.json()) as FeatureCollection<Point>;
    return geo.features;
};

export const loadPregeneratedPois = (
    location: APILocations,
): Promise<Feature<Point>[]> => {
    let promise = pregeneratedPoiPromises.get(location);
    if (!promise) {
        promise = fetchPregeneratedPois(location).catch((error) => {
            pregeneratedPoiPromises.delete(location);
            throw error;
        });
        pregeneratedPoiPromises.set(location, promise);
    }
    return promise;
};

/**
 * Loads the pre-generated local administration-district boundaries (see
 * scripts/generate-admin-districts.mjs) used by the "same administration
 * district?" matching question. adminLevel 8 = councils (the 5 Tyne & Wear
 * boroughs), 10 = districts (electoral wards). Runs offline; no Overpass.
 */
export const loadAdminBoundaries = (
    adminLevel: 8 | 10,
): Promise<Feature<Polygon | MultiPolygon>[]> =>
    loadLocalFeatureCollection<Polygon | MultiPolygon>(
        adminLevel === 8 ? "admin-councils.geojson" : "admin-districts.geojson",
    );

export const loadStreetPathSamples = async (): Promise<Feature<Point>[]> => {
    return loadLocalFeatureCollection<Point>("street-path-samples.geojson");
};

export const loadStreetPathLines = async (): Promise<Feature<LineString>[]> => {
    return loadLocalFeatureCollection<LineString>("street-path-lines.geojson");
};

export const determineGeoJSON = async (
    osmId: string,
    osmTypeLetter: "W" | "R" | "N",
): Promise<any> => {
    const osmTypeMap: { [key: string]: string } = {
        W: "way",
        R: "relation",
        N: "node",
    };
    const osmType = osmTypeMap[osmTypeLetter];
    const query = `[out:json];${osmType}(${osmId});out geom;`;
    const data = await getOverpassData(
        query,
        "Loading map data...",
        CacheType.PERMANENT_CACHE,
    );
    const geo = osmtogeojson(data);
    return {
        ...geo,
        features: geo.features.filter(
            (feature: any) => feature.geometry.type !== "Point",
        ),
    };
};

export const findTentacleLocations = async (
    question: EncompassingTentacleQuestionSchema,
    text: string = "Determining tentacle locations...",
) => {
    // Guard against an invalid/empty radius (e.g. while the distance field is
    // mid-edit and momentarily blank). turf.convertLength throws on a
    // non-positive number, which would reject this promise and crash the
    // question sidebar; return no locations until a real value is entered.
    if (!Number.isFinite(question.radius) || question.radius <= 0) {
        return turf.points([]);
    }

    try {
        // Prefer the pre-generated local dataset: keep the named POIs within the
        // question's radius of its point (no Overpass call).
        const pois = await loadPregeneratedPois(
            question.locationType as APILocations,
        );
        const center = turf.point([question.lng, question.lat]);
        const radiusMeters = turf.convertLength(
            question.radius,
            question.unit,
            "meters",
        );
        const response = turf.points([]);
        for (const feature of pois) {
            const name = feature.properties?.name;
            if (!name) continue;
            const [lon, lat] = feature.geometry.coordinates as [number, number];
            if (
                turf.distance(center, turf.point([lon, lat]), {
                    units: "meters",
                }) > radiusMeters
            ) {
                continue;
            }
            if (
                response.features.find(
                    (existing: any) => existing.properties.name === name,
                )
            ) {
                continue;
            }
            response.features.push(turf.point([lon, lat], { name }));
        }
        return response;
    } catch {
        // Local dataset missing — fall back to a live Overpass query.
    }

    const query =
        question.locationType === "zoo_aquarium"
            ? `
[out:json][timeout:25];
(
    nwr["tourism"="zoo"](around:${turf.convertLength(
        question.radius,
        question.unit,
        "meters",
    )}, ${question.lat}, ${question.lng});
    nwr["tourism"="aquarium"](around:${turf.convertLength(
        question.radius,
        question.unit,
        "meters",
    )}, ${question.lat}, ${question.lng});
);
out center;
    `
            : `
[out:json][timeout:25];
nwr["${LOCATION_FIRST_TAG[question.locationType]}"="${question.locationType}"](around:${turf.convertLength(
                  question.radius,
                  question.unit,
                  "meters",
              )}, ${question.lat}, ${question.lng});
out center;
    `;
    const data = await getOverpassData(query, text);
    const elements = data.elements;
    const response = turf.points([]);
    elements.forEach((element: any) => {
        if (!element.tags["name"] && !element.tags["name:en"]) return;
        if (element.lat && element.lon) {
            const name = element.tags["name:en"] ?? element.tags["name"];
            if (
                response.features.find(
                    (feature: any) => feature.properties.name === name,
                )
            )
                return;
            response.features.push(
                turf.point([element.lon, element.lat], { name }),
            );
        }
        if (!element.center || !element.center.lon || !element.center.lat)
            return;
        const name = element.tags["name:en"] ?? element.tags["name"];
        if (
            response.features.find(
                (feature: any) => feature.properties.name === name,
            )
        )
            return;
        response.features.push(
            turf.point([element.center.lon, element.center.lat], { name }),
        );
    });
    return response;
};

export const findAdminBoundary = async (
    latitude: number,
    longitude: number,
    adminLevel: 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10,
) => {
    const query = `
[out:json];
is_in(${latitude}, ${longitude})->.a;
rel(pivot.a)["admin_level"="${adminLevel}"];
out geom;
    `;
    const data = await getOverpassData(query, "Determining matching zone...");
    const geo = osmtogeojson(data);
    return geo.features?.[0];
};

export const fetchCoastline = _.memoize(async () => {
    const response = await cacheFetch(
        import.meta.env.BASE_URL + "/coastline50.geojson",
        "Fetching coastline data...",
        CacheType.PERMANENT_CACHE,
    );
    const data = await response.json();
    return data;
});

export const findPlacesInZone = async (
    filter: string,
    loadingText?: string,
    searchType:
        | "node"
        | "way"
        | "relation"
        | "nwr"
        | "nw"
        | "wr"
        | "nr"
        | "area" = "nwr",
    outType: "center" | "geom" = "center",
    alternatives: string[] = [],
    timeoutDuration: number = 0,
) => {
    let query = "";
    const $polyGeoJSON = polyGeoJSON.get();
    if ($polyGeoJSON) {
        query = `
[out:json]${timeoutDuration != 0 ? `[timeout:${timeoutDuration}]` : ""};
(
${searchType}${filter}(poly:"${turf
            .getCoords($polyGeoJSON.features)
            .flatMap((polygon) => polygon.geometry.coordinates)
            .flat()
            .map((coord) => [coord[1], coord[0]].join(" "))
            .join(" ")}");
${
    alternatives.length > 0
        ? alternatives
              .map(
                  (alternative) =>
                      `${searchType}${alternative}(poly:"${turf
                          .getCoords($polyGeoJSON.features)
                          .flatMap((polygon) => polygon.geometry.coordinates)
                          .flat()
                          .map((coord) => [coord[1], coord[0]].join(" "))
                          .join(" ")}");`,
              )
              .join("\n")
        : ""
}
);
out ${outType};
`;
    } else {
        const primaryLocation = mapGeoLocation.get();
        const additionalLocations = additionalMapGeoLocations
            .get()
            .filter((entry) => entry.added)
            .map((entry) => entry.location);
        const allLocations = [primaryLocation, ...additionalLocations];
        const relationToAreaBlocks = allLocations
            .map((loc, idx) => {
                const regionVar = `.region${idx}`;
                return `relation(${loc.properties.osm_id});map_to_area->${regionVar};`;
            })
            .join("\n");
        const searchBlocks = allLocations
            .map((_, idx) => {
                const regionVar = `area.region${idx}`;
                const altQueries =
                    alternatives.length > 0
                        ? alternatives
                              .map(
                                  (alt) => `${searchType}${alt}(${regionVar});`,
                              )
                              .join("\n")
                        : "";
                return `
            ${searchType}${filter}(${regionVar});
            ${altQueries}
          `;
            })
            .join("\n");
        query = `
        [out:json]${timeoutDuration !== 0 ? `[timeout:${timeoutDuration}]` : ""};
        ${relationToAreaBlocks}
        (
        ${searchBlocks}
        );
        out ${outType};
        `;
    }
    const data = await getOverpassData(
        query,
        loadingText,
        CacheType.ZONE_CACHE,
    );
    const subtractedEntries = additionalMapGeoLocations
        .get()
        .filter((e) => !e.added);
    const subtractedPolygons = subtractedEntries.map((entry) => entry.location);
    if (subtractedPolygons.length > 0 && data && data.elements) {
        const turfPolys = await Promise.all(
            subtractedPolygons.map(
                async (location) =>
                    turf.combine(
                        await determineGeoJSON(
                            location.properties.osm_id.toString(),
                            location.properties.osm_type,
                        ),
                    ).features[0],
            ),
        );
        data.elements = data.elements.filter((el: any) => {
            const lon = el.center ? el.center.lon : el.lon;
            const lat = el.center ? el.center.lat : el.lat;
            if (typeof lon !== "number" || typeof lat !== "number")
                return false;
            const pt = turf.point([lon, lat]);
            return !turfPolys.some((poly) =>
                turf.booleanPointInPolygon(pt, poly as any),
            );
        });
    }
    return data;
};

export const findPlacesSpecificInZone = async (
    location: `${QuestionSpecificLocation}`,
) => {
    const locations = (
        await findPlacesInZone(
            location,
            `Finding ${
                location === '["brand:wikidata"="Q38076"]'
                    ? "McDonald's"
                    : "7-Elevens"
            }...`,
        )
    ).elements;
    return turf.featureCollection(
        locations.map((x: any) =>
            turf.point([
                x.center ? x.center.lon : x.lon,
                x.center ? x.center.lat : x.lat,
            ]),
        ),
    );
};

export const nearestToQuestion = async (
    question: HomeGameMatchingQuestions | HomeGameMeasuringQuestions,
) => {
    const questionPoint = turf.point([question.lng, question.lat]);
    try {
        const staticInstances = await loadPregeneratedPois(
            question.type as APILocations,
        );
        if (staticInstances.length > 0) {
            const nearest = turf.nearestPoint(
                questionPoint,
                turf.featureCollection(staticInstances),
            );
            nearest.properties.distanceToPoint = turf.distance(
                questionPoint,
                nearest,
            );
            return nearest;
        }
    } catch {
        // Fall back to the progressively wider live-data search below.
    }

    let radius = 30;
    let instances: any = { features: [] };
    while (instances.features.length === 0) {
        instances = await findTentacleLocations(
            {
                lat: question.lat,
                lng: question.lng,
                radius: radius,
                unit: "miles",
                location: false,
                locationType: question.type,
                drag: false,
                color: "black",
                collapsed: false,
                hidden: false,
            },
            "Finding matching locations...",
        );
        radius += 30;
    }
    return turf.nearestPoint(questionPoint, instances as any);
};

export const determineMapBoundaries = async () => {
    const mapGeoDatum = await Promise.all(
        [
            {
                location: mapGeoLocation.get(),
                added: true,
                base: true,
            },
            ...additionalMapGeoLocations.get(),
        ].map(async (location) => ({
            added: location.added,
            data: await determineGeoJSON(
                location.location.properties.osm_id.toString(),
                location.location.properties.osm_type,
            ),
        })),
    );

    let mapGeoData = turf.featureCollection([
        safeUnion(
            turf.featureCollection(
                mapGeoDatum
                    .filter((x) => x.added)
                    .flatMap((x) => x.data.features),
            ) as any,
        ),
    ]);

    const differences = mapGeoDatum.filter((x) => !x.added).map((x) => x.data);

    if (differences.length > 0) {
        mapGeoData = turf.featureCollection([
            turf.difference(
                turf.featureCollection([
                    mapGeoData.features[0],
                    ...differences.flatMap((x) => x.features),
                ]),
            )!,
        ]);
    }

    if (turf.coordAll(mapGeoData).length > 10000) {
        turf.simplify(mapGeoData, {
            tolerance: 0.0005,
            highQuality: true,
            mutate: true,
        });
    }

    return turf.combine(mapGeoData) as FeatureCollection<MultiPolygon>;
};
