import { useStore } from "@nanostores/react";
import * as turf from "@turf/turf";
import { SidebarCloseIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { hiderSidebarOpen } from "@/components/ui/sidebar-l";
import { leafletMapContext } from "@/lib/context";
import { cn } from "@/lib/utils";
import { loadPregeneratedPois } from "@/maps/api";
import { hiderifyMatching } from "@/maps/questions/matching";
import { hiderifyMeasuring } from "@/maps/questions/measuring";
import { hiderifyRadius } from "@/maps/questions/radius";
import { hiderifyTentacles } from "@/maps/questions/tentacles";
import { hiderifyThermometer } from "@/maps/questions/thermometer";
import type {
    APILocations,
    MatchingQuestion,
    MeasuringQuestion,
    RadiusQuestion,
    TentacleQuestion,
    ThermometerQuestion,
} from "@/maps/schema";

type QuestionType =
    | "radius"
    | "thermometer"
    | "tentacles"
    | "measuring"
    | "matching";

const QUESTION_TYPES: { type: QuestionType; label: string }[] = [
    { type: "radius", label: "Radius" },
    { type: "tentacles", label: "Tentacles" },
    { type: "measuring", label: "Measuring" },
    { type: "matching", label: "Matching" },
    { type: "thermometer", label: "Thermometer" },
];

// Categories usable by tentacle / measuring / matching questions.
// "theme_park" is repurposed as Greggs (see scripts/generate-spoons-pois.mjs).
const CATEGORY_OPTIONS = [
    { value: "theme_park", label: "Greggs" },
    { value: "hospital", label: "Hospital" },
    { value: "cinema", label: "Cinema" },
    { value: "museum", label: "Museum" },
    { value: "library", label: "Library" },
    { value: "park", label: "Park" },
    { value: "golf_course", label: "Golf course" },
    { value: "zoo", label: "Zoo" },
    { value: "aquarium", label: "Aquarium" },
    { value: "peak", label: "Mountain" },
    { value: "consulate", label: "Consulate" },
];

const inputClass =
    "w-full rounded border border-white/20 bg-black/30 px-2 py-1 text-sm text-white";
const labelClass = "text-xs text-white/70";

export const HiderSidebar = () => {
    const open = useStore(hiderSidebarOpen);

    // Private hider location — deliberately NOT the global hiderMode store, so
    // opening/using this panel never flips the seeker's Questions sidebar into
    // auto-answer (hider) mode.
    const [hiderLoc, setHiderLoc] = useState<{
        latitude: number;
        longitude: number;
    } | null>(null);

    const setFromMap = () => {
        const center = leafletMapContext.get()?.getCenter();
        setHiderLoc({
            latitude: center?.lat ?? 0,
            longitude: center?.lng ?? 0,
        });
    };

    const setFromGps = () => {
        if (!navigator.geolocation) {
            setFromMap();
            return;
        }
        navigator.geolocation.getCurrentPosition(
            (position) =>
                setHiderLoc({
                    latitude: position.coords.latitude,
                    longitude: position.coords.longitude,
                }),
            () => setFromMap(),
            { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 },
        );
    };

    const [type, setType] = useState<QuestionType | null>(null);
    const [answer, setAnswer] = useState<string | null>(null);
    const [computing, setComputing] = useState(false);

    // Seeker's chosen point(s) + question specifics.
    const [lat, setLat] = useState("");
    const [lng, setLng] = useState("");
    const [latB, setLatB] = useState("");
    const [lngB, setLngB] = useState("");
    const [radius, setRadius] = useState("1");
    const [unit, setUnit] = useState<"miles" | "kilometers" | "meters">(
        "miles",
    );
    const [category, setCategory] = useState(CATEGORY_OPTIONS[0].value);
    const [nearest, setNearest] = useState<{
        name: string;
        distanceMiles: number;
    } | null>(null);

    const num = (value: string) => {
        const n = parseFloat(value);
        return Number.isFinite(n) ? n : 0;
    };

    const selectType = (next: QuestionType) => {
        setType(next);
        setAnswer(null);
    };

    // Always show the hider's nearest of the chosen category (distance-based),
    // independent of the seeker's point — this is "what am I nearest to".
    useEffect(() => {
        const isCategory =
            type === "tentacles" || type === "measuring" || type === "matching";
        if (!isCategory || !hiderLoc) {
            setNearest(null);
            return;
        }
        let cancelled = false;
        void (async () => {
            try {
                const features = await loadPregeneratedPois(
                    category as APILocations,
                );
                const hider = turf.point([
                    hiderLoc.longitude,
                    hiderLoc.latitude,
                ]);
                let best: (typeof features)[number] | null = null;
                let bestDistance = Infinity;
                for (const feature of features) {
                    const distance = turf.distance(hider, feature, {
                        units: "miles",
                    });
                    if (distance < bestDistance) {
                        bestDistance = distance;
                        best = feature;
                    }
                }
                if (!cancelled) {
                    setNearest(
                        best
                            ? {
                                  name:
                                      (best.properties?.name as string) ??
                                      "unknown",
                                  distanceMiles: bestDistance,
                              }
                            : null,
                    );
                }
            } catch {
                if (!cancelled) setNearest(null);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [type, category, hiderLoc]);

    const computeAnswer = async () => {
        if (!hiderLoc || !type) return;
        setComputing(true);
        setAnswer(null);
        try {
            const base = {
                drag: true,
                collapsed: false,
                hidden: false,
                color: "red" as const,
            };
            let result = "";

            if (type === "radius") {
                const q = hiderifyRadius(
                    {
                        ...base,
                        lat: num(lat),
                        lng: num(lng),
                        radius: num(radius),
                        unit,
                        within: true,
                    } as RadiusQuestion,
                    hiderLoc,
                );
                result = q.within
                    ? `You ARE within ${radius} ${unit} of that point.`
                    : `You are NOT within ${radius} ${unit} of that point.`;
            } else if (type === "thermometer") {
                const q = await hiderifyThermometer(
                    {
                        drag: true,
                        collapsed: false,
                        hidden: false,
                        colorA: "red",
                        colorB: "blue",
                        latA: num(lat),
                        lngA: num(lng),
                        latB: num(latB),
                        lngB: num(lngB),
                        warmer: true,
                    } as ThermometerQuestion,
                    hiderLoc,
                );
                result = q.warmer
                    ? "WARMER — you are closer to the end point (B)."
                    : "COLDER — you are closer to the start point (A).";
            } else if (type === "tentacles") {
                const q = await hiderifyTentacles(
                    {
                        ...base,
                        lat: num(lat),
                        lng: num(lng),
                        radius: num(radius),
                        unit,
                        locationType: category,
                        location: false,
                    } as unknown as TentacleQuestion,
                    hiderLoc,
                );
                if (q.location) {
                    result = `Inside the seeker's ${radius} ${unit} circle, your nearest ${categoryLabel(
                        category,
                    )} is: ${q.location.properties?.name ?? "unknown"}.`;
                } else {
                    const distToSeeker = turf.distance(
                        turf.point([hiderLoc.longitude, hiderLoc.latitude]),
                        turf.point([num(lng), num(lat)]),
                        { units: unit },
                    );
                    result =
                        distToSeeker > num(radius)
                            ? `You're OUTSIDE the seeker's ${radius} ${unit} circle (you're ${distToSeeker.toFixed(
                                  1,
                              )} ${unit} from their point), so you're not near any ${categoryLabel(
                                  category,
                              )} they're asking about.`
                            : `You're inside the seeker's ${radius} ${unit} circle, but it contains no ${categoryLabel(
                                  category,
                              )}.`;
                }
            } else if (type === "measuring") {
                const q = await hiderifyMeasuring(
                    {
                        ...base,
                        lat: num(lat),
                        lng: num(lng),
                        type: category,
                        hiderCloser: true,
                    } as unknown as MeasuringQuestion,
                    hiderLoc,
                );
                result = q.hiderCloser
                    ? `You are CLOSER to a ${categoryLabel(category)} than the seeker.`
                    : `You are FURTHER from a ${categoryLabel(category)} than the seeker.`;
            } else if (type === "matching") {
                const q = await hiderifyMatching(
                    {
                        ...base,
                        lat: num(lat),
                        lng: num(lng),
                        type: category,
                        same: true,
                    } as unknown as MatchingQuestion,
                    hiderLoc,
                );
                result = q.same
                    ? `SAME — your nearest ${categoryLabel(category)} is the seeker's.`
                    : `DIFFERENT — your nearest ${categoryLabel(category)} is not the seeker's.`;
            }

            setAnswer(result);
        } catch (error) {
            console.error("Hider answer failed", error);
            setAnswer("Couldn't work that out (data unavailable).");
        } finally {
            setComputing(false);
        }
    };

    const usesCategory =
        type === "tentacles" || type === "measuring" || type === "matching";
    const usesRadius = type === "radius" || type === "tentacles";

    return (
        <div
            className={cn(
                "fixed inset-y-0 left-0 z-[1036] flex w-[19rem] max-w-[85vw] flex-col overflow-y-auto bg-[hsl(var(--sidebar-background))] text-white shadow-xl transition-transform duration-200 ease-linear",
                open ? "translate-x-0" : "-translate-x-full",
            )}
            aria-hidden={!open}
        >
            <div className="flex items-center justify-between">
                <h2 className="ml-4 mt-4 font-poppins text-2xl">Hider</h2>
                <SidebarCloseIcon
                    className="mr-2 mt-4 cursor-pointer"
                    onClick={() => hiderSidebarOpen.set(false)}
                />
            </div>

            {/* Hider location */}
            <div className="mx-4 mt-3 flex flex-col gap-2 rounded-md border border-white/15 p-3">
                <div className="flex items-center justify-between gap-2">
                    <span className="font-poppins font-semibold">
                        My location
                    </span>
                    {!hiderLoc ? (
                        <div className="flex gap-1">
                            <button
                                type="button"
                                className="rounded bg-blue-600 px-2 py-1 text-xs font-semibold"
                                onClick={setFromGps}
                            >
                                Use GPS
                            </button>
                            <button
                                type="button"
                                className="rounded bg-slate-600 px-2 py-1 text-xs font-semibold"
                                onClick={setFromMap}
                            >
                                Map centre
                            </button>
                        </div>
                    ) : (
                        <button
                            type="button"
                            className="rounded bg-red-700 px-2 py-1 text-xs font-semibold"
                            onClick={() => setHiderLoc(null)}
                        >
                            Clear
                        </button>
                    )}
                </div>
                {!hiderLoc ? (
                    <p className="text-xs text-white/60">
                        Set your location first — answers are worked out from
                        where you are.
                    </p>
                ) : (
                    <div className="grid grid-cols-2 gap-2">
                        <label className="flex flex-col gap-1">
                            <span className={labelClass}>Latitude</span>
                            <input
                                className={inputClass}
                                type="number"
                                value={hiderLoc.latitude}
                                onChange={(e) =>
                                    setHiderLoc({
                                        ...hiderLoc,
                                        latitude: num(e.target.value),
                                    })
                                }
                            />
                        </label>
                        <label className="flex flex-col gap-1">
                            <span className={labelClass}>Longitude</span>
                            <input
                                className={inputClass}
                                type="number"
                                value={hiderLoc.longitude}
                                onChange={(e) =>
                                    setHiderLoc({
                                        ...hiderLoc,
                                        longitude: num(e.target.value),
                                    })
                                }
                            />
                        </label>
                    </div>
                )}
            </div>

            {/* Question type picker */}
            <div className="mx-4 mt-4">
                <p className={cn(labelClass, "mb-1")}>
                    Which question did the seeker ask?
                </p>
                <div className="grid grid-cols-2 gap-2">
                    {QUESTION_TYPES.map((q) => (
                        <button
                            key={q.type}
                            type="button"
                            className={cn(
                                "rounded-md border px-2 py-2 text-sm font-semibold",
                                type === q.type
                                    ? "border-blue-400 bg-blue-600"
                                    : "border-white/20 bg-black/30 hover:bg-black/50",
                            )}
                            onClick={() => selectType(q.type)}
                        >
                            {q.label}
                        </button>
                    ))}
                </div>
            </div>

            {/* Question form */}
            {type && (
                <div className="mx-4 mb-6 mt-4 flex flex-col gap-3 rounded-md border border-white/15 p-3">
                    <p className={labelClass}>
                        {type === "thermometer"
                            ? "Enter the seeker's start and end points."
                            : "Enter the seeker's coordinates."}
                    </p>
                    <div className="grid grid-cols-2 gap-2">
                        <label className="flex flex-col gap-1">
                            <span className={labelClass}>
                                {type === "thermometer"
                                    ? "Start latitude"
                                    : "Latitude"}
                            </span>
                            <input
                                className={inputClass}
                                type="number"
                                value={lat}
                                onChange={(e) => setLat(e.target.value)}
                            />
                        </label>
                        <label className="flex flex-col gap-1">
                            <span className={labelClass}>
                                {type === "thermometer"
                                    ? "Start longitude"
                                    : "Longitude"}
                            </span>
                            <input
                                className={inputClass}
                                type="number"
                                value={lng}
                                onChange={(e) => setLng(e.target.value)}
                            />
                        </label>
                    </div>

                    {type === "thermometer" && (
                        <div className="grid grid-cols-2 gap-2">
                            <label className="flex flex-col gap-1">
                                <span className={labelClass}>End latitude</span>
                                <input
                                    className={inputClass}
                                    type="number"
                                    value={latB}
                                    onChange={(e) => setLatB(e.target.value)}
                                />
                            </label>
                            <label className="flex flex-col gap-1">
                                <span className={labelClass}>
                                    End longitude
                                </span>
                                <input
                                    className={inputClass}
                                    type="number"
                                    value={lngB}
                                    onChange={(e) => setLngB(e.target.value)}
                                />
                            </label>
                        </div>
                    )}

                    {usesRadius && (
                        <div className="grid grid-cols-2 gap-2">
                            <label className="flex flex-col gap-1">
                                <span className={labelClass}>Radius</span>
                                <input
                                    className={inputClass}
                                    type="number"
                                    value={radius}
                                    onChange={(e) => setRadius(e.target.value)}
                                />
                            </label>
                            <label className="flex flex-col gap-1">
                                <span className={labelClass}>Unit</span>
                                <select
                                    className={inputClass}
                                    value={unit}
                                    onChange={(e) =>
                                        setUnit(e.target.value as typeof unit)
                                    }
                                >
                                    <option value="miles">miles</option>
                                    <option value="kilometers">km</option>
                                    <option value="meters">metres</option>
                                </select>
                            </label>
                        </div>
                    )}

                    {usesCategory && (
                        <label className="flex flex-col gap-1">
                            <span className={labelClass}>Category</span>
                            <select
                                className={inputClass}
                                value={category}
                                onChange={(e) => setCategory(e.target.value)}
                            >
                                {CATEGORY_OPTIONS.map((c) => (
                                    <option key={c.value} value={c.value}>
                                        {c.label}
                                    </option>
                                ))}
                            </select>
                        </label>
                    )}

                    {usesCategory && nearest && (
                        <div className="rounded-md border border-white/15 bg-black/20 p-2 text-sm">
                            Your nearest {categoryLabel(category)}:{" "}
                            <span className="font-semibold">
                                {nearest.name}
                            </span>{" "}
                            ({nearest.distanceMiles.toFixed(1)} mi)
                        </div>
                    )}

                    <button
                        type="button"
                        className="rounded-md bg-blue-600 px-3 py-2 text-sm font-semibold disabled:opacity-50"
                        disabled={!hiderLoc || computing}
                        onClick={computeAnswer}
                    >
                        {computing ? "Working it out…" : "Get my answer"}
                    </button>

                    {!hiderLoc && (
                        <p className="text-xs text-amber-300">
                            Set your location above first.
                        </p>
                    )}

                    {answer && (
                        <div className="rounded-md border border-emerald-500/40 bg-emerald-900/30 p-2 text-sm font-semibold">
                            {answer}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

function categoryLabel(value: string) {
    return (
        CATEGORY_OPTIONS.find((c) => c.value === value)?.label ?? value
    ).toLowerCase();
}
