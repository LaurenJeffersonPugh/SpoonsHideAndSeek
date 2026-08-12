import { describe, expect, it } from "vitest";

import {
    parseRailSpeedKmh,
    qualifiesAsHighSpeedRail,
    qualifiesAsHighSpeedTrainService,
} from "@/maps/rail-speed";

describe("high-speed rail definition", () => {
    it("converts UK mph tags to kilometres per hour", () => {
        expect(parseRailSpeedKmh("120 mph")).toBeCloseTo(193.121, 3);
    });

    it("includes upgraded track at about 200 km/h", () => {
        expect(qualifiesAsHighSpeedRail({ maxspeed: "120 mph" })).toBe(true);
        expect(qualifiesAsHighSpeedRail({ maxspeed: "115 mph" })).toBe(false);
    });

    it("requires 250 km/h on purpose-built high-speed lines", () => {
        expect(
            qualifiesAsHighSpeedRail({ highspeed: "yes", maxspeed: 249 }),
        ).toBe(false);
        expect(
            qualifiesAsHighSpeedRail({ highspeed: "yes", maxspeed: 250 }),
        ).toBe(true);
    });

    it("includes the complete routes used by known high-speed services", () => {
        expect(
            qualifiesAsHighSpeedTrainService({
                route: "train",
                operator: "Grand Central",
                ref: "GC E",
            }),
        ).toBe(true);
        expect(
            qualifiesAsHighSpeedTrainService({
                route: "train",
                operator: "Northern",
                ref: "NR 02",
            }),
        ).toBe(false);
        expect(
            qualifiesAsHighSpeedTrainService({
                route: "subway",
                operator: "Grand Central",
            }),
        ).toBe(false);
    });
});
