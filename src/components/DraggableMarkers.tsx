import { useStore } from "@nanostores/react";
import { DivIcon, type DragEndEvent, Icon } from "leaflet";
import { useMemo, useState } from "react";
import { Fragment } from "react/jsx-runtime";
import { Marker } from "react-leaflet";

import { Dialog, DialogContent } from "@/components/ui/dialog";
import {
    autoSave,
    hiderMode,
    questionModified,
    questions,
    save,
    triggerLocalRefresh,
} from "@/lib/context";
import { ICON_COLORS } from "@/maps/api";

import { LatitudeLongitude } from "./LatLngPicker";
import {
    MatchingQuestionComponent,
    MeasuringQuestionComponent,
    RadiusQuestionComponent,
    TentacleQuestionComponent,
    ThermometerQuestionComponent,
} from "./QuestionCards";
import { Button } from "./ui/button";
import { SidebarMenu } from "./ui/sidebar-l";

let isDragging = false;

// Self-contained inline-SVG markers for specific question types. Each is a
// single-colour silhouette (tinted with the question colour at render time),
// needs no network request, and renders identically on every device. Keyed by
// question id — add an entry here to give another question type its own icon.
const CUSTOM_MARKER_ICONS: Record<
    string,
    { viewBox: string; path: string; transform?: string }
> = {
    tentacles: {
        viewBox: "0 0 512 512",
        path: "M150.25 19.97c-114.48-.574-139.972 184.95 20.563 212.124-29.5.534-55.382 8.11-91.75 25.97C-19.2 306.313.665 462.966 100.874 446c34.48-5.838 51.21-50.325.875-65.375 16.515 29.61-27.968 47.1-41.906 1.938-11.262-36.49 21.145-74.914 52.468-85 30.5-9.82 55.244-10.86 82.47-5.844-36.585 34.247-56.547 80.465-42.376 123.624 44.522 135.595 192.146 82.52 162.844-6.72-10.346-31.506-41.408-46.505-68-10.155 35.164-8.854 50.45 38.75 18.188 49.342-26.355 8.655-60.212-13.527-66.032-41.343-7.82-37.39 19.77-77.195 54.78-95.25 22.176 35.37 38.812 48.68 83.22 72.186 85.843 45.436 212.957-36.54 143.906-110.53-22.626-24.244-54.574-30.02-67.5 13.124 30.188-20.09 60.748 26.8 33.875 47.563-21.95 16.96-61.503 19.135-86.437 5.5-30.797-16.842-53.79-37.798-70.188-66.532 57.07 13.69 119.584-1.065 143-45.342 45.72-86.45-7.046-152.467-59.125-153.375-20.378-.356-40.654 9.237-54.875 31.5-17.85 27.946-9.815 61.533 35.157 59.124-29.11-21.628-1.9-63.623 26.717-45.343 23.378 14.932 22.494 51.88 9.75 77.28-15.165 30.23-60.573 50.738-95.062 24.657-3.008-5.71-5.563-11.683-7.78-17.843 8.99-6.49 14.874-17.028 14.874-28.875 0-17.772-13.252-32.64-30.345-35.218-9.763-47.134-23.34-92.648-84.844-112.594-13.64-4.424-26.437-6.472-38.28-6.53zm117.844 137.405c9.463 0 16.937 7.474 16.937 16.938 0 9.463-7.473 16.937-16.936 16.937-9.463 0-16.906-7.474-16.906-16.938 0-9.463 7.443-16.937 16.906-16.937zm-65.406 10.5c9.463 0 16.937 7.474 16.937 16.938 0 9.463-7.474 16.937-16.938 16.937-9.463 0-16.937-7.474-16.937-16.938 0-9.463 7.474-16.937 16.938-16.937z",
    },
    radius: {
        viewBox: "-8 0 512 512",
        path: "M248 8C111.03 8 0 119.03 0 256s111.03 248 248 248 248-111.03 248-248S384.97 8 248 8zm0 432c-101.69 0-184-82.29-184-184 0-101.69 82.29-184 184-184 101.69 0 184 82.29 184 184 0 101.69-82.29 184-184 184zm0-312c-70.69 0-128 57.31-128 128s57.31 128 128 128 128-57.31 128-128-57.31-128-128-128zm0 192c-35.29 0-64-28.71-64-64s28.71-64 64-64 64 28.71 64 64-28.71 64-64 64z",
    },
    measuring: {
        viewBox: "0 0 100 100",
        path: "M2.063 51.733a4.127 4.127 0 0 0-1.51 5.637l18.34 31.768a4.127 4.127 0 0 0 5.638 1.51l73.406-42.38a4.127 4.127 0 0 0 1.51-5.638l-18.34-31.768a4.127 4.127 0 0 0-5.638-1.51zm7.701 5.084l66.258-38.254l14.214 24.62l-4.775 2.757l-5.327-9.229l-3.574 2.064l5.327 9.228l-5.465 3.156l-5.328-9.229l-3.574 2.064l5.328 9.228l-5.459 3.152l-5.328-9.229l-3.574 2.064l5.328 9.228l-5.465 3.156l-7.404-12.823l-3.574 2.063l7.404 12.823l-5.466 3.156l-5.328-9.229l-3.574 2.064l5.328 9.228l-5.459 3.151l-5.327-9.228l-3.574 2.064l5.327 9.228l-5.465 3.155l-5.328-9.228l-3.574 2.064l5.328 9.228l-3.686 2.128z",
    },
    thermometer: {
        viewBox: "-2.5 0 15.999 15.999",
        transform: "translate(-22.999)",
        path: "M30,3a3,3,0,0,0-6,0V9.359A4,4,0,0,0,26.071,15.9,4.223,4.223,0,0,0,27,16a4,4,0,0,0,3-6.64ZM28.871,14.346a3.032,3.032,0,0,1-2.579.573A3,3,0,0,1,24.857,9.9.5.5,0,0,0,25,9.556V3a2,2,0,0,1,4,0V9.556a.5.5,0,0,0,.143.349,3,3,0,0,1-.272,4.441ZM31,2.5a.5.5,0,0,1,.5-.5h2a.5.5,0,0,1,0,1h-2A.5.5,0,0,1,31,2.5Zm3,3a.5.5,0,0,1-.5.5h-2a.5.5,0,0,1,0-1h2A.5.5,0,0,1,34,5.5Zm0,3a.5.5,0,0,1-.5.5h-2a.5.5,0,0,1,0-1h2A.5.5,0,0,1,34,8.5ZM29,12a2,2,0,1,1-3-1.723V7a1,1,0,0,1,2,0v3.277A1.994,1.994,0,0,1,29,12Z",
    },
    matching: {
        viewBox: "0 0 32 32",
        path: "M16,0C7.163,0,0,7.163,0,16s7.163,16,16,16s16-7.163,16-16S24.837,0,16,0z M16,30C8.28,30,2,23.72,2,16S8.28,2,16,2s14,6.28,14,14S23.72,30,16,30z M16,3C8.82,3,3,8.82,3,16s5.82,13,13,13s13-5.82,13-13S23.18,3,16,3z M16,28C9.383,28,4,22.617,4,16S9.383,4,16,4s12,5.383,12,12S22.617,28,16,28z M23,17H9c-0.552,0-1,0.448-1,1v2c0,0.552,0.448,1,1,1h14c0.552,0,1-0.448,1-1v-2C24,17.448,23.552,17,23,17z M23,20H9v-2h14V20z M23,11H9c-0.552,0-1,0.448-1,1v2c0,0.552,0.448,1,1,1h14c0.552,0,1-0.448,1-1v-2C24,11.448,23.552,11,23,11z M23,14H9v-2h14V14z",
    },
};

const ColoredMarker = ({
    latitude,
    longitude,
    color,
    onChange,
    questionKey,
    sub = "",
    shape,
}: {
    onChange: (event: DragEndEvent) => void;
    latitude: number;
    longitude: number;
    color: keyof typeof ICON_COLORS;
    questionKey: number;
    sub?: string;
    shape?: keyof typeof CUSTOM_MARKER_ICONS;
}) => {
    const $questions = useStore(questions);
    const $hiderMode = useStore(hiderMode);
    const $autoSave = useStore(autoSave);
    const [open, setOpen] = useState(false);

    const markerIcon = useMemo(() => {
        const customIcon = shape ? CUSTOM_MARKER_ICONS[shape] : undefined;
        if (customIcon) {
            const hex = ICON_COLORS[color] ?? ICON_COLORS.blue;
            return new DivIcon({
                className: "",
                html: `<svg width="36" height="36" viewBox="${customIcon.viewBox}" xmlns="http://www.w3.org/2000/svg" style="display:block;filter:drop-shadow(0 1px 2px rgba(0,0,0,0.5));">
                    <path fill="${hex}"${customIcon.transform ? ` transform="${customIcon.transform}"` : ""} d="${customIcon.path}"/>
                </svg>`,
                iconSize: [36, 36],
                iconAnchor: [18, 18],
                popupAnchor: [0, -16],
            });
        }

        return color
            ? new Icon({
                  iconUrl: `https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-${color}.png`,
                  shadowUrl:
                      "https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png",
                  iconSize: [25, 41],
                  iconAnchor: [12, 41],
                  popupAnchor: [1, -34],
                  shadowSize: [41, 41],
              })
            : undefined;
    }, [color, shape]);

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <Marker
                position={[latitude, longitude]}
                icon={markerIcon}
                draggable={true}
                eventHandlers={{
                    dragstart: () => {
                        isDragging = true;
                    },
                    dragend: (x) => {
                        onChange(x);
                        setTimeout(() => {
                            isDragging = false;
                        }, 100);
                    },
                    click: () => {
                        if (!isDragging) {
                            setOpen(true);
                        }
                    },
                }}
            />
            <DialogContent className="!bg-[hsl(var(--sidebar-background))] !text-white">
                {questionKey === -1 && $hiderMode !== false && (
                    <>
                        <h2 className="text-center text-2xl font-bold font-poppins">
                            {sub}
                        </h2>
                        <SidebarMenu>
                            <LatitudeLongitude
                                latitude={$hiderMode.latitude}
                                longitude={$hiderMode.longitude}
                                inlineEdit
                                onChange={(latitude, longitude) => {
                                    hiderMode.set({
                                        latitude:
                                            latitude ?? $hiderMode.latitude,
                                        longitude:
                                            longitude ?? $hiderMode.longitude,
                                    });
                                }}
                                label="Hider Location"
                            />
                        </SidebarMenu>
                    </>
                )}
                {$questions
                    .filter((q) => q.key === questionKey)
                    .map((q) => {
                        switch (q.id) {
                            case "radius":
                                return (
                                    <RadiusQuestionComponent
                                        key={q.key}
                                        data={q.data}
                                        questionKey={q.key}
                                        sub={sub}
                                    />
                                );
                            case "tentacles":
                                return (
                                    <TentacleQuestionComponent
                                        key={q.key}
                                        data={q.data}
                                        questionKey={q.key}
                                        sub={sub}
                                    />
                                );
                            case "thermometer":
                                return (
                                    <ThermometerQuestionComponent
                                        key={q.key}
                                        data={q.data}
                                        questionKey={q.key}
                                        sub={sub}
                                    />
                                );
                            case "matching":
                                return (
                                    <MatchingQuestionComponent
                                        key={q.key}
                                        data={q.data}
                                        questionKey={q.key}
                                        sub={sub}
                                    />
                                );
                            case "measuring":
                                return (
                                    <MeasuringQuestionComponent
                                        key={q.key}
                                        data={q.data}
                                        questionKey={q.key}
                                        sub={sub}
                                    />
                                );
                            default:
                                return null;
                        }
                    })}
                {questionKey === -1 && (
                    <Button // If it's the hider mode marker
                        onClick={() => {
                            hiderMode.set(false);
                        }}
                        variant="destructive"
                        className="font-semibold font-poppins"
                    >
                        Disable
                    </Button>
                )}
                {!$autoSave && (
                    <button
                        onClick={save}
                        className="bg-blue-600 p-2 rounded-md font-semibold font-poppins transition-shadow duration-500"
                    >
                        Save
                    </button>
                )}
            </DialogContent>
        </Dialog>
    );
};

export const DraggableMarkers = () => {
    useStore(triggerLocalRefresh);
    const $questions = useStore(questions);
    const $hiderMode = useStore(hiderMode);

    return (
        <Fragment>
            {$hiderMode !== false && (
                <ColoredMarker
                    color="green"
                    key="hider"
                    sub="Hider Location"
                    questionKey={-1}
                    latitude={$hiderMode.latitude}
                    longitude={$hiderMode.longitude}
                    onChange={(e) => {
                        $hiderMode.latitude =
                            e.target.getLatLng().lat ?? $hiderMode.latitude;
                        $hiderMode.longitude =
                            e.target.getLatLng().lng ?? $hiderMode.longitude;

                        if (autoSave.get()) {
                            hiderMode.set({
                                ...$hiderMode,
                            });
                        } else {
                            triggerLocalRefresh.set(Math.random());
                        }
                    }}
                />
            )}
            {$questions.map((question) => {
                if (!question.data) return null;
                if (!question.data.drag) return null;
                if (question.data.hidden) return null;
                if (
                    question.id === "matching" &&
                    question.data.type === "custom-zone"
                )
                    return null;

                switch (question.id) {
                    case "radius":
                    case "tentacles":
                    case "matching":
                    case "measuring":
                        return (
                            <ColoredMarker
                                color={question.data.color}
                                key={question.key}
                                questionKey={question.key}
                                shape={
                                    question.id in CUSTOM_MARKER_ICONS
                                        ? question.id
                                        : undefined
                                }
                                latitude={question.data.lat}
                                longitude={question.data.lng}
                                onChange={(e) => {
                                    question.data.lat =
                                        e.target.getLatLng().lat;
                                    question.data.lng =
                                        e.target.getLatLng().lng;
                                    questionModified();
                                }}
                            />
                        );
                    case "thermometer":
                        return (
                            <Fragment key={question.key}>
                                <ColoredMarker
                                    color={question.data.colorA}
                                    key={"a" + question.key.toString()}
                                    questionKey={question.key}
                                    shape="thermometer"
                                    sub="Start"
                                    latitude={question.data.latA}
                                    longitude={question.data.lngA}
                                    onChange={(e) => {
                                        question.data.latA =
                                            e.target.getLatLng().lat;
                                        question.data.lngA =
                                            e.target.getLatLng().lng;
                                        questionModified();
                                    }}
                                />
                                <ColoredMarker
                                    color={question.data.colorB}
                                    key={"b" + question.key.toString()}
                                    questionKey={question.key}
                                    shape="thermometer"
                                    sub="End"
                                    latitude={question.data.latB}
                                    longitude={question.data.lngB}
                                    onChange={(e) => {
                                        question.data.latB =
                                            e.target.getLatLng().lat;
                                        question.data.lngB =
                                            e.target.getLatLng().lng;
                                        questionModified();
                                    }}
                                />
                            </Fragment>
                        );
                    default:
                        return null;
                }
            })}
        </Fragment>
    );
};
