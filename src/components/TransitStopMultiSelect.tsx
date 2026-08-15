import { X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Checkbox } from "@/components/ui/checkbox";
import {
    Command,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
} from "@/components/ui/command";
import {
    loadSpoonsStops,
    type SelectedTransitStop,
    selectedTransitStopFromFeature,
    type SpoonsStopFeature,
    spoonsStopId,
    spoonsStopType,
} from "@/maps/spoons-stops";

export const TransitStopMultiSelect = ({
    selectedStops,
    onChange,
    disabled = false,
}: {
    selectedStops: SelectedTransitStop[];
    onChange: (selectedStops: SelectedTransitStop[]) => void;
    disabled?: boolean;
}) => {
    const [stops, setStops] = useState<SpoonsStopFeature[]>([]);
    const [loadFailed, setLoadFailed] = useState(false);

    useEffect(() => {
        let cancelled = false;
        void loadSpoonsStops()
            .then((loaded) => {
                if (cancelled) return;
                setStops(
                    [...loaded].sort((first, second) =>
                        (first.properties?.name ?? "").localeCompare(
                            second.properties?.name ?? "",
                        ),
                    ),
                );
            })
            .catch(() => {
                if (!cancelled) setLoadFailed(true);
            });
        return () => {
            cancelled = true;
        };
    }, []);

    const selectedIds = useMemo(
        () => new Set(selectedStops.map((stop) => stop.id)),
        [selectedStops],
    );

    const toggleStop = (stop: SpoonsStopFeature) => {
        const id = spoonsStopId(stop);
        onChange(
            selectedIds.has(id)
                ? selectedStops.filter((selected) => selected.id !== id)
                : [...selectedStops, selectedTransitStopFromFeature(stop)],
        );
    };

    return (
        <div className="overflow-hidden rounded-md border border-border">
            <div className="flex h-9 items-center justify-between border-b px-3 text-xs font-medium">
                <span>{selectedStops.length} stops selected</span>
                {selectedStops.length > 0 && (
                    <button
                        type="button"
                        className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
                        onClick={() => onChange([])}
                        disabled={disabled}
                        title="Clear selected stops"
                        aria-label="Clear selected stops"
                    >
                        <X className="h-4 w-4" />
                    </button>
                )}
            </div>
            <Command>
                <CommandInput
                    placeholder="Search valid stops..."
                    disabled={disabled || loadFailed}
                />
                <CommandList className="h-52 max-h-52">
                    <CommandEmpty>
                        {loadFailed
                            ? "Could not load stops."
                            : "No stops found."}
                    </CommandEmpty>
                    <CommandGroup>
                        {stops.map((stop) => {
                            const id = spoonsStopId(stop);
                            const name =
                                stop.properties?.name ?? "Unnamed stop";
                            const type = spoonsStopType(stop);
                            return (
                                <CommandItem
                                    key={id}
                                    value={`${name} ${type} ${id}`}
                                    onSelect={() => toggleStop(stop)}
                                    disabled={disabled}
                                >
                                    <Checkbox
                                        checked={selectedIds.has(id)}
                                        tabIndex={-1}
                                        aria-hidden
                                    />
                                    <span className="min-w-0 flex-1">
                                        <span className="block truncate font-medium">
                                            {name}
                                        </span>
                                        <span className="block truncate text-xs text-muted-foreground">
                                            {type}
                                        </span>
                                    </span>
                                </CommandItem>
                            );
                        })}
                    </CommandGroup>
                </CommandList>
            </Command>
        </div>
    );
};
