import "leaflet/dist/leaflet.css";
import "leaflet-contextmenu/dist/leaflet.contextmenu.css";
import "leaflet-contextmenu";

import { useStore } from "@nanostores/react";
import * as turf from "@turf/turf";
import type { Feature, FeatureCollection, Point } from "geojson";
import type { MultiPolygon, Polygon as GeoJSONPolygon } from "geojson";
import * as L from "leaflet";
import { ChevronDown, ChevronUp } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { MapContainer, ScaleControl, TileLayer, useMap } from "react-leaflet";
import { toast } from "react-toastify";

import {
    additionalMapGeoLocations,
    addQuestion,
    animateMapMovements,
    autoZoom,
    baseTileLayer,
    followMe,
    hiderMode,
    isLoading,
    leafletMapContext,
    mapGeoJSON,
    permanentOverlay,
    planningModeEnabled,
    playerLocation,
    polyGeoJSON,
    questionFinishedMapData,
    questions,
    thunderforestApiKey,
    triggerLocalRefresh,
} from "@/lib/context";
import { cn } from "@/lib/utils";
import { applyQuestionsToMapGeoData, holedMask } from "@/maps";
import { hiderifyQuestion } from "@/maps";
import { CacheType, clearCache } from "@/maps/api";

import { DraggableMarkers } from "./DraggableMarkers";
import { LeafletFullScreenButton } from "./LeafletFullScreenButton";
import { MapPrint } from "./MapPrint";
import { PolygonDraw } from "./PolygonDraw";

const getTileLayer = (tileLayer: string, thunderforestApiKey: string) => {
    switch (tileLayer) {
        case "light":
            return (
                <TileLayer
                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors; &copy; <a href="https://carto.com/attributions">CARTO</a>; Powered by Esri and Turf.js'
                    url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
                    subdomains="abcd"
                    maxZoom={20} // This technically should be 6, but once the ratelimiting starts this can take over
                    minZoom={2}
                    noWrap
                />
            );

        case "dark":
            return (
                <TileLayer
                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors; &copy; <a href="https://carto.com/attributions">CARTO</a>; Powered by Esri and Turf.js'
                    url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
                    subdomains="abcd"
                    maxZoom={20} // This technically should be 6, but once the ratelimiting starts this can take over
                    minZoom={2}
                    noWrap
                />
            );

        case "transport":
            if (thunderforestApiKey)
                return (
                    <TileLayer
                        url={`https://tile.thunderforest.com/transport/{z}/{x}/{y}.png?apikey=${thunderforestApiKey}`}
                        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors; &copy; <a href="http://www.thunderforest.com/">Thunderforest</a>; Powered by Esri and Turf.js'
                        maxZoom={22}
                        minZoom={2}
                        noWrap
                    />
                );
            break;

        case "neighbourhood":
            if (thunderforestApiKey)
                return (
                    <TileLayer
                        url={`https://tile.thunderforest.com/neighbourhood/{z}/{x}/{y}.png?apikey=${thunderforestApiKey}`}
                        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors; &copy; <a href="http://www.thunderforest.com/">Thunderforest</a>; Powered by Esri and Turf.js'
                        maxZoom={22}
                        minZoom={2}
                        noWrap
                    />
                );
            break;

        case "osmcarto":
            return (
                <TileLayer
                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors; Powered by Esri and Turf.js'
                    url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
                    maxZoom={19}
                    minZoom={2}
                    noWrap
                />
            );
    }

    return (
        <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors; &copy; <a href="https://carto.com/attributions">CARTO</a>; Powered by Esri and Turf.js'
            url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
            subdomains="abcd"
            maxZoom={20} // This technically should be 6, but once the ratelimiting starts this can take over
            minZoom={2}
            noWrap
        />
    );
};

type SpoonsStopProperties = {
    name?: string;
    "icon-color"?: string;
};

type SpoonsBoundaryGeometry = GeoJSONPolygon | MultiPolygon;
type SpoonsStopFeature = Feature<Point, SpoonsStopProperties>;
type SpoonsStopCollection = FeatureCollection<Point, SpoonsStopProperties>;
type SpoonsBoundaryCollection = FeatureCollection<SpoonsBoundaryGeometry>;
type SpoonsStopType = "Bus stop" | "Metro / rail / ferry stop";

type SpoonsLocation = {
    latitude: number;
    longitude: number;
    accuracy: number;
    timestamp: number;
};

type NearbySpoonsStop = {
    distanceMetres: number;
    feature: SpoonsStopFeature;
    stopType: SpoonsStopType;
};

const spoonsDataUrl = (filename: string) =>
    `${import.meta.env.BASE_URL.replace(/\/?$/, "/")}data/${filename}`;

const isBusStop = (feature: Feature<Point, SpoonsStopProperties>) =>
    feature.properties?.["icon-color"] === "#9c27b0";

const getSpoonsStopType = (feature: SpoonsStopFeature): SpoonsStopType =>
    isBusStop(feature) ? "Bus stop" : "Metro / rail / ferry stop";

const formatDistanceMetres = (distanceMetres: number) =>
    `${Math.round(distanceMetres)} m`;

const getLocationErrorMessage = (error: GeolocationPositionError) => {
    switch (error.code) {
        case error.PERMISSION_DENIED:
            return "Location permission is blocked. Allow location access for this site.";
        case error.POSITION_UNAVAILABLE:
            return "Your current location is unavailable. Check location services.";
        case error.TIMEOUT:
            return "Still waiting for a GPS fix. Try moving near a window or tap Retry GPS.";
        default:
            return error.message;
    }
};

const createStopPopup = (name: string, stopType: SpoonsStopType) => {
    const container = document.createElement("div");
    const title = document.createElement("strong");
    const type = document.createElement("div");

    title.textContent = name;
    type.textContent = stopType;

    container.append(title, type);

    return container;
};

const loadSpoonsGameData = async (signal: AbortSignal) => {
    const [boundaryResponse, stopsResponse] = await Promise.all([
        fetch(spoonsDataUrl("game-boundary.geojson"), {
            signal,
        }),
        fetch(spoonsDataUrl("stops.geojson"), {
            signal,
        }),
    ]);

    if (!boundaryResponse.ok) {
        throw new Error(
            `Failed to load game-boundary.geojson: ${boundaryResponse.status} ${boundaryResponse.statusText}`,
        );
    }

    if (!stopsResponse.ok) {
        throw new Error(
            `Failed to load stops.geojson: ${stopsResponse.status} ${stopsResponse.statusText}`,
        );
    }

    const boundaryGeoJson =
        (await boundaryResponse.json()) as SpoonsBoundaryCollection;
    const stopsGeoJson = (await stopsResponse.json()) as SpoonsStopCollection;

    return { boundaryGeoJson, stopsGeoJson };
};

const SpoonsGameLayers = () => {
    const map = useMap();

    useEffect(() => {
        const controller = new AbortController();
        let boundaryLayer: L.GeoJSON | null = null;
        let stopsLayer: L.GeoJSON | null = null;

        const loadSpoonsGameLayers = async () => {
            try {
                const { boundaryGeoJson, stopsGeoJson } =
                    await loadSpoonsGameData(controller.signal);

                if (controller.signal.aborted) return;

                mapGeoJSON.set(boundaryGeoJson);
                polyGeoJSON.set(boundaryGeoJson);
                void clearCache(CacheType.ZONE_CACHE);
                questions.set([...questions.get()]);

                boundaryLayer = L.geoJSON(boundaryGeoJson, {
                    style: {
                        color: "#111827",
                        fillColor: "#111827",
                        fillOpacity: 0.05,
                        weight: 3,
                    },
                }).addTo(map);

                const boundaryBounds = boundaryLayer.getBounds();
                if (boundaryBounds.isValid()) {
                    map.fitBounds(boundaryBounds);
                }

                stopsLayer = L.geoJSON(stopsGeoJson, {
                    pointToLayer(feature, latlng) {
                        const stopFeature = feature as Feature<
                            Point,
                            SpoonsStopProperties
                        >;
                        const busStop = isBusStop(stopFeature);
                        const fillColor = busStop ? "#9c27b0" : "#ffea00";

                        return L.circleMarker(latlng, {
                            color: "#111827",
                            fillColor,
                            fillOpacity: 0.9,
                            radius: 5,
                            weight: 1,
                        });
                    },
                    onEachFeature(feature, layer) {
                        const stopFeature = feature as SpoonsStopFeature;
                        const stopType = getSpoonsStopType(stopFeature);

                        layer.bindPopup(
                            createStopPopup(
                                stopFeature.properties?.name ?? "Unnamed stop",
                                stopType,
                            ),
                        );
                    },
                }).addTo(map);
            } catch (error) {
                if (controller.signal.aborted) return;

                console.error("Failed to load Spoons game layers", error);
            }
        };

        void loadSpoonsGameLayers();

        return () => {
            controller.abort();

            if (boundaryLayer) {
                map.removeLayer(boundaryLayer);
            }

            if (stopsLayer) {
                map.removeLayer(stopsLayer);
            }
        };
    }, [map]);

    return null;
};

const SpoonsLocationStatus = () => {
    const map = useMap();
    const markerRef = useRef<L.Marker | null>(null);
    const accuracyCircleRef = useRef<L.Circle | null>(null);
    const [location, setLocation] = useState<SpoonsLocation | null>(null);
    const [locationError, setLocationError] = useState<string | null>(null);
    const [boundaryGeoJson, setBoundaryGeoJson] =
        useState<SpoonsBoundaryCollection | null>(null);
    const [stopsGeoJson, setStopsGeoJson] =
        useState<SpoonsStopCollection | null>(null);
    const [dataError, setDataError] = useState<string | null>(null);
    const [gpsRetryCount, setGpsRetryCount] = useState(0);
    const [collapsed, setCollapsed] = useState(false);

    useEffect(() => {
        if (!navigator.geolocation) {
            setLocationError("Geolocation is not supported by this browser.");
            return;
        }

        const watchId = navigator.geolocation.watchPosition(
            (position) => {
                setLocation({
                    latitude: position.coords.latitude,
                    longitude: position.coords.longitude,
                    accuracy: position.coords.accuracy,
                    timestamp: position.timestamp,
                });
                playerLocation.set({
                    latitude: position.coords.latitude,
                    longitude: position.coords.longitude,
                    accuracy: position.coords.accuracy,
                });
                setLocationError(null);
            },
            (error) => {
                setLocationError(getLocationErrorMessage(error));
            },
            {
                enableHighAccuracy: true,
                maximumAge: 10000,
                timeout: 60000,
            },
        );

        return () => {
            navigator.geolocation.clearWatch(watchId);
            playerLocation.set(null);
        };
    }, [gpsRetryCount]);

    useEffect(() => {
        const controller = new AbortController();

        const loadSpoonsLocationData = async () => {
            try {
                const { boundaryGeoJson, stopsGeoJson } =
                    await loadSpoonsGameData(controller.signal);

                if (controller.signal.aborted) return;

                setBoundaryGeoJson(boundaryGeoJson);
                setStopsGeoJson(stopsGeoJson);
                setDataError(null);
            } catch (error) {
                if (controller.signal.aborted) return;

                const message =
                    error instanceof Error ? error.message : String(error);
                setDataError(message);
                console.error(
                    "Failed to load Spoons location status data",
                    error,
                );
            }
        };

        void loadSpoonsLocationData();

        return () => controller.abort();
    }, []);

    useEffect(() => {
        if (!location) return;

        const latLng: L.LatLngExpression = [
            location.latitude,
            location.longitude,
        ];

        if (markerRef.current) {
            markerRef.current.setLatLng(latLng);
        } else {
            markerRef.current = L.marker(latLng, {
                icon: L.divIcon({
                    html: '<div class="w-4 h-4 rounded-full bg-sky-600 border-2 border-white shadow ring-2 ring-sky-600"></div>',
                    className: "",
                    iconAnchor: [8, 8],
                }),
                zIndexOffset: 1200,
            }).addTo(map);
        }

        if (accuracyCircleRef.current) {
            accuracyCircleRef.current.setLatLng(latLng);
            accuracyCircleRef.current.setRadius(location.accuracy);
        } else {
            accuracyCircleRef.current = L.circle(latLng, {
                radius: location.accuracy,
                color: "#0284c7",
                fillColor: "#38bdf8",
                fillOpacity: 0.12,
                opacity: 0.45,
                weight: 1,
            }).addTo(map);
        }
    }, [location, map]);

    useEffect(() => {
        return () => {
            if (markerRef.current) {
                map.removeLayer(markerRef.current);
                markerRef.current = null;
            }

            if (accuracyCircleRef.current) {
                map.removeLayer(accuracyCircleRef.current);
                accuracyCircleRef.current = null;
            }
        };
    }, [map]);

    const status = useMemo(() => {
        if (!location || !boundaryGeoJson || !stopsGeoJson) {
            return {
                inBoundary: null as boolean | null,
                nearbyStops: [] as NearbySpoonsStop[],
                valid: null as boolean | null,
            };
        }

        const playerPoint = turf.point([location.longitude, location.latitude]);
        const inBoundary = boundaryGeoJson.features.some((feature) =>
            turf.booleanPointInPolygon(playerPoint, feature),
        );
        const nearbyStops = stopsGeoJson.features
            .map((feature) => ({
                distanceMetres: turf.distance(playerPoint, feature, {
                    units: "meters",
                }),
                feature,
                stopType: getSpoonsStopType(feature),
            }))
            .filter((stop) => stop.distanceMetres <= 500)
            .sort((a, b) => a.distanceMetres - b.distanceMetres);

        return {
            inBoundary,
            nearbyStops,
            valid: inBoundary && nearbyStops.length > 0,
        };
    }, [boundaryGeoJson, location, stopsGeoJson]);

    const visibleStops = status.nearbyStops.slice(0, 8);
    const hiddenStopCount = Math.max(status.nearbyStops.length - 8, 0);
    const gameDataLoaded = Boolean(boundaryGeoJson && stopsGeoJson);
    const boundaryText =
        status.inBoundary === null
            ? "Unknown"
            : status.inBoundary
              ? "Yes"
              : "No";
    const nearbyStopsText =
        status.valid === null
            ? "Unknown"
            : status.nearbyStops.length > 0
              ? "Yes"
              : "No";
    const lastChecked = location
        ? new Date(location.timestamp).toLocaleTimeString()
        : "Unknown";
    const statusLabel =
        status.valid === null ? "UNKNOWN" : status.valid ? "VALID" : "INVALID";
    const waitingText = !gameDataLoaded
        ? "Loading game data."
        : !location
          ? "Game data loaded. Waiting for GPS fix."
          : "No valid stops within 500 m.";

    return (
        <div className="pointer-events-none absolute inset-x-2 bottom-24 z-[1000] flex justify-center sm:inset-x-auto sm:bottom-3 sm:left-3 sm:right-3">
            {collapsed ? (
                <button
                    type="button"
                    onClick={() => setCollapsed(false)}
                    aria-label="Expand hiding status"
                    className="pointer-events-auto flex items-center gap-2 rounded-full border border-slate-300 bg-white/95 py-1.5 pl-3 pr-2 text-xs font-semibold text-slate-900 shadow-lg backdrop-blur"
                >
                    <span
                        className={cn(
                            "h-2.5 w-2.5 shrink-0 rounded-full",
                            status.valid
                                ? "bg-emerald-600"
                                : status.valid === false
                                  ? "bg-red-600"
                                  : "bg-slate-500",
                        )}
                    />
                    <span>Hiding status: {statusLabel}</span>
                    <ChevronUp className="h-4 w-4 text-slate-500" />
                </button>
            ) : (
                <div className="pointer-events-auto max-h-[42vh] w-full max-w-md overflow-y-auto rounded-md border border-slate-300 bg-white/95 p-3 text-xs text-slate-900 shadow-xl backdrop-blur">
                    <div className="flex items-center justify-between gap-3">
                        <div className="font-poppins text-sm font-semibold">
                            Hiding status
                        </div>
                        <div className="flex items-center gap-2">
                            <div
                                className={cn(
                                    "rounded px-2 py-1 text-xs font-bold text-white",
                                    status.valid
                                        ? "bg-emerald-700"
                                        : status.valid === false
                                          ? "bg-red-700"
                                          : "bg-slate-600",
                                )}
                            >
                                {statusLabel}
                            </div>
                            <button
                                type="button"
                                className="rounded p-1 text-slate-500 hover:bg-slate-100"
                                aria-label="Collapse hiding status"
                                onClick={() => setCollapsed(true)}
                            >
                                <ChevronDown className="h-4 w-4" />
                            </button>
                        </div>
                    </div>
                    <div className="mt-2 grid grid-cols-[1fr_auto] gap-x-3 gap-y-1">
                        <span>In game boundary</span>
                        <span className="font-medium">{boundaryText}</span>
                        <span>Within 500 m of a valid stop</span>
                        <span className="font-medium">{nearbyStopsText}</span>
                        <span>GPS accuracy</span>
                        <span className="font-medium">
                            {location
                                ? `±${Math.round(location.accuracy)}m`
                                : "Unknown"}
                        </span>
                        <span>Last checked</span>
                        <span className="font-medium">{lastChecked}</span>
                        <span>Valid stops within 500 m</span>
                        <span className="font-medium">
                            {status.valid === null
                                ? "Unknown"
                                : status.nearbyStops.length}
                        </span>
                    </div>
                    {(locationError || dataError) && (
                        <div className="mt-2 rounded border border-amber-300 bg-amber-50 p-2 text-amber-900">
                            {locationError ?? dataError}
                            {locationError && (
                                <button
                                    type="button"
                                    className="ml-2 rounded border border-amber-500 px-2 py-0.5 text-xs font-semibold"
                                    onClick={() => {
                                        setLocationError(null);
                                        setGpsRetryCount((count) => count + 1);
                                    }}
                                >
                                    Retry GPS
                                </button>
                            )}
                        </div>
                    )}
                    <div className="mt-2 border-t border-slate-200 pt-2">
                        {visibleStops.length > 0 ? (
                            <div className="space-y-1">
                                {visibleStops.map((stop) => (
                                    <div
                                        key={`${stop.feature.geometry.coordinates.join(",")}-${stop.feature.properties?.name}`}
                                    >
                                        {stop.feature.properties?.name ??
                                            "Unnamed stop"}{" "}
                                        —{" "}
                                        {formatDistanceMetres(
                                            stop.distanceMetres,
                                        )}{" "}
                                        — {stop.stopType}
                                    </div>
                                ))}
                                {hiddenStopCount > 0 && (
                                    <div className="font-medium">
                                        + {hiddenStopCount} more
                                    </div>
                                )}
                            </div>
                        ) : status.valid === null ? (
                            <div className="text-slate-600">{waitingText}</div>
                        ) : (
                            <div className="text-slate-600">{waitingText}</div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

export const Map = ({ className }: { className?: string }) => {
    useStore(additionalMapGeoLocations);
    const $questions = useStore(questions);
    const $baseTileLayer = useStore(baseTileLayer);
    const $thunderforestApiKey = useStore(thunderforestApiKey);
    const $hiderMode = useStore(hiderMode);
    const $isLoading = useStore(isLoading);
    const $followMe = useStore(followMe);
    const $permanentOverlay = useStore(permanentOverlay);
    const map = useStore(leafletMapContext);

    const followMeMarkerRef = useMemo(
        () => ({ current: null as L.Marker | null }),
        [],
    );
    const geoWatchIdRef = useMemo(
        () => ({ current: null as number | null }),
        [],
    );

    const refreshQuestions = async (focus: boolean = false) => {
        if (!map) return;

        if ($isLoading) return;

        isLoading.set(true);

        if ($questions.length === 0) {
            await clearCache();
        }

        let mapGeoData = mapGeoJSON.get();

        if (!mapGeoData) {
            const polyGeoData = polyGeoJSON.get();
            if (polyGeoData) {
                mapGeoData = polyGeoData;
                mapGeoJSON.set(polyGeoData);
            } else {
                try {
                    const { boundaryGeoJson } = await loadSpoonsGameData(
                        new AbortController().signal,
                    );
                    mapGeoJSON.set(boundaryGeoJson);
                    polyGeoJSON.set(boundaryGeoJson);
                    mapGeoData = boundaryGeoJson;
                } catch (error) {
                    console.log(error);
                }
            }
        }

        if ($hiderMode !== false) {
            for (const question of $questions) {
                await hiderifyQuestion(question);
            }

            triggerLocalRefresh.set(Math.random()); // Refresh the question sidebar with new information but not this map
        }

        map.eachLayer((layer: any) => {
            if (layer.questionKey || layer.questionKey === 0) {
                map.removeLayer(layer);
            }
        });

        try {
            mapGeoData = await applyQuestionsToMapGeoData(
                $questions,
                mapGeoData,
                planningModeEnabled.get(),
                (geoJSONObj, question) => {
                    const geoJSONPlane = L.geoJSON(geoJSONObj);
                    // @ts-expect-error This is a check such that only this type of layer is removed
                    geoJSONPlane.questionKey = question.key;
                    geoJSONPlane.addTo(map);
                },
            );

            mapGeoData = {
                type: "FeatureCollection",
                features: [holedMask(mapGeoData!)!],
            };

            map.eachLayer((layer: any) => {
                if (layer.eliminationGeoJSON) {
                    // Hopefully only geoJSON layers
                    map.removeLayer(layer);
                }
            });

            const g = L.geoJSON(mapGeoData);
            // @ts-expect-error This is a check such that only this type of layer is removed
            g.eliminationGeoJSON = true;
            g.addTo(map);

            questionFinishedMapData.set(mapGeoData);

            if (autoZoom.get() && focus) {
                const bbox = turf.bbox(holedMask(mapGeoData) as any);
                const bounds = [
                    [bbox[1], bbox[0]],
                    [bbox[3], bbox[2]],
                ];

                if (animateMapMovements.get()) {
                    map.flyToBounds(bounds as any);
                } else {
                    map.fitBounds(bounds as any);
                }
            }
        } catch (error) {
            console.log(error);

            isLoading.set(false);
            if (document.querySelectorAll(".Toastify__toast").length === 0) {
                return toast.error("No solutions found / error occurred");
            }
        } finally {
            isLoading.set(false);
        }
    };

    const displayMap = useMemo(
        () => (
            <MapContainer
                center={[54.9744, -1.5518]}
                zoom={10}
                attributionControl={false}
                className={cn("w-[500px] h-[500px]", className)}
                ref={leafletMapContext.set}
                // @ts-expect-error Typing doesn't update from react-contextmenu
                contextmenu={true}
                contextmenuWidth={140}
                contextmenuItems={[
                    {
                        text: "Add Radius",
                        callback: (e: any) =>
                            addQuestion({
                                id: "radius",
                                data: {
                                    lat: e.latlng.lat,
                                    lng: e.latlng.lng,
                                },
                            }),
                    },
                    {
                        text: "Add Thermometer",
                        callback: (e: any) => {
                            const destination = turf.destination(
                                [e.latlng.lng, e.latlng.lat],
                                5,
                                90,
                                {
                                    units: "miles",
                                },
                            );

                            addQuestion({
                                id: "thermometer",
                                data: {
                                    latA: e.latlng.lat,
                                    lngA: e.latlng.lng,
                                    latB: destination.geometry.coordinates[1],
                                    lngB: destination.geometry.coordinates[0],
                                },
                            });
                        },
                    },
                    {
                        text: "Add Tentacles",
                        callback: (e: any) => {
                            addQuestion({
                                id: "tentacles",
                                data: {
                                    lat: e.latlng.lat,
                                    lng: e.latlng.lng,
                                },
                            });
                        },
                    },
                    {
                        text: "Add Matching",
                        callback: (e: any) => {
                            addQuestion({
                                id: "matching",
                                data: {
                                    lat: e.latlng.lat,
                                    lng: e.latlng.lng,
                                },
                            });
                        },
                    },
                    {
                        text: "Add Measuring",
                        callback: (e: any) => {
                            addQuestion({
                                id: "measuring",
                                data: {
                                    lat: e.latlng.lat,
                                    lng: e.latlng.lng,
                                },
                            });
                        },
                    },
                    {
                        text: "Exclude Country",
                        callback: (e: any) => {
                            addQuestion({
                                id: "matching",
                                data: {
                                    lat: e.latlng.lat,
                                    lng: e.latlng.lng,
                                    same: false,
                                    cat: {
                                        adminLevel: 2,
                                    },
                                    type: "zone",
                                },
                            });
                        },
                    },
                    {
                        text: "Copy Coordinates",
                        callback: (e: any) => {
                            if (!navigator || !navigator.clipboard) {
                                toast.error(
                                    "Clipboard API not supported in your browser",
                                );
                                return;
                            }

                            const latitude = e.latlng.lat;
                            const longitude = e.latlng.lng;

                            toast.promise(
                                navigator.clipboard.writeText(
                                    `${Math.abs(latitude)}°${latitude > 0 ? "N" : "S"}, ${Math.abs(
                                        longitude,
                                    )}°${longitude > 0 ? "E" : "W"}`,
                                ),
                                {
                                    pending: "Writing to clipboard...",
                                    success: "Coordinates copied!",
                                    error: "An error occurred while copying",
                                },
                                { autoClose: 1000 },
                            );
                        },
                    },
                ]}
            >
                {getTileLayer($baseTileLayer, $thunderforestApiKey)}
                <SpoonsGameLayers />
                <SpoonsLocationStatus />
                <DraggableMarkers />
                <div className="leaflet-top leaflet-right">
                    <div className="leaflet-control flex-col flex gap-2">
                        <LeafletFullScreenButton />
                    </div>
                </div>
                <PolygonDraw />
                <ScaleControl position="bottomleft" />
                <MapPrint
                    position="topright"
                    sizeModes={["Current", "A4Portrait", "A4Landscape"]}
                    hideControlContainer={false}
                    hideClasses={[
                        "leaflet-full-screen-specific-name",
                        "leaflet-top",
                        "leaflet-control-easyPrint",
                        "leaflet-draw",
                    ]}
                    title="Print"
                />
            </MapContainer>
        ),
        [map, $baseTileLayer, $thunderforestApiKey],
    );

    useEffect(() => {
        if (!map) return;

        refreshQuestions(true);
    }, [$questions, map, $hiderMode]);

    useEffect(() => {
        const intervalId = setInterval(async () => {
            if (!map) return;
            let layerCount = 0;
            map.eachLayer((layer: any) => {
                if (layer.eliminationGeoJSON) {
                    // Hopefully only geoJSON layers
                    layerCount++;
                }
            });
            if (layerCount > 1) {
                console.log("Too many layers, refreshing...");
                refreshQuestions(false);
            }
        }, 1000);

        return () => clearInterval(intervalId);
    }, [map]);

    useEffect(() => {
        const handleFullscreenChange = () => {
            const mainElement: HTMLElement | null =
                document.querySelector("main");

            if (mainElement) {
                if (document.fullscreenElement) {
                    mainElement.classList.add("fullscreen");
                } else {
                    mainElement.classList.remove("fullscreen");
                }
            }
        };

        document.addEventListener("fullscreenchange", handleFullscreenChange);

        return () => {
            document.removeEventListener(
                "fullscreenchange",
                handleFullscreenChange,
            );
        };
    }, []);

    useEffect(() => {
        if (!map) return;
        if (!$followMe) {
            if (followMeMarkerRef.current) {
                map.removeLayer(followMeMarkerRef.current);
                followMeMarkerRef.current = null;
            }
            if (geoWatchIdRef.current !== null) {
                navigator.geolocation.clearWatch(geoWatchIdRef.current);
                geoWatchIdRef.current = null;
            }
            return;
        }

        geoWatchIdRef.current = navigator.geolocation.watchPosition(
            (pos) => {
                const lat = pos.coords.latitude;
                const lng = pos.coords.longitude;
                if (followMeMarkerRef.current) {
                    followMeMarkerRef.current.setLatLng([lat, lng]);
                } else {
                    const marker = L.marker([lat, lng], {
                        icon: L.divIcon({
                            html: `<div class="text-blue-700 bg-white rounded-full border-2 border-blue-700 shadow w-5 h-5 flex items-center justify-center"><svg width="16" height="16" fill="currentColor" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6" fill="#2A81CB" opacity="0.5"/><circle cx="8" cy="8" r="3" fill="#2A81CB"/></svg></div>`,
                            className: "",
                        }),
                        zIndexOffset: 1000,
                    });
                    marker.addTo(map);
                    followMeMarkerRef.current = marker;
                }
            },
            () => {
                toast.error("Unable to access your location.");
                followMe.set(false);
            },
            { enableHighAccuracy: true, maximumAge: 10000, timeout: 20000 },
        );
        return () => {
            if (followMeMarkerRef.current) {
                map.removeLayer(followMeMarkerRef.current);
                followMeMarkerRef.current = null;
            }
            if (geoWatchIdRef.current !== null) {
                navigator.geolocation.clearWatch(geoWatchIdRef.current);
                geoWatchIdRef.current = null;
            }
        };
    }, [$followMe, map]);

    useEffect(() => {
        if (!map) return;

        map.eachLayer((layer: any) => {
            if (layer.permanentGeoJSON) map.removeLayer(layer);
        });

        if ($permanentOverlay === null) return;

        try {
            const overlay = L.geoJSON($permanentOverlay, {
                interactive: false,

                // @ts-expect-error Type hints force a Layer to be returned, but Leaflet accepts null as well
                // eslint-disable-next-line @typescript-eslint/no-unused-vars
                pointToLayer(geoJsonPoint, latlng) {
                    return null;
                },

                style(feature) {
                    return {
                        color: feature?.properties?.stroke,
                        weight: feature?.properties?.["stroke-width"],
                        opacity: feature?.properties?.["stroke-opacity"],
                        fillColor: feature?.properties?.fill,
                        fillOpacity: feature?.properties?.["fill-opacity"],
                    };
                },
            });
            // @ts-expect-error This is a check such that only this type of layer is removed
            overlay.permanentGeoJSON = true;
            overlay.addTo(map);
            overlay.bringToBack();
        } catch (e) {
            toast.error(`Failed to display GeoJSON overlay: ${e}`);
        }
    }, [$permanentOverlay, map]);

    return displayMap;
};
