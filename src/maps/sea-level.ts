export const SEA_LEVEL_QUESTION =
    "Compared to me, are you closer to or further from sea level?";

export const isCloserToSeaLevel = (
    elevationMeters: number,
    referenceElevationMeters: number,
) => Math.abs(elevationMeters) < Math.abs(referenceElevationMeters);
