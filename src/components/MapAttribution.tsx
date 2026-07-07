import { Info } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

// A compact, terms-compliant attribution: a small "ⓘ" toggle that expands to
// the provider credits. Replaces Leaflet's always-on attribution bar (the map
// is created with attributionControl={false}).
export const MapAttribution = () => {
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!open) return;
        const onDown = (event: PointerEvent) => {
            if (ref.current && !ref.current.contains(event.target as Node)) {
                setOpen(false);
            }
        };
        document.addEventListener("pointerdown", onDown);
        return () => document.removeEventListener("pointerdown", onDown);
    }, [open]);

    return (
        <div ref={ref} className="flex flex-col items-end gap-1">
            {open && (
                <div className="max-w-[80vw] rounded border border-slate-300 bg-white/95 px-2 py-1 text-[11px] leading-snug text-slate-700 shadow backdrop-blur">
                    &copy;{" "}
                    <a
                        className="underline"
                        href="https://www.openstreetmap.org/copyright"
                        target="_blank"
                        rel="noreferrer"
                    >
                        OpenStreetMap
                    </a>{" "}
                    contributors &middot;{" "}
                    <a
                        className="underline"
                        href="https://carto.com/attributions"
                        target="_blank"
                        rel="noreferrer"
                    >
                        CARTO
                    </a>{" "}
                    &middot; Esri &middot;{" "}
                    <a
                        className="underline"
                        href="http://www.thunderforest.com/"
                        target="_blank"
                        rel="noreferrer"
                    >
                        Thunderforest
                    </a>{" "}
                    &middot; Turf.js
                </div>
            )}
            <button
                type="button"
                onClick={() => setOpen((o) => !o)}
                aria-label="Map attribution"
                title="Map attribution"
                className={cn(
                    "flex h-6 w-6 items-center justify-center rounded-full border border-slate-300 bg-white/90 text-slate-600 shadow hover:bg-white",
                    open && "bg-white text-slate-900",
                )}
            >
                <Info className="h-3.5 w-3.5" />
            </button>
        </div>
    );
};
