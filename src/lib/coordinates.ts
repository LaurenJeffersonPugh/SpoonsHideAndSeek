// Single source of truth for coordinate copy/paste formatting across the app.
//
// Canonical clipboard format is signed decimal degrees to 6 dp, e.g.
// "54.894690, -1.372940" — the same form Google Maps copies, so pasting between
// this app and Maps just works. Every "copy coordinates" action should use
// formatCoordinates; every paste should use parseCoordinates.

export const formatCoordinates = (lat: number, lng: number): string =>
    `${lat.toFixed(6)}, ${lng.toFixed(6)}`;

// Parse a coordinate string into { lat, lng }, or nulls if unrecognised.
// Accepts the canonical signed decimal form plus DMS (37°46'26"N, 122°25'10"W)
// and decimal-with-cardinal (48.89607° N, 9.09885° E) so coordinates copied
// from other sources still paste correctly. Also tolerates comma decimals.
export const parseCoordinates = (
    text: string,
): { lat: number | null; lng: number | null } => {
    // Decimal degrees, e.g. "37.7749, -122.4194" or "37,7749, -122,4194".
    const decimalPattern = /(-?\d+[.,]\d+)\s*,\s*(-?\d+[.,]\d+)/;

    // Degrees/minutes/seconds, e.g. "37°46'26\"N, 122°25'10\"W".
    const dmsPattern =
        /(\d+)°\s*(\d+)['′]?\s*(?:(\d+(?:\.\d+)?)["″]?\s*)?([NS])[,\s]+(\d+)°\s*(\d+)['′]?\s*(?:(\d+(?:\.\d+)?)["″]?\s*)?([EW])/i;

    // Decimal degrees with cardinal directions, e.g. "48.89607° N, 9.09885° E".
    const decimalCardinalPattern =
        /(\d+[.,]\d+)°\s*([NS])\s*,\s*(\d+[.,]\d+)°\s*([EW])/i;

    const decimalMatch = text.match(decimalPattern);
    if (decimalMatch) {
        return {
            lat: parseFloat(decimalMatch[1].replace(",", ".")),
            lng: parseFloat(decimalMatch[2].replace(",", ".")),
        };
    }

    const dmsMatch = text.match(dmsPattern);
    if (dmsMatch) {
        let lat =
            parseInt(dmsMatch[1]) +
            parseInt(dmsMatch[2]) / 60 +
            (parseFloat(dmsMatch[3]) || 0) / 3600;
        let lng =
            parseInt(dmsMatch[5]) +
            parseInt(dmsMatch[6]) / 60 +
            (parseFloat(dmsMatch[7]) || 0) / 3600;

        if (dmsMatch[4].toUpperCase() === "S") lat = -lat;
        if (dmsMatch[8].toUpperCase() === "W") lng = -lng;

        return { lat, lng };
    }

    const decimalCardinalMatch = text.match(decimalCardinalPattern);
    if (decimalCardinalMatch) {
        let lat = parseFloat(decimalCardinalMatch[1].replace(",", "."));
        let lng = parseFloat(decimalCardinalMatch[3].replace(",", "."));

        if (decimalCardinalMatch[2].toUpperCase() === "S") lat = -lat;
        if (decimalCardinalMatch[4].toUpperCase() === "W") lng = -lng;

        return { lat, lng };
    }

    return { lat: null, lng: null };
};
