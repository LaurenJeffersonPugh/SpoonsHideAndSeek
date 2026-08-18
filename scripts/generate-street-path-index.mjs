import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = process.cwd();
const sourcePath = path.join(
    root,
    "public",
    "data",
    "street-path-samples.geojson",
);
const metadataPath = path.join(
    root,
    "public",
    "data",
    "street-path-index.json",
);
const binaryPath = path.join(root, "public", "data", "street-path-index.bin");

export const generateStreetPathIndex = async () => {
    const source = JSON.parse(await fs.readFile(sourcePath, "utf8"));
    const samples = source.features.filter(
        (feature) =>
            feature.geometry?.type === "Point" &&
            feature.geometry.coordinates.length >= 2 &&
            typeof feature.properties?.name === "string",
    );
    const names = [
        ...new Set(samples.map((feature) => feature.properties.name)),
    ];
    if (names.length > 65_536) {
        throw new Error(
            "Street/path index has too many unique names for Uint16 IDs.",
        );
    }

    const nameIds = new Map(names.map((name, index) => [name, index]));
    const coordinatesByteLength =
        samples.length * 2 * Float32Array.BYTES_PER_ELEMENT;
    const buffer = Buffer.alloc(
        coordinatesByteLength + samples.length * Uint16Array.BYTES_PER_ELEMENT,
    );

    samples.forEach((feature, index) => {
        const [longitude, latitude] = feature.geometry.coordinates;
        buffer.writeFloatLE(longitude, index * 8);
        buffer.writeFloatLE(latitude, index * 8 + 4);
        buffer.writeUInt16LE(
            nameIds.get(feature.properties.name),
            coordinatesByteLength + index * 2,
        );
    });

    await Promise.all([
        fs.writeFile(
            metadataPath,
            `${JSON.stringify({
                version: 1,
                count: samples.length,
                coordinatesByteLength,
                names,
            })}\n`,
        ),
        fs.writeFile(binaryPath, buffer),
    ]);

    console.log(
        `Wrote ${samples.length} street/path samples and ${names.length} names to the compact static index.`,
    );
};

if (
    process.argv[1] &&
    path.resolve(process.argv[1]) ===
        path.resolve(fileURLToPath(import.meta.url))
) {
    await generateStreetPathIndex();
}
