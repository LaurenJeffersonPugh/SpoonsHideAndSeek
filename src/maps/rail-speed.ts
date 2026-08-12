export const PURPOSE_BUILT_HIGH_SPEED_KMH = 250;
// "About 200 km/h" includes UK track signed at 120 mph (193.1 km/h).
export const UPGRADED_HIGH_SPEED_KMH = 190;

const HIGH_SPEED_TRAIN_OPERATORS = [
    "grand central",
    "lner",
    "lumo",
    "london north eastern railway",
];

export const parseRailSpeedKmh = (value: unknown) => {
    if (value === undefined || value === null) return null;
    const speeds = String(value)
        .split(/[;,]/)
        .map((part) => {
            const match = part.trim().match(/([0-9]+(?:\.[0-9]+)?)/);
            if (!match) return null;
            const speed = Number(match[1]);
            return /mph/i.test(part) ? speed * 1.609344 : speed;
        })
        .filter((speed): speed is number => Number.isFinite(speed));
    return speeds.length > 0 ? Math.max(...speeds) : null;
};

export const maximumRailSpeedKmh = (properties: Record<string, unknown>) => {
    const speeds = [
        properties.maxspeed,
        properties["maxspeed:forward"],
        properties["maxspeed:backward"],
    ]
        .map(parseRailSpeedKmh)
        .filter((speed): speed is number => Number.isFinite(speed));
    return speeds.length > 0 ? Math.max(...speeds) : null;
};

export const qualifiesAsHighSpeedRail = (
    properties: Record<string, unknown>,
) => {
    const speedKmh = maximumRailSpeedKmh(properties);
    if (speedKmh === null) return false;
    return (
        speedKmh >=
        (properties.highspeed === "yes"
            ? PURPOSE_BUILT_HIGH_SPEED_KMH
            : UPGRADED_HIGH_SPEED_KMH)
    );
};

export const qualifiesAsHighSpeedTrainService = (
    properties: Record<string, unknown>,
) => {
    if (properties.route !== "train") return false;
    if (properties.highspeed === "yes") return true;

    const operator = String(properties.operator ?? "").toLocaleLowerCase(
        "en-GB",
    );
    if (HIGH_SPEED_TRAIN_OPERATORS.some((name) => operator.includes(name))) {
        return true;
    }

    // OSM uses GC E for Grand Central's Sunderland-London service.
    return /^GC(?:\s|$)/i.test(String(properties.ref ?? "").trim());
};
