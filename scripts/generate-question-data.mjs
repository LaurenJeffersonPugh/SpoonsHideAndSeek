import fs from "node:fs/promises";
import path from "node:path";

import * as turf from "@turf/turf";
import osmtogeojson from "osmtogeojson";

const OVERPASS_ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
];
const BUFFER_MILES = 16;
const ELEVATION_GRID_DEGREES = 0.02;
const ELEVATION_BATCH_SIZE = 100;
const ELEVATION_BATCH_DELAY_MS = 6000;
const PURPOSE_BUILT_HIGH_SPEED_KMH = 250;
const UPGRADED_HIGH_SPEED_KMH = 190;
const HIGH_SPEED_TRAIN_OPERATORS = [
    "grand central",
    "lner",
    "lumo",
    "london north eastern railway",
];
const INTERNATIONAL_BORDER_RADIUS_METERS = 400000;
const UK_NATION_RELATION_IDS = {
    England: 58447,
    Scotland: 58446,
    Wales: 58437,
};
const elevationOnly = process.argv.includes("--elevation-only");
const osmOnly = process.argv.includes("--osm-only");
const transitOnly = process.argv.includes("--transit-only");
const internationalBorderOnly = process.argv.includes(
    "--international-border-only",
);

const root = process.cwd();
const dataDir = path.join(root, "public", "data");
const measuringDir = path.join(dataDir, "measuring");
const boundary = JSON.parse(
    await fs.readFile(path.join(dataDir, "game-boundary.geojson"), "utf8"),
);
const clipRegion = turf.buffer(boundary.features[0], BUFFER_MILES, {
    units: "miles",
});
const [west, south, east, north] = turf.bbox(clipRegion);
const bbox = `${south},${west},${north},${east}`;
const center = turf.center(boundary).geometry.coordinates;

await fs.mkdir(measuringDir, { recursive: true });

const sleep = (milliseconds) =>
    new Promise((resolve) => setTimeout(resolve, milliseconds));

const fetchOverpass = async (label, query) => {
    let lastError;
    for (let attempt = 0; attempt < 24; attempt++) {
        const endpoint =
            OVERPASS_ENDPOINTS[attempt % OVERPASS_ENDPOINTS.length];
        const wait = Math.min(
            10000 * (Math.floor(attempt / OVERPASS_ENDPOINTS.length) + 1),
            60000,
        );

        try {
            const response = await fetch(endpoint, {
                method: "POST",
                body: `data=${encodeURIComponent(query)}`,
                signal: AbortSignal.timeout(45000),
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded",
                },
            });
            if (response.ok) return await response.json();
            console.log(
                `  ${label}: ${endpoint} responded ${response.status}; waiting ${wait / 1000}s...`,
            );
            lastError = new Error(`${endpoint} responded ${response.status}`);
        } catch (error) {
            console.log(
                `  ${label}: ${endpoint} failed (${error?.message ?? error}); waiting ${wait / 1000}s...`,
            );
            lastError = error;
        }
        await sleep(wait);
    }
    throw lastError ?? new Error(`Unable to fetch ${label}`);
};

const normalizeName = (name) =>
    String(name ?? "")
        .toLocaleLowerCase("en-GB")
        .replace(/[^a-z0-9]+/g, " ")
        .trim();

const featureName = (properties) =>
    properties?.["name:en"] ?? properties?.name ?? null;

const parseRailSpeedKmh = (value) => {
    if (value === undefined || value === null) return null;
    const speeds = String(value)
        .split(/[;,]/)
        .map((part) => {
            const match = part.trim().match(/([0-9]+(?:\.[0-9]+)?)/);
            if (!match) return null;
            const speed = Number(match[1]);
            return /mph/i.test(part) ? speed * 1.609344 : speed;
        })
        .filter(Number.isFinite);
    return speeds.length > 0 ? Math.max(...speeds) : null;
};

const maximumRailSpeedKmh = (tags = {}) => {
    const speeds = [
        tags.maxspeed,
        tags["maxspeed:forward"],
        tags["maxspeed:backward"],
    ]
        .map(parseRailSpeedKmh)
        .filter(Number.isFinite);
    return speeds.length > 0 ? Math.max(...speeds) : null;
};

const qualifiesAsHighSpeedRail = (tags = {}) => {
    const speedKmh = maximumRailSpeedKmh(tags);
    if (speedKmh === null) return false;
    return (
        speedKmh >=
        (tags.highspeed === "yes"
            ? PURPOSE_BUILT_HIGH_SPEED_KMH
            : UPGRADED_HIGH_SPEED_KMH)
    );
};

const qualifiesAsHighSpeedTrainService = (tags = {}) => {
    if (tags.route !== "train") return false;
    if (tags.highspeed === "yes") return true;

    const operator = String(tags.operator ?? "").toLocaleLowerCase("en-GB");
    if (HIGH_SPEED_TRAIN_OPERATORS.some((name) => operator.includes(name))) {
        return true;
    }

    return /^GC(?:\s|$)/i.test(String(tags.ref ?? "").trim());
};

const pointFromFeature = (feature) => {
    if (feature.geometry?.type === "Point") return feature;
    if (
        feature.geometry?.type === "Polygon" ||
        feature.geometry?.type === "MultiPolygon"
    ) {
        return turf.pointOnFeature(feature);
    }
    return null;
};

const lineFeatures = (features) =>
    features.flatMap((feature) => {
        const geometryType = feature.geometry?.type;
        if (geometryType === "LineString") return [feature];
        if (geometryType === "MultiLineString") {
            return feature.geometry.coordinates.map((coordinates, index) =>
                turf.lineString(coordinates, {
                    ...feature.properties,
                    part: index,
                }),
            );
        }
        if (geometryType === "Polygon" || geometryType === "MultiPolygon") {
            const lines = turf.polygonToLine(feature);
            return lines.type === "FeatureCollection"
                ? lines.features
                : [lines];
        }
        return [];
    });

const withinClipRegion = (feature) => {
    try {
        return turf.booleanIntersects(feature, clipRegion);
    } catch {
        return false;
    }
};

const writeGeoJson = async (filePath, features) => {
    await fs.writeFile(
        filePath,
        `${JSON.stringify({ type: "FeatureCollection", features })}\n`,
    );
    console.log(
        `  ${path.relative(root, filePath)}: ${features.length} features`,
    );
};

const fetchOsmRelation = async (id) => {
    const response = await fetch(
        `https://api.openstreetmap.org/api/0.6/relation/${id}.json`,
        {
            headers: { "User-Agent": "SpoonsHideAndSeek/1.0" },
            signal: AbortSignal.timeout(30000),
        },
    );
    if (!response.ok) {
        throw new Error(`OpenStreetMap relation ${id}: ${response.status}`);
    }
    const data = await response.json();
    return data.elements.find(
        (element) => element.type === "relation" && element.id === id,
    );
};

const generateUkNationBorders = async () => {
    const relations = new Map(
        await Promise.all(
            Object.entries(UK_NATION_RELATION_IDS).map(async ([name, id]) => [
                name,
                await fetchOsmRelation(id),
            ]),
        ),
    );
    const wayIdsByNation = new Map(
        [...relations.entries()].map(([name, relation]) => [
            name,
            new Set(
                (relation?.members ?? [])
                    .filter((member) => member.type === "way")
                    .map((member) => member.ref),
            ),
        ]),
    );
    const englandWayIds = wayIdsByNation.get("England");
    const borderNamesByWayId = new Map();
    for (const otherNation of ["Scotland", "Wales"]) {
        for (const wayId of wayIdsByNation.get(otherNation)) {
            if (englandWayIds.has(wayId)) {
                borderNamesByWayId.set(wayId, `England - ${otherNation}`);
            }
        }
    }

    const nationBorderData = await fetchOverpass(
        "UK nation land borders",
        `[out:json][timeout:120];way(id:${[...borderNamesByWayId.keys()].join(",")});out geom tags;`,
    );
    return nationBorderData.elements
        .filter(
            (element) =>
                element.type === "way" &&
                Array.isArray(element.geometry) &&
                element.geometry.length >= 2 &&
                element.tags?.maritime !== "yes" &&
                borderNamesByWayId.has(element.id),
        )
        .map((element) =>
            turf.lineString(
                element.geometry.map(({ lon, lat }) => [lon, lat]),
                {
                    ...element.tags,
                    name: borderNamesByWayId.get(element.id),
                    osmId: `way/${element.id}`,
                    ukNationBorder: true,
                },
            ),
        );
};

const generateInternationalBorders = async () => {
    console.log("Fetching static land international-border data...");
    const internationalBorderData = await fetchOverpass(
        "land international borders",
        `[out:json][timeout:240];way["boundary"="administrative"]["admin_level"="2"](around:${INTERNATIONAL_BORDER_RADIUS_METERS},${center[1]},${center[0]});out geom tags;`,
    );
    const internationalBorders = lineFeatures(
        osmtogeojson(internationalBorderData).features,
    ).filter((feature) => feature.properties?.maritime !== "yes");
    internationalBorders.push(...(await generateUkNationBorders()));
    await writeGeoJson(
        path.join(measuringDir, "international-borders.geojson"),
        internationalBorders,
    );
};

if (internationalBorderOnly) {
    await generateInternationalBorders();
    console.log("Static land international-border generation complete.");
    process.exit(0);
}

if (!elevationOnly) {
    if (!transitOnly) {
        console.log("Fetching static airport data...");
        const airportData = await fetchOverpass(
            "airports",
            `[out:json][timeout:180];nwr["aeroway"="aerodrome"]["iata"](${bbox});out center tags;`,
        );
        const airportFeatures = airportData.elements
            .map((element) => {
                const longitude = element.lon ?? element.center?.lon;
                const latitude = element.lat ?? element.center?.lat;
                if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) {
                    return null;
                }
                return turf.point([longitude, latitude], {
                    name: featureName(element.tags) ?? element.tags?.iata,
                    iata: element.tags?.iata,
                    osmId: `${element.type}/${element.id}`,
                });
            })
            .filter(Boolean);
        await writeGeoJson(
            path.join(measuringDir, "airports.geojson"),
            airportFeatures,
        );
    }

    console.log("Fetching static transit routes and stations...");
    const transitData = await fetchOverpass(
        "transit",
        `[out:json][timeout:240];
relation["type"="route"]["route"~"^(train|subway|light_rail|tram)$"](${bbox})->.routes;
relation["type"="route"]["route"="railway"](${bbox})->.railways;
(
  nwr["railway"="station"](${bbox});
  .routes;
  .railways;
  way(r.routes)(${bbox});
  way(r.railways)(${bbox});
  node(r.routes)(${bbox});
  way["railway"="rail"]["maxspeed"](${bbox});
  way["railway"="rail"]["highspeed"="yes"](${bbox});
);
out body geom;`,
    );
    const transitGeoJson = osmtogeojson(transitData);
    const routeRelations = transitData.elements.filter(
        (element) =>
            element.type === "relation" &&
            ["train", "subway", "light_rail", "tram"].includes(
                element.tags?.route,
            ),
    );
    const railwayRelations = transitData.elements.filter(
        (element) =>
            element.type === "relation" && element.tags?.route === "railway",
    );
    const transitWays = new Map(
        transitData.elements
            .filter(
                (element) =>
                    element.type === "way" && Array.isArray(element.geometry),
            )
            .map((element) => [element.id, element]),
    );
    console.log(
        `  transit source: ${routeRelations.length} routes, ${transitWays.size} route ways`,
    );
    const relationLineFeatures = (relations) =>
        relations.flatMap((relation) => {
            const routeId = `relation/${relation.id}`;
            const name =
                relation.tags?.ref ??
                relation.tags?.name ??
                relation.tags?.route ??
                "Transit line";

            const memberLines = (relation.members ?? [])
                .filter((member) => member.type === "way")
                .map((member) => ({
                    member,
                    geometry:
                        Array.isArray(member.geometry) &&
                        member.geometry.length >= 2
                            ? member.geometry
                            : transitWays.get(member.ref)?.geometry,
                }))
                .filter(({ geometry }) => geometry?.length >= 2)
                .map(({ member, geometry }) =>
                    turf.lineString(
                        geometry.map(({ lon, lat }) => [lon, lat]),
                        { routeId, name, osmWayId: member.ref },
                    ),
                );

            return memberLines;
        });
    const transitLineCandidates = relationLineFeatures(routeRelations);
    const railwayLineCandidates = relationLineFeatures(railwayRelations);
    const railwayLinesInRegion = railwayLineCandidates.filter(withinClipRegion);
    const transitWayLines = [...transitWays.values()]
        .filter((way) => way.geometry.length >= 2)
        .map((way) =>
            turf.lineString(
                way.geometry.map(({ lon, lat }) => [lon, lat]),
                {
                    name: featureName(way.tags) ?? "Transit line",
                    osmWayId: way.id,
                },
            ),
        )
        .filter(withinClipRegion);
    const qualifyingHighSpeedWays = [...transitWays.values()].filter(
        (way) =>
            way.geometry.length >= 2 &&
            way.tags?.railway === "rail" &&
            qualifiesAsHighSpeedRail(way.tags),
    );
    const qualifyingHighSpeedWayIds = new Set(
        qualifyingHighSpeedWays.map((way) => way.id),
    );
    const taggedRailSpeeds = [...transitWays.values()].reduce((counts, way) => {
        const speed = maximumRailSpeedKmh(way.tags);
        if (speed === null) return counts;
        const label = `${Number(speed.toFixed(1))} km/h`;
        counts.set(label, (counts.get(label) ?? 0) + 1);
        return counts;
    }, new Map());
    const stationRouteLines =
        transitLineCandidates.length > 0
            ? transitLineCandidates.filter(withinClipRegion)
            : transitWayLines;
    const qualifyingTrackCorridors = qualifyingHighSpeedWays.map((way) =>
        turf.buffer(
            turf.lineString(way.geometry.map(({ lon, lat }) => [lon, lat])),
            30,
            { units: "meters" },
        ),
    );
    const findQualifyingRelationIds = (relations, relationLines) => {
        const relationIds = new Set(
            relations
                .filter((relation) =>
                    (relation.members ?? []).some(
                        (member) =>
                            member.type === "way" &&
                            qualifyingHighSpeedWayIds.has(member.ref),
                    ),
                )
                .map((relation) => `relation/${relation.id}`),
        );
        for (const routeLine of relationLines) {
            if (
                routeLine.properties.routeId &&
                !relationIds.has(routeLine.properties.routeId) &&
                qualifyingTrackCorridors.some((corridor) =>
                    turf.booleanIntersects(routeLine, corridor),
                )
            ) {
                relationIds.add(routeLine.properties.routeId);
            }
        }
        return relationIds;
    };
    const qualifyingRailwayRelationIds = findQualifyingRelationIds(
        railwayRelations,
        railwayLinesInRegion,
    );
    const qualifyingServiceRouteIds = findQualifyingRelationIds(
        routeRelations,
        stationRouteLines,
    );
    const explicitHighSpeedServiceRouteIds = new Set(
        routeRelations
            .filter((relation) =>
                qualifiesAsHighSpeedTrainService(relation.tags),
            )
            .map((relation) => `relation/${relation.id}`),
    );
    const serviceRouteIds =
        explicitHighSpeedServiceRouteIds.size > 0 ||
        qualifyingRailwayRelationIds.size > 0
            ? explicitHighSpeedServiceRouteIds
            : qualifyingServiceRouteIds;
    const qualifyingLineRelationIds = new Set([
        ...qualifyingRailwayRelationIds,
        ...serviceRouteIds,
    ]);
    const qualifyingLineRelationLines = [
        ...railwayLinesInRegion,
        ...stationRouteLines,
    ];
    const highSpeedRailByWay = new Map();
    const addHighSpeedLine = (line, routeName) => {
        const osmWayId = line.properties.osmWayId;
        const existing = highSpeedRailByWay.get(osmWayId);
        if (existing) {
            if (
                routeName &&
                !existing.properties.routeNames.includes(routeName)
            ) {
                existing.properties.routeNames.push(routeName);
            }
            return;
        }

        const way = transitWays.get(osmWayId);
        const speedKmh = maximumRailSpeedKmh(way?.tags);
        highSpeedRailByWay.set(
            osmWayId,
            turf.lineString(line.geometry.coordinates, {
                name:
                    featureName(way?.tags) ??
                    way?.tags?.ref ??
                    "High-Speed Train Line",
                osmWayId,
                maxspeedKmh:
                    speedKmh === null ? undefined : Number(speedKmh.toFixed(3)),
                purposeBuilt: way?.tags?.highspeed === "yes",
                routeNames: routeName ? [routeName] : [],
            }),
        );
    };

    for (const routeLine of qualifyingLineRelationLines) {
        if (!qualifyingLineRelationIds.has(routeLine.properties.routeId)) {
            continue;
        }
        addHighSpeedLine(routeLine, routeLine.properties.name);
    }
    for (const way of qualifyingHighSpeedWays) {
        const line = turf.lineString(
            way.geometry.map(({ lon, lat }) => [lon, lat]),
            { osmWayId: way.id },
        );
        if (withinClipRegion(line)) addHighSpeedLine(line);
    }
    const highSpeedRailLines = [...highSpeedRailByWay.values()];
    console.log(
        `  transit geometry: ${stationRouteLines.length} route-member lines for station matching`,
    );
    console.log(
        `  high-speed rail: ${qualifyingRailwayRelationIds.size} physical relations + ${serviceRouteIds.size} high-speed service relations, ${highSpeedRailLines.length} in-range track segments`,
    );
    console.log(
        `  tagged rail speeds: ${[...taggedRailSpeeds.entries()]
            .sort(([a], [b]) => Number.parseFloat(a) - Number.parseFloat(b))
            .map(([speed, count]) => `${speed} (${count})`)
            .join(", ")}`,
    );
    const transitNodes = new Map(
        transitData.elements
            .filter((element) => element.type === "node")
            .map((element) => [element.id, element]),
    );
    const routesByStationName = new Map();
    for (const relation of routeRelations) {
        const routeId = `relation/${relation.id}`;
        const routeName =
            relation.tags?.ref ?? relation.tags?.name ?? relation.tags?.route;
        for (const member of relation.members ?? []) {
            if (member.type !== "node") continue;
            const memberNode = transitNodes.get(member.ref);
            const stationName = featureName(memberNode?.tags);
            if (!stationName) continue;
            const key = normalizeName(stationName);
            const routes = routesByStationName.get(key) ?? new Map();
            routes.set(routeId, routeName);
            routesByStationName.set(key, routes);
        }
    }

    const stationFeatures = transitGeoJson.features
        .filter((feature) => feature.properties?.railway === "station")
        .map(pointFromFeature)
        .filter(Boolean)
        .map((feature) => {
            const name = featureName(feature.properties) ?? "Unnamed station";
            const directRoutes = routesByStationName.get(normalizeName(name));
            const nearbyRoutes = new Map(directRoutes ?? []);

            if (nearbyRoutes.size === 0) {
                for (const route of stationRouteLines) {
                    if (!route.properties.routeId) continue;
                    if (
                        turf.pointToLineDistance(feature, route, {
                            units: "meters",
                        }) <= 300
                    ) {
                        nearbyRoutes.set(
                            route.properties.routeId,
                            route.properties.name,
                        );
                    }
                }
            }

            const rawId = feature.properties?.id ?? feature.id;
            return turf.point(feature.geometry.coordinates.slice(0, 2), {
                name,
                osmId: rawId ? String(rawId).replace(/^node\//, "") : undefined,
                routeIds: [...nearbyRoutes.keys()],
                routeNames: [...nearbyRoutes.values()],
            });
        });
    await writeGeoJson(
        path.join(dataDir, "transit-stations.geojson"),
        stationFeatures,
    );
    await writeGeoJson(
        path.join(measuringDir, "high-speed-rail-lines.geojson"),
        highSpeedRailLines,
    );

    if (transitOnly) {
        console.log("Static transit data generation complete.");
        process.exit(0);
    }

    await generateInternationalBorders();

    console.log("Fetching static body-of-water geometry...");
    const waterData = await fetchOverpass(
        "bodies of water",
        `[out:json][timeout:240];
(
  nwr["natural"="water"](${bbox});
  nwr["water"~"^(lake|reservoir)$"](${bbox});
  way["waterway"~"^(river|canal|stream)$"](${bbox});
);
out geom tags;`,
    );
    const waterFeatures = osmtogeojson(waterData)
        .features.filter(withinClipRegion)
        .map((feature) => ({
            ...feature,
            properties: {
                name:
                    featureName(feature.properties) ?? "Unnamed body of water",
            },
        }));
    await writeGeoJson(
        path.join(measuringDir, "body-water.geojson"),
        waterFeatures,
    );
}

if (osmOnly) {
    console.log("Static OSM question data generation complete.");
    process.exit(0);
}

console.log("Fetching static elevation grid...");
const elevationCoordinates = [];
for (
    let latitude = south;
    latitude <= north;
    latitude += ELEVATION_GRID_DEGREES
) {
    for (
        let longitude = west;
        longitude <= east;
        longitude += ELEVATION_GRID_DEGREES
    ) {
        const point = turf.point([longitude, latitude]);
        if (!turf.booleanPointInPolygon(point, clipRegion)) continue;
        elevationCoordinates.push([
            Number(longitude.toFixed(6)),
            Number(latitude.toFixed(6)),
        ]);
    }
}

const elevationPartialPath = path.join(
    measuringDir,
    "elevation-grid.partial.geojson",
);
const elevationFeatures = [];
try {
    const partial = JSON.parse(await fs.readFile(elevationPartialPath, "utf8"));
    elevationFeatures.push(...(partial.features ?? []));
    console.log(`  elevation: resumed ${elevationFeatures.length} points`);
} catch {
    // No partial generation to resume.
}
const completedElevationCoordinates = new Set(
    elevationFeatures.map((feature) => feature.geometry.coordinates.join(",")),
);
const pendingElevationCoordinates = elevationCoordinates.filter(
    (coordinates) => !completedElevationCoordinates.has(coordinates.join(",")),
);
for (
    let index = 0;
    index < pendingElevationCoordinates.length;
    index += ELEVATION_BATCH_SIZE
) {
    const batch = pendingElevationCoordinates.slice(
        index,
        index + ELEVATION_BATCH_SIZE,
    );
    const url = new URL("https://api.open-meteo.com/v1/elevation");
    url.searchParams.set(
        "latitude",
        batch.map((coordinate) => coordinate[1]).join(","),
    );
    url.searchParams.set(
        "longitude",
        batch.map((coordinate) => coordinate[0]).join(","),
    );

    let response;
    for (let attempt = 0; attempt < 6; attempt++) {
        try {
            response = await fetch(url, {
                signal: AbortSignal.timeout(30000),
            });
            if (response.ok) break;
        } catch (error) {
            if (attempt === 5) throw error;
        }
        await sleep(Math.min(2000 * (attempt + 1), 10000));
    }
    if (!response?.ok) {
        throw new Error(
            `Elevation API responded ${response?.status} ${response?.statusText}`,
        );
    }
    const result = await response.json();
    const elevations = Array.isArray(result.elevation)
        ? result.elevation
        : [result.elevation];
    batch.forEach((coordinates, batchIndex) => {
        const elevation = elevations[batchIndex];
        if (!Number.isFinite(elevation)) return;
        elevationFeatures.push(turf.point(coordinates, { elevation }));
    });
    await writeGeoJson(elevationPartialPath, elevationFeatures);
    console.log(
        `  elevation: ${elevationFeatures.length}/${elevationCoordinates.length}`,
    );
    if (index + batch.length < pendingElevationCoordinates.length) {
        await sleep(ELEVATION_BATCH_DELAY_MS);
    }
}
await writeGeoJson(
    path.join(measuringDir, "elevation-grid.geojson"),
    elevationFeatures,
);
await fs.rm(elevationPartialPath, { force: true });

console.log("Static question data generation complete.");
