import * as turf from "@turf/turf";
import type { Feature, Geometry, MultiPolygon, Point, Polygon } from "geojson";
import _ from "lodash";
import osmtogeojson from "osmtogeojson";
import { toast } from "react-toastify";

import {
    hiderMode,
    mapGeoJSON,
    mapGeoLocation,
    polyGeoJSON,
} from "@/lib/context";
import {
    fetchCoastline,
    findPlacesInZone,
    getOverpassData,
    loadAdminBoundaries,
    loadPregeneratedPois,
    loadStaticMeasuringData,
    loadTransitStations,
    LOCATION_FIRST_TAG,
    nearestToQuestion,
    prettifyLocation,
} from "@/maps/api";
import { relevantDistanceLines } from "@/maps/distance-lines";
import {
    arcBufferToPoint,
    holedMask,
    modifyMapData,
    safeUnion,
} from "@/maps/geo-utils";
import {
    qualifiesAsHighSpeedRail,
    qualifiesAsHighSpeedTrainService,
} from "@/maps/rail-speed";
import type {
    APILocations,
    HomeGameMeasuringQuestions,
    MeasuringQuestion,
} from "@/maps/schema";

const osmTagForLocation = (location: APILocations) => {
    if (location === "amusement_park") {
        return { key: "tourism", value: "theme_park" };
    }

    return { key: LOCATION_FIRST_TAG[location], value: location };
};

const featureLines = (features: Feature[]) =>
    features.flatMap((feature) => {
        const type = turf.getType(feature);
        if (type === "Polygon" || type === "MultiPolygon") {
            const lines = turf.polygonToLine(feature as any);
            return lines.type === "FeatureCollection"
                ? lines.features
                : [lines];
        }
        return [feature];
    });

const UK_NATION_RELATION_IDS = {
    England: 58447,
    Scotland: 58446,
    Wales: 58437,
} as const;

const sharedRelationWayIds = (
    elements: any[],
    firstRelationId: number,
    secondRelationId: number,
) => {
    const wayIds = (relationId: number) =>
        new Set<number>(
            (
                elements.find(
                    (element) =>
                        element.type === "relation" &&
                        element.id === relationId,
                )?.members ?? []
            )
                .filter((member: any) => member.type === "way")
                .map((member: any) => member.ref),
        );
    const first = wayIds(firstRelationId);
    return new Set([...wayIds(secondRelationId)].filter((id) => first.has(id)));
};

const findLiveHighSpeedRailLines = async () => {
    const mapData = mapGeoJSON.get();
    if (!mapData) return [];
    const [longitude, latitude] = turf.center(mapData).geometry.coordinates;
    const data = await getOverpassData(
        `[out:json][timeout:120];
(
  way["railway"="rail"]["maxspeed"](around:100000,${latitude},${longitude});
  way["railway"="rail"]["highspeed"="yes"](around:100000,${latitude},${longitude});
)->.candidate;
(
  relation["type"="route"]["route"="train"]["operator"~"Grand Central|LNER|Lumo|London North Eastern Railway",i](around:100000,${latitude},${longitude});
  relation["type"="route"]["route"="train"]["ref"~"^GC( |$)"](around:100000,${latitude},${longitude});
)->.services;
(
  .candidate;
  .services;
  relation(bw.candidate)["type"="route"]["route"~"^(railway|train)$"];
);
out body geom;`,
        "Finding high-speed train lines...",
    );
    const qualifyingWayIds = new Set(
        (data.elements ?? [])
            .filter(
                (element: any) =>
                    element.type === "way" &&
                    qualifiesAsHighSpeedRail(element.tags ?? {}),
            )
            .map((element: any) => element.id),
    );
    const relatedQualifyingLines = (data.elements ?? []).filter(
        (element: any) =>
            element.type === "relation" &&
            (element.members ?? []).some(
                (member: any) =>
                    member.type === "way" && qualifyingWayIds.has(member.ref),
            ),
    );
    const physicalRailwayRelations = relatedQualifyingLines.filter(
        (relation: any) => relation.tags?.route === "railway",
    );
    const explicitHighSpeedServiceRelations = (data.elements ?? []).filter(
        (element: any) =>
            element.type === "relation" &&
            qualifiesAsHighSpeedTrainService(element.tags ?? {}),
    );
    const qualifyingRelationsById = new Map(
        [...physicalRailwayRelations, ...explicitHighSpeedServiceRelations].map(
            (relation: any) => [relation.id, relation],
        ),
    );
    if (qualifyingRelationsById.size === 0) {
        for (const relation of relatedQualifyingLines.filter(
            (element: any) => element.tags?.route === "train",
        )) {
            qualifyingRelationsById.set(relation.id, relation);
        }
    }
    const qualifyingRelations = [...qualifyingRelationsById.values()];
    const calculationBbox = turf.bbox(
        turf.buffer(turf.bboxPolygon(turf.bbox(mapData)), 16, {
            units: "miles",
        })!,
    );
    const linesByWay = new Map<string, Feature>();

    for (const relation of qualifyingRelations) {
        const routeName =
            relation.tags?.ref ??
            relation.tags?.name ??
            "High-Speed Train Line";
        for (const member of relation.members ?? []) {
            if (
                member.type !== "way" ||
                !Array.isArray(member.geometry) ||
                member.geometry.length < 2
            ) {
                continue;
            }
            const line = turf.lineString(
                member.geometry.map(({ lon, lat }: any) => [lon, lat]),
                {
                    name: "High-Speed Train Line",
                    osmWayId: member.ref,
                    routeNames: [routeName],
                },
            );
            try {
                const clipped = turf.bboxClip(line, calculationBbox);
                if (clipped.geometry.coordinates.length > 0) {
                    linesByWay.set(String(member.ref), clipped);
                }
            } catch {
                // The route does not intersect the local calculation area.
            }
        }
    }

    for (const element of data.elements ?? []) {
        if (
            element.type !== "way" ||
            !qualifyingWayIds.has(element.id) ||
            !Array.isArray(element.geometry) ||
            element.geometry.length < 2 ||
            linesByWay.has(String(element.id))
        ) {
            continue;
        }
        const line = turf.lineString(
            element.geometry.map(({ lon, lat }: any) => [lon, lat]),
            {
                name:
                    element.tags?.name ??
                    element.tags?.ref ??
                    "High-Speed Train Line",
                osmWayId: element.id,
            },
        );
        if (turf.booleanIntersects(line, turf.bboxPolygon(calculationBbox))) {
            linesByWay.set(String(element.id), line);
        }
    }

    return [...linesByWay.values()];
};

const staticMeasuringFeatures = _.memoize(
    async (type: Parameters<typeof loadStaticMeasuringData>[0]) =>
        loadStaticMeasuringData<Geometry>(type),
);

export const findMeasuringTransitStations = _.memoize(
    async (): Promise<Feature<Point>[]> => {
        try {
            const stations = await loadTransitStations();
            if (stations.length > 0) return stations;
        } catch {
            // Fall through to live OSM data.
        }

        const data = await findPlacesInZone(
            '["railway"="station"]',
            "Finding rail stations...",
            "nwr",
            "center",
            [],
            60,
        );
        return (data.elements ?? [])
            .map((element: any) => {
                const longitude = element.lon ?? element.center?.lon;
                const latitude = element.lat ?? element.center?.lat;
                if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) {
                    return null;
                }
                return turf.point([longitude, latitude], {
                    name:
                        element.tags?.["name:en"] ??
                        element.tags?.name ??
                        "Unnamed station",
                    osmId: String(element.id),
                });
            })
            .filter(Boolean) as Feature<Point>[];
    },
);

type RailMeasuringQuestion = Extract<
    MeasuringQuestion,
    { type: "rail-measure" }
>;

export const railStationTargetFromFeature = (station: Feature<Point>) => {
    const [longitude, latitude] = station.geometry.coordinates;
    return {
        id: String(
            station.properties?.osmId ??
                station.properties?.id ??
                `${latitude},${longitude}`,
        ),
        name: String(
            station.properties?.["name:en"] ??
                station.properties?.name ??
                "Unnamed station",
        ),
        latitude,
        longitude,
    };
};

export const resolveRailStationTarget = async (
    question: RailMeasuringQuestion,
) => {
    if (question.targetStation) {
        return turf.point(
            [question.targetStation.longitude, question.targetStation.latitude],
            {
                id: question.targetStation.id,
                name: question.targetStation.name,
            },
        );
    }

    // Compatibility for saved questions created before explicit targets were
    // added: their original nearest station becomes the fixed target.
    const stations = await findMeasuringTransitStations();
    if (stations.length === 0) return null;
    return turf.nearestPoint(
        turf.point([question.lng, question.lat]),
        turf.featureCollection(stations),
    );
};

const loadElevationSamples = _.memoize(
    async (): Promise<Feature<Point>[]> =>
        staticMeasuringFeatures("elevation-grid") as Promise<Feature<Point>[]>,
);

const staticElevationMeters = async (lat: number, lng: number) => {
    try {
        const samples = await loadElevationSamples();
        if (samples.length === 0) return null;
        const nearest = turf.nearestPoint(
            turf.point([lng, lat]),
            turf.featureCollection(samples),
        );
        const elevation = nearest.properties?.elevation;
        return typeof elevation === "number" ? elevation : null;
    } catch {
        return null;
    }
};

const findInternationalBorderFeatures = async (lat: number, lng: number) => {
    for (const radius of [25000, 50000, 100000, 250000, 500000]) {
        const data = await getOverpassData(
            `
[out:json][timeout:60];
relation(id:${Object.values(UK_NATION_RELATION_IDS).join(",")});
out body;
(
  way["boundary"="administrative"]["admin_level"="2"](around:${radius}, ${lat}, ${lng});
  way(r:${UK_NATION_RELATION_IDS.England})(around:${radius}, ${lat}, ${lng});
  way(r:${UK_NATION_RELATION_IDS.Scotland})(around:${radius}, ${lat}, ${lng});
  way(r:${UK_NATION_RELATION_IDS.Wales})(around:${radius}, ${lat}, ${lng});
);
out geom;
`,
            "Finding international borders...",
        );
        const elements = data.elements ?? [];
        const englandScotland = sharedRelationWayIds(
            elements,
            UK_NATION_RELATION_IDS.England,
            UK_NATION_RELATION_IDS.Scotland,
        );
        const englandWales = sharedRelationWayIds(
            elements,
            UK_NATION_RELATION_IDS.England,
            UK_NATION_RELATION_IDS.Wales,
        );
        const features = elements
            .filter(
                (element: any) =>
                    element.type === "way" &&
                    Array.isArray(element.geometry) &&
                    element.geometry.length >= 2 &&
                    element.tags?.maritime !== "yes" &&
                    (element.tags?.admin_level === "2" ||
                        englandScotland.has(element.id) ||
                        englandWales.has(element.id)),
            )
            .map((element: any) =>
                turf.lineString(
                    element.geometry.map(({ lon, lat }: any) => [lon, lat]),
                    {
                        ...element.tags,
                        name: englandScotland.has(element.id)
                            ? "England - Scotland"
                            : englandWales.has(element.id)
                              ? "England - Wales"
                              : (element.tags?.["name:en"] ??
                                element.tags?.name),
                        osmId: `way/${element.id}`,
                        ukNationBorder:
                            englandScotland.has(element.id) ||
                            englandWales.has(element.id),
                    },
                ),
            );
        if (features.length > 0) {
            return features;
        }
    }

    toast.error("No international border found nearby.");
    return [turf.multiLineString([])];
};

const fetchElevationMeters = async (lat: number, lng: number) => {
    const staticElevation = await staticElevationMeters(lat, lng);
    if (staticElevation !== null) return staticElevation;

    const response = await fetch(
        `https://api.open-meteo.com/v1/elevation?latitude=${lat}&longitude=${lng}`,
    );
    if (!response.ok) {
        throw new Error(
            `Elevation lookup failed: ${response.status} ${response.statusText}`,
        );
    }
    const data = await response.json();
    const elevation = Array.isArray(data.elevation)
        ? data.elevation[0]
        : data.elevation;
    return typeof elevation === "number" ? elevation : null;
};

const determineSeaLevelBoundary = _.memoize(
    async (question: MeasuringQuestion) => {
        let samples: Feature<Point>[];
        try {
            samples = await loadElevationSamples();
        } catch {
            return false;
        }
        if (samples.length === 0 || mapGeoJSON.get() === null) return false;

        const seekerElevation = await fetchElevationMeters(
            question.lat,
            question.lng,
        );
        if (seekerElevation === null) return false;

        const mapBbox = turf.bbox(mapGeoJSON.get()!);
        const calculationBbox = turf.bbox(
            turf.buffer(turf.bboxPolygon(mapBbox), 3, {
                units: "kilometers",
            })!,
        ) as [number, number, number, number];
        const relevantSamples = turf.featureCollection(
            samples.filter((sample) => {
                const [longitude, latitude] = sample.geometry.coordinates;
                return (
                    longitude >= calculationBbox[0] &&
                    longitude <= calculationBbox[2] &&
                    latitude >= calculationBbox[1] &&
                    latitude <= calculationBbox[3]
                );
            }),
        );
        if (relevantSamples.features.length === 0) return false;

        const voronoi = turf.voronoi(relevantSamples, {
            bbox: calculationBbox,
        });
        const closerToSeaLevel = voronoi.features.filter((feature) => {
            const elevation = feature.properties?.elevation;
            return (
                typeof elevation === "number" &&
                Math.abs(elevation) <= Math.abs(seekerElevation)
            );
        }) as Feature<Polygon>[];
        if (closerToSeaLevel.length === 0) return false;

        return turf.simplify(
            safeUnion(turf.featureCollection(closerToSeaLevel)),
            { tolerance: 0.0001, highQuality: true },
        );
    },
    (question) => `${question.lat},${question.lng}`,
);

const bboxExtension = (
    bBox: [number, number, number, number],
    distance: number,
): [number, number, number, number] => {
    const buffered = turf.bbox(
        turf.buffer(turf.bboxPolygon(bBox), Math.abs(distance), {
            units: "miles",
        })!,
    );

    const originalDeltaLat = bBox[3] - bBox[1];
    const originalDeltaLng = bBox[2] - bBox[0];

    return [
        buffered[0] - originalDeltaLng,
        buffered[1] - originalDeltaLat,
        buffered[2] + originalDeltaLng,
        buffered[3] + originalDeltaLat,
    ];
};

export const determineMeasuringBoundary = async (
    question: MeasuringQuestion,
) => {
    const bBox = turf.bbox(mapGeoJSON.get()!);

    switch (question.type) {
        case "highspeed-measure-shinkansen": {
            try {
                const features = await staticMeasuringFeatures(
                    "high-speed-rail-lines",
                );
                return features.length > 0 ? features : false;
            } catch {
                // Fall through to live OSM data.
            }

            const features = await findLiveHighSpeedRailLines();

            return features.length > 0 ? features : false;
        }
        case "international-border": {
            try {
                const features = await staticMeasuringFeatures(
                    "international-borders",
                );
                if (features.length > 0) return features;
            } catch {
                // Fall through to live OSM data.
            }
            return await findInternationalBorderFeatures(
                question.lat,
                question.lng,
            );
        }
        case "ward-border": {
            const boundaries = await loadAdminBoundaries(10);
            return featureLines(boundaries);
        }
        case "council-border": {
            const boundaries = await loadAdminBoundaries(8);
            const point = turf.point([question.lng, question.lat]);
            const containing = boundaries.find((boundary) =>
                turf.booleanPointInPolygon(point, boundary),
            );

            if (!containing) {
                toast.error(
                    "That point isn't inside any administration district.",
                );
                return [turf.multiLineString([])];
            }

            const boundaryLines = turf.polygonToLine(containing);
            return boundaryLines.type === "FeatureCollection"
                ? boundaryLines.features
                : [boundaryLines];
        }
        case "coastline": {
            const coastline = turf.lineToPolygon(
                await fetchCoastline(),
            ) as Feature<MultiPolygon>;

            const distanceToCoastline = turf.pointToPolygonDistance(
                turf.point([question.lng, question.lat]),
                coastline,
                {
                    units: "miles",
                    method: "geodesic",
                },
            );

            return [
                turf.difference(
                    turf.featureCollection([
                        turf.bboxPolygon(bBox),
                        turf.buffer(
                            turf.bboxClip(
                                coastline,
                                bBox
                                    ? bboxExtension(
                                          bBox as any,
                                          distanceToCoastline,
                                      )
                                    : [-180, -90, 180, 90],
                            ),
                            distanceToCoastline,
                            {
                                units: "miles",
                                steps: 64,
                            },
                        )!,
                    ]),
                )!,
            ];
        }
        case "airport":
            try {
                const features = await staticMeasuringFeatures("airports");
                if (features.length > 0) return features;
            } catch {
                // Fall through to live OSM data.
            }
            return [
                turf.combine(
                    turf.featureCollection(
                        _.uniqBy(
                            (
                                await findPlacesInZone(
                                    '["aeroway"="aerodrome"]["iata"]', // Only commercial airports have IATA codes,
                                    "Finding airports...",
                                )
                            ).elements,
                            (feature: any) => feature.tags.iata,
                        ).map((x: any) =>
                            turf.point([
                                x.center ? x.center.lon : x.lon,
                                x.center ? x.center.lat : x.lat,
                            ]),
                        ),
                    ),
                ).features[0],
            ];
        case "body-water": {
            try {
                const features = await staticMeasuringFeatures("body-water");
                if (features.length > 0) return features;
            } catch {
                // Fall through to live OSM data.
            }
            const data = await findPlacesInZone(
                '["natural"="water"]',
                "Finding bodies of water...",
                "nwr",
                "geom",
                [
                    '["water"="lake"]',
                    '["water"="reservoir"]',
                    '["waterway"="river"]',
                    '["waterway"="canal"]',
                    '["waterway"="stream"]',
                ],
                60,
            );
            return featureLines(osmtogeojson(data).features as Feature[]);
        }
        case "zoo_aquarium-full":
        case "amusement_park-full":
        case "peak-full":
        case "museum-full":
        case "hospital-full":
        case "cinema-full":
        case "library-full":
        case "golf_course-full":
        case "park-full": {
            const location = question.type.split("-full")[0] as APILocations;

            try {
                // Prefer the pre-generated local dataset (no Overpass call).
                const points = await loadPregeneratedPois(location);
                return [
                    turf.combine(turf.featureCollection(points)).features[0],
                ];
            } catch {
                // Local dataset missing — fall back to a live Overpass query.
            }

            const tag = osmTagForLocation(location);
            const data = await findPlacesInZone(
                `[${tag.key}=${tag.value}]`,
                `Finding ${prettifyLocation(location, true).toLowerCase()}...`,
                "nwr",
                "center",
                [],
                60,
            );

            if (data.remark && data.remark.startsWith("runtime error")) {
                toast.error(
                    `Error finding ${prettifyLocation(
                        location,
                        true,
                    ).toLowerCase()}. Please enable hiding zone mode and switch to the Large Game variation of this question.`,
                );
                return [turf.multiPolygon([])];
            }

            if (data.elements.length >= 1000) {
                toast.error(
                    `Too many ${prettifyLocation(
                        location,
                        true,
                    ).toLowerCase()} found (${data.elements.length}). Please enable hiding zone mode and switch to the Large Game variation of this question.`,
                );
                return [turf.multiPolygon([])];
            }

            return [
                turf.combine(
                    turf.featureCollection(
                        data.elements.map((x: any) =>
                            turf.point([
                                x.center ? x.center.lon : x.lon,
                                x.center ? x.center.lat : x.lat,
                            ]),
                        ),
                    ),
                ).features[0],
            ];
        }
        case "custom-measure":
            return turf.combine(
                turf.featureCollection((question as any).geo.features),
            ).features;
        case "zoo_aquarium":
        case "theme_park":
        case "peak":
        case "museum":
        case "hospital":
        case "cinema":
        case "library":
        case "golf_course":
        case "consulate":
        case "park":
            return false;
        case "rail-measure": {
            const target = await resolveRailStationTarget(question);
            return target ? [target] : false;
        }
        case "sea-level":
            return false;
    }
};

const bufferedDeterminer = _.memoize(
    async (question: MeasuringQuestion) => {
        const placeData = await determineMeasuringBoundary(question);

        if (placeData === false || placeData === undefined) return false;

        const bufferFeatures =
            question.type === "international-border" ||
            question.type === "ward-border"
                ? relevantDistanceLines(
                      placeData as Feature[],
                      [question.lng, question.lat],
                      mapGeoJSON.get()!,
                  )
                : placeData;

        return arcBufferToPoint(
            turf.featureCollection(bufferFeatures as any),
            question.lat,
            question.lng,
        );
    },
    (question) =>
        JSON.stringify({
            type: question.type,
            lat: question.lat,
            lng: question.lng,
            entirety: polyGeoJSON.get()
                ? polyGeoJSON.get()
                : mapGeoLocation.get(),
            geo: (question as any).geo,
            targetStation:
                question.type === "rail-measure"
                    ? question.targetStation
                    : undefined,
        }),
);

export const adjustPerMeasuring = async (
    question: MeasuringQuestion,
    mapData: any,
) => {
    if (mapData === null) return;

    if (question.type === "sea-level") {
        const boundary = await determineSeaLevelBoundary(question);
        if (boundary === false) return mapData;
        return modifyMapData(mapData, boundary, question.hiderCloser);
    }

    const buffer = await bufferedDeterminer(question);

    if (buffer === false) return mapData;

    return modifyMapData(mapData, buffer, question.hiderCloser);
};

export const hiderifyMeasuring = async (
    question: MeasuringQuestion,
    hider?: { latitude: number; longitude: number },
) => {
    const $hiderMode = hider ?? hiderMode.get();
    if ($hiderMode === false) {
        return question;
    }

    if (
        [
            "zoo_aquarium",
            "aquarium",
            "zoo",
            "theme_park",
            "peak",
            "museum",
            "hospital",
            "cinema",
            "library",
            "golf_course",
            "consulate",
            "park",
        ].includes(question.type)
    ) {
        const questionNearest = await nearestToQuestion(
            question as HomeGameMeasuringQuestions,
        );
        const hiderNearest = await nearestToQuestion({
            lat: $hiderMode.latitude,
            lng: $hiderMode.longitude,
            hiderCloser: true,
            type: (question as HomeGameMeasuringQuestions).type,
            drag: false,
            color: "black",
            collapsed: false,
            hidden: false,
        });

        question.hiderCloser =
            questionNearest.properties.distanceToPoint >
            hiderNearest.properties.distanceToPoint;

        return question;
    }

    if (question.type === "rail-measure") {
        const target = await resolveRailStationTarget(question);
        if (!target) return question;

        const seeker = turf.point([question.lng, question.lat]);
        const hider = turf.point([$hiderMode.longitude, $hiderMode.latitude]);
        const seekerDistance = turf.distance(seeker, target);
        const hiderDistance = turf.distance(hider, target);

        question.hiderCloser = hiderDistance < seekerDistance;
        return question;
    }

    if (question.type === "sea-level") {
        try {
            const seekerElevation = await fetchElevationMeters(
                question.lat,
                question.lng,
            );
            const hiderElevation = await fetchElevationMeters(
                $hiderMode.latitude,
                $hiderMode.longitude,
            );

            if (seekerElevation !== null && hiderElevation !== null) {
                question.hiderCloser =
                    Math.abs(hiderElevation) < Math.abs(seekerElevation);
            }
        } catch {
            toast.error("Could not look up elevation for sea level question.");
        }

        return question;
    }

    const $mapGeoJSON = mapGeoJSON.get();
    if ($mapGeoJSON === null) return question;

    let feature = null;

    try {
        feature = holedMask((await adjustPerMeasuring(question, $mapGeoJSON))!);
    } catch {
        try {
            feature = await adjustPerMeasuring(question, {
                type: "FeatureCollection",
                features: [holedMask($mapGeoJSON)],
            });
        } catch {
            return question;
        }
    }

    if (feature === null || feature === undefined) return question;

    const hiderPoint = turf.point([$hiderMode.longitude, $hiderMode.latitude]);

    if (turf.booleanPointInPolygon(hiderPoint, feature)) {
        question.hiderCloser = !question.hiderCloser;
    }

    return question;
};

export const measuringPlanningPolygon = async (question: MeasuringQuestion) => {
    try {
        if (question.type === "sea-level") {
            const boundary = await determineSeaLevelBoundary(question);
            return boundary === false ? false : turf.polygonToLine(boundary);
        }

        const buffered = await bufferedDeterminer(question);

        if (buffered === false) return false;

        return turf.polygonToLine(buffered);
    } catch {
        return false;
    }
};
