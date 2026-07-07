import { useStore } from "@nanostores/react";
import { Check, Copy, MapPin } from "lucide-react";
import { useEffect, useState } from "react";

import { useHideSidebarTriggers } from "@/hooks/use-hide-sidebar-triggers";
import { playerLocation } from "@/lib/context";
import { cn } from "@/lib/utils";

const copyText = async (text: string) => {
    try {
        if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(text);
            return true;
        }
    } catch {
        // fall through to the legacy path
    }

    try {
        const textarea = document.createElement("textarea");
        textarea.value = text;
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.select();
        const ok = document.execCommand("copy");
        document.body.removeChild(textarea);
        return ok;
    } catch {
        return false;
    }
};

export const CopyPositionButton = () => {
    const location = useStore(playerLocation);
    const hidden = useHideSidebarTriggers();
    const [copied, setCopied] = useState(false);

    useEffect(() => {
        if (!copied) return;
        const id = setTimeout(() => setCopied(false), 1500);
        return () => clearTimeout(id);
    }, [copied]);

    const onClick = async () => {
        if (!location) return;
        const text = `${location.latitude.toFixed(6)}, ${location.longitude.toFixed(6)}`;
        if (await copyText(text)) setCopied(true);
    };

    return (
        <button
            type="button"
            onClick={onClick}
            disabled={!location}
            aria-label="Copy my current position"
            title={
                location ? "Copy my current position" : "Waiting for a GPS fix…"
            }
            className={cn(
                "flex items-center gap-1 rounded-sm border-2 border-black border-opacity-30 bg-white px-2 py-1 text-sm text-black shadow hover:bg-[#f4f4f4]",
                "disabled:cursor-not-allowed disabled:opacity-60",
                hidden && "hidden",
            )}
        >
            {copied ? (
                <Check className="h-4 w-4 text-emerald-600" />
            ) : location ? (
                <Copy className="h-4 w-4" />
            ) : (
                <MapPin className="h-4 w-4" />
            )}
            <span className="whitespace-nowrap">
                {copied
                    ? "Copied!"
                    : location
                      ? "Copy my location"
                      : "Waiting for GPS…"}
            </span>
        </button>
    );
};
