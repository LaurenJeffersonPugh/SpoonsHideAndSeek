import * as turf from "@turf/turf";
import type { Feature, MultiPolygon } from "geojson";
import _ from "lodash";
import osmtogeojson from "osmtogeojson";
import { toast } from "react-toastify";

import {
    hiderMode,
    mapGeoJSON,
    mapGeoLocation,
    polyGeoJSON,
    trainStations,
} from "@/lib/context";
import {
    fetchCoastline,
    findPlacesInZone,
    getOverpassData,
    loadPregeneratedPois,
    LOCATION_FIRST_TAG,
    nearestToQuestion,
    prettifyLocation,
    loadAdminBoundaries,
} from "@/maps/api";
import {
    arcBufferToPoint,
    connectToSeparateLines,
    groupObjects,
    holedMask,
    modifyMapData,
} from "@/maps/geo-utils";
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

const findInternationalBorderFeatures = async (lat: number, lng: number) => {
    for (const radius of [25000, 50000, 100000, 250000, 500000]) {
        const data = await getOverpassData(
            `
[out:json][timeout:60];
(
  way["boundary"="administrative"]["admin_level"="2"](around:${radius}, ${lat}, ${lng});
  relation["boundary"="administrative"]["admin_level"="2"](around:${radius}, ${lat}, ${lng});
);
out geom;
`,
            "Finding international borders...",
        );
        const features = osmtogeojson(data).features as Feature[];
        if (features.length > 0) {
            return featureLines(features);
        }
    }

    toast.error("No international border found nearby.");
    return [turf.multiLineString([])];
};

const fetchElevationMeters = async (lat: number, lng: number) => {
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

const highSpeedBase = _.memoize(
    (features: Feature[]) => {
        const grouped = groupObjects(features);

        const neighbored = grouped
            .map((group) => {
                return turf.multiLineString(
                    connectToSeparateLines(
                        group
                            .filter((x) => turf.getType(x) === "LineString")
                            .map((x) => x.geometry.coordinates),
                    ),
                );
            })
            .filter((x) => x.geometry.coordinates.length > 0);

        return turf.combine(
            turf.buffer(
                turf.simplify(turf.featureCollection(neighbored), {
                    tolerance: 0.001,
                }),
                0.001,
            )!,
        ).features[0];
    },
    (features) => `${JSON.stringify(features.map((x) => x.geometry))}`,
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
            const features = osmtogeojson(
                await findPlacesInZone(
                    "[highspeed=yes]",
                    "Finding high-speed lines...",
                    "nwr",
                    "geom",
                ),
            ).features;

            return [highSpeedBase(features)];
        }
        case "international-border": {
            return await findInternationalBorderFeatures(
                question.lat,
                question.lng,
            );
        }
        case "council-border":
        case "ward-border": {
            const boundaries = await loadAdminBoundaries(
                question.type === "council-border" ? 8 : 10,
            );
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
        case "sea-level":
        case "theme_park":
        case "peak":
        case "museum":
        case "hospital":
        case "cinema":
        case "library":
        case "golf_course":
        case "consulate":
        case "park":
        case "rail-measure":
            return false;
    }
};

const bufferedDeterminer = _.memoize(
    async (question: MeasuringQuestion) => {
        const placeData = await determineMeasuringBoundary(question);

        if (placeData === false || placeData === undefined) return false;

        return arcBufferToPoint(
            turf.featureCollection(placeData as any),
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
        }),
);

export const adjustPerMeasuring = async (
    question: MeasuringQuestion,
    mapData: any,
) => {
    if (mapData === null) return;

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
        const stations = trainStations.get();

        if (stations.length === 0) {
            return question;
        }

        const location = turf.point([question.lng, question.lat]);

        const nearestTrainStation = turf.nearestPoint(
            location,
            turf.featureCollection(stations.map((x) => x.properties)),
        );

        const distance = turf.distance(location, nearestTrainStation);

        const hider = turf.point([$hiderMode.longitude, $hiderMode.latitude]);

        const hiderNearest = turf.nearestPoint(
            hider,
            turf.featureCollection(stations.map((x) => x.properties)),
        );

        const hiderDistance = turf.distance(hider, hiderNearest);

        question.hiderCloser = hiderDistance < distance;
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
        const buffered = await bufferedDeterminer(question);

        if (buffered === false) return false;

        return turf.polygonToLine(buffered);
    } catch {
        return false;
    }
};
