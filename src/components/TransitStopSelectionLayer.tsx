import { useStore } from "@nanostores/react";
import L from "leaflet";
import { useEffect, useState } from "react";
import { CircleMarker, Tooltip } from "react-leaflet";

import {
    questionModified,
    questions,
    transitStopSelectionQuestionKey,
    triggerLocalRefresh,
} from "@/lib/context";
import {
    loadSpoonsStops,
    selectedTransitStopFromFeature,
    type SpoonsStopFeature,
    spoonsStopId,
    spoonsStopType,
} from "@/maps/spoons-stops";

export const TransitStopSelectionLayer = () => {
    useStore(triggerLocalRefresh);
    const activeQuestionKey = useStore(transitStopSelectionQuestionKey);
    const currentQuestions = useStore(questions);
    const [stops, setStops] = useState<SpoonsStopFeature[]>([]);

    useEffect(() => {
        if (activeQuestionKey === -1 || stops.length > 0) return;
        let cancelled = false;
        void loadSpoonsStops()
            .then((loaded) => {
                if (!cancelled) setStops(loaded);
            })
            .catch(() => {
                if (!cancelled) setStops([]);
            });
        return () => {
            cancelled = true;
        };
    }, [activeQuestionKey, stops.length]);

    const question = currentQuestions.find(
        (candidate) => candidate.key === activeQuestionKey,
    );
    const selectedIds = new Set(
        question?.id === "matching" && question.data.type === "same-train-line"
            ? (question.data.selectedStops ?? []).map((stop) => stop.id)
            : [],
    );

    if (
        activeQuestionKey === -1 ||
        question?.id !== "matching" ||
        question.data.type !== "same-train-line"
    ) {
        return null;
    }

    const toggleStop = (stop: SpoonsStopFeature) => {
        const id = spoonsStopId(stop);
        const selectedStops = question.data.selectedStops ?? [];
        question.data.selectedStops = selectedIds.has(id)
            ? selectedStops.filter((selected) => selected.id !== id)
            : [...selectedStops, selectedTransitStopFromFeature(stop)];
        questionModified();
    };

    return stops.map((stop) => {
        const id = spoonsStopId(stop);
        const selected = selectedIds.has(id);
        const [longitude, latitude] = stop.geometry.coordinates;
        return (
            <CircleMarker
                key={id}
                center={[latitude, longitude]}
                radius={selected ? 8 : 6}
                pathOptions={{
                    color: selected ? "#1d4ed8" : "#ffffff",
                    fillColor: selected
                        ? "#3b82f6"
                        : stop.properties?.["icon-color"] === "#9c27b0"
                          ? "#9c27b0"
                          : "#ffea00",
                    fillOpacity: selected ? 1 : 0.85,
                    weight: selected ? 3 : 2,
                }}
                eventHandlers={{
                    click: (event) => {
                        L.DomEvent.stopPropagation(event.originalEvent);
                        toggleStop(stop);
                    },
                }}
            >
                <Tooltip direction="top" offset={[0, -6]}>
                    <strong>{stop.properties?.name ?? "Unnamed stop"}</strong>
                    <br />
                    {spoonsStopType(stop)}
                </Tooltip>
            </CircleMarker>
        );
    });
};
