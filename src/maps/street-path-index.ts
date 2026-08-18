type StreetPathIndexMetadata = {
    version: 1;
    count: number;
    coordinatesByteLength: number;
    names: string[];
};

export type StreetPathIndex = {
    coordinates: Float32Array;
    nameIds: Uint16Array;
    names: string[];
};

const dataUrl = (name: string) =>
    `${import.meta.env.BASE_URL.replace(/\/?$/, "/")}data/${name}`;

export const decodeStreetPathIndex = (
    metadata: StreetPathIndexMetadata,
    buffer: ArrayBuffer,
): StreetPathIndex => {
    if (metadata.version !== 1 || metadata.count < 1) {
        throw new Error("Unsupported or empty street/path index.");
    }
    const expectedCoordinateBytes =
        metadata.count * 2 * Float32Array.BYTES_PER_ELEMENT;
    const expectedBytes =
        expectedCoordinateBytes +
        metadata.count * Uint16Array.BYTES_PER_ELEMENT;
    if (
        metadata.coordinatesByteLength !== expectedCoordinateBytes ||
        buffer.byteLength !== expectedBytes
    ) {
        throw new Error("Invalid street/path index size.");
    }

    return {
        coordinates: new Float32Array(buffer, 0, metadata.count * 2),
        nameIds: new Uint16Array(
            buffer,
            metadata.coordinatesByteLength,
            metadata.count,
        ),
        names: metadata.names,
    };
};

let indexPromise: Promise<StreetPathIndex> | null = null;

export const loadStreetPathIndex = () => {
    if (!indexPromise) {
        indexPromise = Promise.all([
            fetch(dataUrl("street-path-index.json")),
            fetch(dataUrl("street-path-index.bin")),
        ])
            .then(async ([metadataResponse, binaryResponse]) => {
                if (!metadataResponse.ok || !binaryResponse.ok) {
                    throw new Error("Static street/path index is unavailable.");
                }
                return decodeStreetPathIndex(
                    (await metadataResponse.json()) as StreetPathIndexMetadata,
                    await binaryResponse.arrayBuffer(),
                );
            })
            .catch((error) => {
                indexPromise = null;
                throw error;
            });
    }
    return indexPromise;
};

export const nearestStreetPathNameFromIndex = (
    index: StreetPathIndex,
    latitude: number,
    longitude: number,
) => {
    const longitudeScale = Math.cos((latitude * Math.PI) / 180);
    let nearestIndex = -1;
    let nearestDistanceSquared = Number.POSITIVE_INFINITY;

    for (
        let sampleIndex = 0;
        sampleIndex < index.nameIds.length;
        sampleIndex++
    ) {
        const coordinateIndex = sampleIndex * 2;
        const longitudeDelta =
            (index.coordinates[coordinateIndex] - longitude) * longitudeScale;
        const latitudeDelta = index.coordinates[coordinateIndex + 1] - latitude;
        const distanceSquared =
            longitudeDelta * longitudeDelta + latitudeDelta * latitudeDelta;
        if (distanceSquared < nearestDistanceSquared) {
            nearestDistanceSquared = distanceSquared;
            nearestIndex = sampleIndex;
        }
    }

    const nameId = nearestIndex < 0 ? undefined : index.nameIds[nearestIndex];
    const name = nameId === undefined ? undefined : index.names[nameId];
    if (!name) throw new Error("Street/path index contains no named samples.");
    return name;
};

export const nearestStreetPathNameFromStaticIndex = async (
    latitude: number,
    longitude: number,
) =>
    nearestStreetPathNameFromIndex(
        await loadStreetPathIndex(),
        latitude,
        longitude,
    );
