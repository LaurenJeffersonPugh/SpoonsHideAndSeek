import * as turf from "@turf/turf";
import type {
    Feature,
    FeatureCollection,
    LineString,
    MultiLineString,
    MultiPolygon,
    Point,
    Polygon,
} from "geojson";
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
    findPlacesInZone,
    getOverpassData,
    loadAdminBoundaries,
    loadPregeneratedPois,
    loadStreetPathLines,
    loadStreetPathSamples,
    loadTransitStations,
    LOCATION_FIRST_TAG,
    nearestToQuestion,
    prettifyLocation,
} from "@/maps/api";
import {
    geoSpatialVoronoi,
    holedMask,
    modifyMapData,
    safeUnion,
} from "@/maps/geo-utils";
import type {
    APILocations,
    HomeGameMatchingQuestions,
    MatchingQuestion,
} from "@/maps/schema";
import {
    loadSpoonsStops,
    spoonsStopId,
    transitLineStopsAt,
} from "@/maps/spoons-stops";
import { nearestStreetPathNameFromStaticIndex } from "@/maps/street-path-index";

const nearestStreetOrPathName = async (lat: number, lng: number) => {
    const radii = [100, 250, 500, 1000];

    for (const radius of radii) {
        const data = await getOverpassData(
            `
[out:json][timeout:25];
way["highway"]["name"](around:${radius}, ${lat}, ${lng});
out center tags;
`,
            "Finding nearby streets and paths...",
        );

        const hiderPoint = turf.point([lng, lat]);
        const candidates = (data.elements ?? [])
            .filter((element: any) => element.tags?.name)
            .map((element: any) => {
                const lon = element.center?.lon ?? element.lon;
                const pointLat = element.center?.lat ?? element.lat;
                if (typeof lon !== "number" || typeof pointLat !== "number") {
                    return null;
                }

                return turf.point([lon, pointLat], {
                    name: element.tags.name,
                });
            })
            .filter(Boolean);

        if (candidates.length > 0) {
            return turf.nearestPoint(
                hiderPoint,
                turf.featureCollection(candidates as any),
            ).properties.name as string;
        }
    }

    return null;
};

const STREET_PATH_SAMPLE_INTERVAL_METERS = 40;
const STREET_PATH_BOUNDARY_SAMPLE_INTERVAL_METERS = 10;
const STREET_PATH_BOUNDARY_MARGIN_METERS = 3000;
const STREET_PATH_BOUNDARY_JOIN_METERS = 8;
const STREET_PATH_BOUNDARY_SIMPLIFY_DEGREES = 0.00002;

const smoothStreetPathBoundary = (
    boundary: Feature<Polygon | MultiPolygon>,
) => {
    const expanded = turf.buffer(boundary, STREET_PATH_BOUNDARY_JOIN_METERS, {
        units: "meters",
        steps: 8,
    });
    if (!expanded) return boundary;

    const closed = turf.buffer(expanded, -STREET_PATH_BOUNDARY_JOIN_METERS, {
        units: "meters",
        steps: 8,
    });
    if (!closed) return boundary;

    return turf.simplify(closed, {
        tolerance: STREET_PATH_BOUNDARY_SIMPLIFY_DEGREES,
        highQuality: true,
    });
};

const denseSamplesNearStreetPath = (
    allLines: FeatureCollection<LineString>,
    streetPathLines: Feature<LineString>[],
    streetPathId: string,
    streetPathName: string,
) => {
    const [west, south, east, north] = turf.bbox(
        turf.featureCollection(streetPathLines),
    );
    const middleLatitude = (south + north) / 2;
    const latitudeMargin = STREET_PATH_BOUNDARY_MARGIN_METERS / 111_320;
    const longitudeMargin =
        STREET_PATH_BOUNDARY_MARGIN_METERS /
        (111_320 *
            Math.max(Math.cos(turf.degreesToRadians(middleLatitude)), 0.1));

    const calculationBbox: [number, number, number, number] = [
        west - longitudeMargin,
        south - latitudeMargin,
        east + longitudeMargin,
        north + latitudeMargin,
    ];

    const samplesByCoordinate = new Map<string, Feature<Point>>();
    const addSample = (
        coordinates: [number, number],
        properties: Record<string, unknown>,
        isSelectedStreetPath: boolean,
    ) => {
        const normalizedCoordinates: [number, number] = [
            Math.min(
                calculationBbox[2],
                Math.max(calculationBbox[0], Number(coordinates[0].toFixed(5))),
            ),
            Math.min(
                calculationBbox[3],
                Math.max(calculationBbox[1], Number(coordinates[1].toFixed(5))),
            ),
        ];
        const coordinateKey = normalizedCoordinates.join(",");
        if (!samplesByCoordinate.has(coordinateKey) || isSelectedStreetPath) {
            samplesByCoordinate.set(
                coordinateKey,
                turf.point(normalizedCoordinates, properties),
            );
        }
    };

    const sampleLine = (
        coordinates: [number, number][],
        properties: Record<string, unknown>,
        isSelectedStreetPath: boolean,
    ) => {
        if (coordinates.length < 2) return;
        const line = turf.lineString(coordinates, properties);
        const lengthMeters = turf.length(line, { units: "meters" });
        if (!Number.isFinite(lengthMeters) || lengthMeters <= 0) return;

        for (
            let distance = 0;
            distance < lengthMeters;
            distance += STREET_PATH_BOUNDARY_SAMPLE_INTERVAL_METERS
        ) {
            addSample(
                turf.along(line, distance, { units: "meters" }).geometry
                    .coordinates as [number, number],
                properties,
                isSelectedStreetPath,
            );
        }
        addSample(
            coordinates[coordinates.length - 1],
            properties,
            isSelectedStreetPath,
        );
    };

    const linesInCalculationArea = allLines.features.filter((feature) => {
        const [lineWest, lineSouth, lineEast, lineNorth] = turf.bbox(feature);
        return (
            lineEast >= calculationBbox[0] &&
            lineWest <= calculationBbox[2] &&
            lineNorth >= calculationBbox[1] &&
            lineSouth <= calculationBbox[3]
        );
    });

    // Add the selected component last so shared junction samples belong to it.
    linesInCalculationArea.sort(
        (featureA, featureB) =>
            Number(featureA.properties?.streetPathId === streetPathId) -
            Number(featureB.properties?.streetPathId === streetPathId),
    );

    for (const feature of linesInCalculationArea) {
        const clipped = turf.bboxClip(feature, calculationBbox) as Feature<
            LineString | MultiLineString
        >;
        const lineParts =
            clipped.geometry.type === "LineString"
                ? [clipped.geometry.coordinates]
                : clipped.geometry.coordinates;
        const properties = feature.properties ?? {};
        const isSelectedStreetPath = properties.streetPathId
            ? properties.streetPathId === streetPathId
            : properties.name === streetPathName;

        for (const coordinates of lineParts) {
            sampleLine(
                coordinates as [number, number][],
                properties,
                isSelectedStreetPath,
            );
        }
    }

    return {
        calculationBbox,
        samples: turf.featureCollection([...samplesByCoordinate.values()]),
    };
};

const findStreetOrPathSamplePointsInZone = _.memoize(
    async () => {
        try {
            const features = await loadStreetPathSamples();
            return turf.featureCollection(features);
        } catch {
            // Static street/path data has not been generated yet; fall back to
            // the cached Overpass lookup so development still works.
        }

        const data = await findPlacesInZone(
            '["highway"]["name"]',
            "Finding streets and paths...",
            "way",
            "geom",
            [],
            60,
        );

        const samplePoints: Feature<Point>[] = [];
        const seen = new Set<string>();

        const addSamplePoint = (
            name: string,
            coordinates: [number, number],
        ) => {
            const key = `${name}:${coordinates
                .map((coordinate) => coordinate.toFixed(5))
                .join(",")}`;
            if (seen.has(key)) return;
            seen.add(key);
            samplePoints.push(turf.point(coordinates, { name }));
        };

        for (const element of data.elements ?? []) {
            const name = element.tags?.name?.trim();
            const geometry = element.geometry;
            if (!name || !Array.isArray(geometry) || geometry.length < 2) {
                continue;
            }

            const coordinates = geometry
                .map((coordinate: any) => [coordinate.lon, coordinate.lat])
                .filter(
                    (coordinate: any) =>
                        typeof coordinate[0] === "number" &&
                        typeof coordinate[1] === "number",
                ) as [number, number][];
            if (coordinates.length < 2) continue;

            const line = turf.lineString(coordinates, { name });
            const lengthMeters = turf.length(line, { units: "meters" });
            if (!Number.isFinite(lengthMeters) || lengthMeters <= 0) continue;

            for (
                let distance = 0;
                distance < lengthMeters;
                distance += STREET_PATH_SAMPLE_INTERVAL_METERS
            ) {
                addSamplePoint(
                    name,
                    turf.along(line, distance, {
                        units: "meters",
                    }).geometry.coordinates as [number, number],
                );
            }

            addSamplePoint(name, coordinates[coordinates.length - 1]);
        }

        return turf.featureCollection(samplePoints);
    },
    () =>
        JSON.stringify({
            polyGeoJSON: polyGeoJSON.get(),
            mapGeoLocation: mapGeoLocation.get(),
        }),
);

const nearestStreetOrPathNameInZone = async (lat: number, lng: number) => {
    try {
        return await nearestStreetPathNameFromStaticIndex(lat, lng);
    } catch {
        // Fall through to the GeoJSON and live-data compatibility paths.
    }

    const streetPathSamples = await findStreetOrPathSamplePointsInZone();
    if (streetPathSamples.features.length === 0) {
        return nearestStreetOrPathName(lat, lng);
    }

    return turf.nearestPoint(turf.point([lng, lat]), streetPathSamples)
        .properties.name as string;
};

const findStreetOrPathLinesInZone = _.memoize(async () => {
    try {
        return turf.featureCollection(await loadStreetPathLines());
    } catch {
        return turf.featureCollection<LineString>([]);
    }
});

export const nearestStreetOrPathDetails = async (lat: number, lng: number) => {
    const name = await nearestStreetOrPathNameInZone(lat, lng);
    if (!name) return null;

    try {
        const lines = await findStreetOrPathLinesInZone();
        const matchingLines = lines.features.filter(
            (feature) => feature.properties?.name === name,
        );
        const point = turf.point([lng, lat]);
        const distanceMeters = Math.min(
            ...matchingLines.map((feature) =>
                turf.pointToLineDistance(point, feature, {
                    units: "meters",
                }),
            ),
        );
        return {
            name,
            distanceMeters: Number.isFinite(distanceMeters)
                ? distanceMeters
                : null,
        };
    } catch {
        return { name, distanceMeters: null };
    }
};

export const findTransitStationsInZone = _.memoize(
    async (): Promise<FeatureCollection<Point>> => {
        try {
            const stations = await loadTransitStations();
            if (stations.length > 0) {
                return turf.featureCollection(
                    _.uniqBy(stations, (station) =>
                        station.geometry.coordinates.join(","),
                    ),
                );
            }
        } catch {
            // Fall through to live OSM data.
        }

        return osmtogeojson(
            await findPlacesInZone(
                '["railway"="station"]',
                "Finding train stations...",
                "nwr",
                "center",
                [],
                60,
            ),
        ) as FeatureCollection<Point>;
    },
);

const stationName = (station: Feature<Point>) =>
    (station.properties?.["name:en"] ??
        station.properties?.name ??
        "") as string;

const selectedTransitLineBoundary = (
    question: Extract<MatchingQuestion, { type: "same-train-line" }>,
) => {
    const selectedStops = question.selectedStops ?? [];
    if (selectedStops.length === 0) return false;
    return safeUnion(
        turf.featureCollection(
            selectedStops.map((stop) =>
                turf.circle([stop.longitude, stop.latitude], 500, {
                    steps: 32,
                    units: "meters",
                    properties: { id: stop.id, name: stop.name },
                }),
            ),
        ),
    );
};

const stationMatchingBoundary = async (question: MatchingQuestion) => {
    const stations = await findTransitStationsInZone();
    if (stations.features.length === 0) return false;

    const seekerStation = turf.nearestPoint(
        turf.point([question.lng, question.lat]),
        stations,
    );
    const mapOrStations = mapGeoJSON.get() ?? stations;
    const calculationBbox = turf.bbox(
        turf.buffer(turf.bboxPolygon(turf.bbox(mapOrStations)), 3, {
            units: "kilometers",
        })!,
    ) as [number, number, number, number];
    const voronoi = turf.voronoi(stations, { bbox: calculationBbox });
    const seekerNameLength = stationName(seekerStation).length;
    const matchingCells = voronoi.features.filter((feature) => {
        const site = turf.point(feature.properties?.coordinates ?? [0, 0], {
            ...feature.properties,
        });

        const length = stationName(site).length;
        if (question.lengthComparison === "shorter") {
            return length < seekerNameLength;
        }
        if (question.lengthComparison === "longer") {
            return length > seekerNameLength;
        }
        return length === seekerNameLength;
    }) as Feature<Polygon>[];

    if (matchingCells.length === 0) return false;
    return safeUnion(turf.featureCollection(matchingCells));
};

export const findMatchingPlaces = async (question: MatchingQuestion) => {
    switch (question.type) {
        case "major-city": {
            return (
                await findPlacesInZone(
                    '[place=city]["population"~"^[1-9]+[0-9]{6}$"]', // The regex is faster than (if:number(t["population"])>1000000)
                    "Finding cities...",
                )
            ).elements.map((x: any) =>
                turf.point([
                    x.center ? x.center.lon : x.lon,
                    x.center ? x.center.lat : x.lat,
                ]),
            );
        }
        case "custom-points": {
            return question.geo!;
        }
        case "zoo_aquarium-full":
        case "theme_park-full":
        case "museum-full":
        case "hospital-full":
        case "cinema-full":
        case "library-full":
        case "golf_course-full":
        case "park-full": {
            const location = question.type.split("-full")[0] as APILocations;

            try {
                // Prefer the pre-generated local dataset (no Overpass call).
                return await loadPregeneratedPois(location);
            } catch {
                // Local dataset missing — fall back to a live Overpass query.
            }

            const data = await findPlacesInZone(
                `[${LOCATION_FIRST_TAG[location]}=${location}]`,
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
                return [];
            }

            if (data.elements.length >= 1000) {
                toast.error(
                    `Too many ${prettifyLocation(
                        location,
                        true,
                    ).toLowerCase()} found (${data.elements.length}). Please enable hiding zone mode and switch to the Large Game variation of this question.`,
                );
                return [];
            }

            return data.elements.map((x: any) =>
                turf.point([
                    x.center ? x.center.lon : x.lon,
                    x.center ? x.center.lat : x.lat,
                ]),
            );
        }
    }
};

export const determineMatchingBoundary = _.memoize(
    async (question: MatchingQuestion) => {
        let boundary;

        switch (question.type) {
            case "zoo_aquarium":
            case "theme_park":
            case "museum":
            case "hospital":
            case "cinema":
            case "library":
            case "golf_course":
            case "park":
            case "same-first-letter-station":
                return false;
            case "same-length-station": {
                return stationMatchingBoundary(question);
            }
            case "same-train-line":
                return selectedTransitLineBoundary(question);
            case "street-path": {
                const streetPathSamples =
                    await findStreetOrPathSamplePointsInZone();
                if (streetPathSamples.features.length === 0) return false;
                const streetPathLines = await findStreetOrPathLinesInZone();
                if (streetPathLines.features.length === 0) return false;

                const nearestSample = turf.nearestPoint(
                    turf.point([question.lng, question.lat]),
                    streetPathSamples,
                );
                const nearestName = nearestSample.properties.name as string;
                const linesByStreetPath = _.groupBy(
                    streetPathLines.features.filter(
                        (feature) => feature.properties?.name === nearestName,
                    ),
                    (feature) =>
                        feature.properties?.streetPathId ?? nearestName,
                );
                const matchingCells: Feature<Polygon | MultiPolygon>[] = [];

                for (const [streetPathId, lines] of Object.entries(
                    linesByStreetPath,
                )) {
                    const { calculationBbox, samples: nearbySamples } =
                        denseSamplesNearStreetPath(
                            streetPathLines,
                            lines,
                            streetPathId,
                            nearestName,
                        );
                    if (nearbySamples.features.length === 0) continue;
                    const voronoi = turf.voronoi(nearbySamples, {
                        bbox: calculationBbox,
                    });

                    const componentCells = voronoi.features.filter(
                        (feature) => {
                            return feature.properties?.streetPathId
                                ? feature.properties.streetPathId ===
                                      streetPathId
                                : feature.properties?.name === nearestName;
                        },
                    ) as Feature<Polygon | MultiPolygon>[];
                    if (componentCells.length === 0) continue;

                    matchingCells.push(
                        smoothStreetPathBoundary(
                            safeUnion(turf.featureCollection(componentCells)),
                        ),
                    );
                }

                if (matchingCells.length === 0) return false;

                boundary = safeUnion(turf.featureCollection(matchingCells));
                break;
            }
            case "custom-zone": {
                boundary = question.geo;
                break;
            }
            case "zone": {
                // Local Tyne & Wear boundaries (council = 8, district = 10).
                const districts = await loadAdminBoundaries(
                    question.cat.adminLevel,
                );
                const point = turf.point([question.lng, question.lat]);
                boundary = districts.find((district) =>
                    turf.booleanPointInPolygon(point, district),
                );

                if (!boundary) {
                    toast.error(
                        "That point isn't inside any administration district.",
                    );
                    throw new Error("No boundary found");
                }
                break;
            }
            case "letter-zone": {
                const districts = await loadAdminBoundaries(
                    question.cat.adminLevel,
                );
                const point = turf.point([question.lng, question.lat]);
                const containing = districts.find((district) =>
                    turf.booleanPointInPolygon(point, district),
                );

                if (!containing) {
                    toast.error(
                        "That point isn't inside any administration district.",
                    );
                    throw new Error("No boundary found");
                }

                const name = containing.properties?.name;
                if (!name || !/^[a-zA-Z]/.test(name)) {
                    toast.error("That district has no usable name.");
                    throw new Error("No usable name");
                }

                const letter = name[0].toUpperCase();

                // Union every district that starts with the same letter.
                boundary = safeUnion(
                    turf.featureCollection(
                        districts.filter(
                            (district) =>
                                (district.properties?.name ??
                                    "")[0]?.toUpperCase() === letter,
                        ),
                    ),
                );

                break;
            }
            case "major-city":
            case "zoo_aquarium-full":
            case "theme_park-full":
            case "museum-full":
            case "hospital-full":
            case "cinema-full":
            case "library-full":
            case "golf_course-full":
            case "park-full":
            case "custom-points": {
                const data = await findMatchingPlaces(question);

                const voronoi = geoSpatialVoronoi(data);
                const point = turf.point([question.lng, question.lat]);

                for (const feature of voronoi.features) {
                    if (turf.booleanPointInPolygon(point, feature)) {
                        boundary = feature;
                        break;
                    }
                }
                break;
            }
        }

        return boundary;
    },
    (question: MatchingQuestion & { geo?: unknown; cat?: unknown }) =>
        JSON.stringify({
            type: question.type,
            lat: question.lat,
            lng: question.lng,
            cat: question.cat,
            geo: question.geo,
            selectedStops:
                question.type === "same-train-line"
                    ? question.selectedStops.map((stop) => stop.id).sort()
                    : undefined,
            entirety: polyGeoJSON.get()
                ? polyGeoJSON.get()
                : mapGeoLocation.get(),
        }),
);

export const adjustPerMatching = async (
    question: MatchingQuestion,
    mapData: any,
) => {
    if (mapData === null) return;

    const boundary = await determineMatchingBoundary(question);

    if (boundary === false) {
        return mapData;
    }

    return modifyMapData(
        mapData,
        boundary,
        question.type === "same-length-station" ? true : question.same,
    );
};

export const hiderifyMatching = async (
    question: MatchingQuestion,
    hider?: { latitude: number; longitude: number },
) => {
    const $hiderMode = hider ?? hiderMode.get();
    if ($hiderMode === false) {
        return question;
    }

    if (
        [
            "zoo_aquarium",
            "theme_park",
            "museum",
            "hospital",
            "cinema",
            "library",
            "golf_course",
            "park",
        ].includes(question.type)
    ) {
        const questionNearest = await nearestToQuestion(
            question as HomeGameMatchingQuestions,
        );
        const hiderNearest = await nearestToQuestion({
            lat: $hiderMode.latitude,
            lng: $hiderMode.longitude,
            same: true,
            type: (question as HomeGameMatchingQuestions).type,
            drag: false,
            color: "black",
            collapsed: false,
            hidden: false,
        });

        question.same =
            questionNearest.properties.name === hiderNearest.properties.name;

        return question;
    }

    if (
        question.type === "same-first-letter-station" ||
        question.type === "same-length-station" ||
        question.type === "street-path"
    ) {
        const hiderPoint = turf.point([
            $hiderMode.longitude,
            $hiderMode.latitude,
        ]);
        const seekerPoint = turf.point([question.lng, question.lat]);

        if (question.type === "street-path") {
            const hiderStreet = await nearestStreetOrPathNameInZone(
                $hiderMode.latitude,
                $hiderMode.longitude,
            );
            const seekerStreet = await nearestStreetOrPathNameInZone(
                question.lat,
                question.lng,
            );

            question.hiderStreetPathName = hiderStreet ?? undefined;
            question.seekerStreetPathName = seekerStreet ?? undefined;

            if (hiderStreet && seekerStreet) {
                question.same = hiderStreet === seekerStreet;
            }

            return question;
        }

        const places = await findTransitStationsInZone();

        const nearestHiderTrainStation = turf.nearestPoint(hiderPoint, places);
        const nearestSeekerTrainStation = turf.nearestPoint(
            seekerPoint,
            places,
        );

        question.hiderStationName = stationName(nearestHiderTrainStation);
        question.seekerStationName = stationName(nearestSeekerTrainStation);

        const hiderEnglishName =
            nearestHiderTrainStation.properties["name:en"] ||
            nearestHiderTrainStation.properties.name;
        const seekerEnglishName =
            nearestSeekerTrainStation.properties["name:en"] ||
            nearestSeekerTrainStation.properties.name;

        if (!hiderEnglishName || !seekerEnglishName) {
            return question;
        }

        if (question.type === "same-first-letter-station") {
            if (
                hiderEnglishName[0].toUpperCase() ===
                seekerEnglishName[0].toUpperCase()
            ) {
                question.same = true;
            } else {
                question.same = false;
            }
        } else if (question.type === "same-length-station") {
            if (hiderEnglishName.length === seekerEnglishName.length) {
                question.lengthComparison = "same";
            } else if (hiderEnglishName.length < seekerEnglishName.length) {
                question.lengthComparison = "shorter";
            } else {
                question.lengthComparison = "longer";
            }
        }

        return question;
    }

    if (question.type === "same-train-line") {
        const stops = await loadSpoonsStops();
        if (stops.length === 0) return question;
        const nearestStop = turf.nearestPoint(
            turf.point([$hiderMode.longitude, $hiderMode.latitude]),
            turf.featureCollection(stops),
        );
        const stopId = spoonsStopId(nearestStop);
        question.hiderStationName = stationName(nearestStop);
        question.same = transitLineStopsAt(question.selectedStops, stopId);
        return question;
    }

    const $mapGeoJSON = mapGeoJSON.get();
    if ($mapGeoJSON === null) return question;

    let feature = null;

    try {
        feature = holedMask((await adjustPerMatching(question, $mapGeoJSON))!);
    } catch {
        try {
            feature = await adjustPerMatching(question, {
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
        question.same = !question.same;
    }

    return question;
};

export const matchingPlanningPolygon = async (question: MatchingQuestion) => {
    try {
        if (question.type === "street-path") {
            const streetPathLines = await findStreetOrPathLinesInZone();
            if (streetPathLines.features.length === 0) {
                return false;
            }

            const point = turf.point([question.lng, question.lat]);
            const nearestLine = _.minBy(streetPathLines.features, (feature) =>
                turf.pointToLineDistance(point, feature, {
                    units: "meters",
                }),
            );
            const nearestName = nearestLine?.properties?.name;
            if (!nearestName) return false;

            return turf.featureCollection(
                streetPathLines.features.filter(
                    (feature) => feature.properties?.name === nearestName,
                ),
            );
        }

        const boundary = await determineMatchingBoundary(question);

        if (boundary === false) {
            return false;
        }

        return turf.polygonToLine(boundary);
    } catch {
        return false;
    }
};
