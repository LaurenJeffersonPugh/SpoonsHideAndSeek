import { describe, expect, it } from "vitest";

import { questionSchema } from "../src/maps/schema";

const railQuestion = {
    id: "measuring" as const,
    data: {
        type: "rail-measure" as const,
        lat: 54.969,
        lng: -1.617,
    },
};

describe("rail station measuring questions", () => {
    it("keeps older saved questions valid without an explicit target", () => {
        const parsed = questionSchema.parse(railQuestion);

        expect(parsed.data.type).toBe("rail-measure");
        if (parsed.data.type === "rail-measure") {
            expect(parsed.data.targetStation).toBeUndefined();
        }
    });

    it("persists the specific target station", () => {
        const targetStation = {
            id: "102208484",
            name: "Bishop Auckland",
            latitude: 54.6573,
            longitude: -1.6777,
        };
        const parsed = questionSchema.parse({
            ...railQuestion,
            data: { ...railQuestion.data, targetStation },
        });

        expect(parsed.data.type).toBe("rail-measure");
        if (parsed.data.type === "rail-measure") {
            expect(parsed.data.targetStation).toEqual(targetStation);
        }
    });
});
