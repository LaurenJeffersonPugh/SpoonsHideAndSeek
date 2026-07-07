import * as SelectPrimitive from "@radix-ui/react-select";
import { Check, ChevronDown, ChevronUp } from "lucide-react";
import * as React from "react";

import { cn } from "@/lib/utils";

type Options<T extends string> = Partial<Record<T, string>>;
type GroupConfig<T extends string> =
    | { disabled: boolean; options: Options<T> }
    | Options<T>;
type SelectProps<T extends string> = {
    disabled?: boolean;
    trigger: string | Partial<Record<"className" | "placeholder", string>>;
    options?: Options<T>;
    groups?: Record<string, GroupConfig<T>>;
    onValueChange?: (value: T) => void;
    value: T;
};

const mapObj = <T,>(
    obj: Partial<Record<string, T>>,
    fn: (key: string, value: T) => React.ReactNode,
) => Object.entries(obj).map(([k, v]) => fn(k, v!));

// A GroupConfig may be either { disabled, options } or a bare options map.
const groupOptions = <T extends string>(cfg: GroupConfig<T>) =>
    "options" in cfg && typeof cfg.options == "object"
        ? cfg
        : { disabled: false, options: cfg as Options<T> };

// Touch devices get the OS-native <select> picker (nice finger scrolling);
// pointer devices keep the styled Radix menu.
const useNativePicker = () => {
    const [native, setNative] = React.useState(false);
    React.useEffect(() => {
        const mq = window.matchMedia("(pointer: coarse)");
        const update = () => setNative(mq.matches);
        update();
        mq.addEventListener("change", update);
        return () => mq.removeEventListener("change", update);
    }, []);
    return native;
};

// Native <select> for touch devices — renders the OS picker so lists scroll
// with a finger instead of Radix's scroll-arrow buttons.
const NativeSelect = <T extends string>({
    trigger,
    options,
    groups,
    disabled,
    value,
    onValueChange,
}: SelectProps<T>) => {
    const { placeholder, className } =
        typeof trigger == "string" ? { placeholder: trigger } : trigger;
    const renderOptions = (opts: Options<T>) =>
        mapObj(opts, (value, children) => (
            <option key={value} value={value}>
                {children}
            </option>
        ));
    const hasValue = value !== undefined && (value as string) !== "";
    return (
        <div className={cn("relative w-full", className)}>
            <select
                disabled={disabled}
                value={hasValue ? value : ""}
                onChange={(e) => onValueChange?.(e.target.value as T)}
                className={cn(selectTriggerClassName, "appearance-none pr-8")}
            >
                {!hasValue && (
                    <option value="" disabled hidden>
                        {placeholder}
                    </option>
                )}
                {options && renderOptions(options)}
                {groups &&
                    mapObj(groups, (label, cfg) => {
                        const { disabled: grpDisabled, options: opts } =
                            groupOptions(cfg as GroupConfig<T>);
                        return (
                            <optgroup
                                key={label}
                                label={label}
                                disabled={grpDisabled}
                            >
                                {renderOptions(opts)}
                            </optgroup>
                        );
                    })}
            </select>
            <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 opacity-50" />
        </div>
    );
};

const Select = <T extends string>(props: SelectProps<T>) => {
    const native = useNativePicker();
    if (native) return <NativeSelect {...props} />;

    const { trigger, options, groups, ...rest } = props;
    const { placeholder, className } =
        typeof trigger == "string" ? { placeholder: trigger } : trigger;
    const Options = ({
        options,
        ...rest
    }: {
        options: Options<T>;
        disabled?: boolean;
    }) =>
        mapObj(options, (value, children) => (
            <SelectItem key={value} {...{ ...rest, value, children }} />
        ));
    return (
        <SelectPrimitive.Root {...rest}>
            <SelectTrigger {...{ className }}>
                <SelectValue {...{ placeholder }} />
            </SelectTrigger>
            <SelectContent>
                {options && <Options {...{ options }} />}
                {groups &&
                    mapObj(groups, (children, optionsOrConfig) => {
                        return (
                            <SelectGroup key={children}>
                                <SelectLabel {...{ children }} />
                                <Options
                                    {...groupOptions(
                                        optionsOrConfig as GroupConfig<T>,
                                    )}
                                />
                            </SelectGroup>
                        );
                    })}
            </SelectContent>
        </SelectPrimitive.Root>
    );
};

const SelectGroup = SelectPrimitive.Group;

const SelectValue = SelectPrimitive.Value;

const selectTriggerClassName =
    "flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 [&>span]:line-clamp-1";

const SelectTrigger = React.forwardRef<
    React.ElementRef<typeof SelectPrimitive.Trigger>,
    React.ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger>
>(({ className, children, ...props }, ref) => (
    <SelectPrimitive.Trigger
        ref={ref}
        className={cn(selectTriggerClassName, className)}
        {...props}
    >
        {children}
        <SelectPrimitive.Icon asChild>
            <ChevronDown className="h-4 w-4 opacity-50" />
        </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
));
SelectTrigger.displayName = SelectPrimitive.Trigger.displayName;

const SelectScrollUpButton = React.forwardRef<
    React.ElementRef<typeof SelectPrimitive.ScrollUpButton>,
    React.ComponentPropsWithoutRef<typeof SelectPrimitive.ScrollUpButton>
>(({ className, ...props }, ref) => (
    <SelectPrimitive.ScrollUpButton
        ref={ref}
        className={cn(
            "flex cursor-default items-center justify-center py-1",
            className,
        )}
        {...props}
    >
        <ChevronUp className="h-4 w-4" />
    </SelectPrimitive.ScrollUpButton>
));
SelectScrollUpButton.displayName = SelectPrimitive.ScrollUpButton.displayName;

const SelectScrollDownButton = React.forwardRef<
    React.ElementRef<typeof SelectPrimitive.ScrollDownButton>,
    React.ComponentPropsWithoutRef<typeof SelectPrimitive.ScrollDownButton>
>(({ className, ...props }, ref) => (
    <SelectPrimitive.ScrollDownButton
        ref={ref}
        className={cn(
            "flex cursor-default items-center justify-center py-1",
            className,
        )}
        {...props}
    >
        <ChevronDown className="h-4 w-4" />
    </SelectPrimitive.ScrollDownButton>
));
SelectScrollDownButton.displayName =
    SelectPrimitive.ScrollDownButton.displayName;

const SelectContent = React.forwardRef<
    React.ElementRef<typeof SelectPrimitive.Content>,
    React.ComponentPropsWithoutRef<typeof SelectPrimitive.Content>
>(({ className, children, position = "popper", ...props }, ref) => (
    <SelectPrimitive.Portal
        container={document.querySelector(
            "#map-modal-dialog-container-leaflet",
        )}
    >
        <SelectPrimitive.Content
            ref={ref}
            className={cn(
                "relative z-[1050] max-h-[min(70vh,24rem)] min-w-[8rem] overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
                position === "popper" &&
                    "data-[side=bottom]:translate-y-1 data-[side=left]:-translate-x-1 data-[side=right]:translate-x-1 data-[side=top]:-translate-y-1",
                className,
            )}
            position={position}
            {...props}
        >
            <SelectScrollUpButton />
            <SelectPrimitive.Viewport
                className={cn(
                    "max-h-[min(70vh,24rem)] overflow-y-auto overscroll-contain p-1",
                    position === "popper" &&
                        "w-full min-w-[var(--radix-select-trigger-width)]",
                )}
            >
                {children}
            </SelectPrimitive.Viewport>
            <SelectScrollDownButton />
        </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
));
SelectContent.displayName = SelectPrimitive.Content.displayName;

const SelectLabel = React.forwardRef<
    React.ElementRef<typeof SelectPrimitive.Label>,
    React.ComponentPropsWithoutRef<typeof SelectPrimitive.Label>
>(({ className, ...props }, ref) => (
    <SelectPrimitive.Label
        ref={ref}
        className={cn("py-1.5 pl-8 pr-2 text-sm font-semibold", className)}
        {...props}
    />
));
SelectLabel.displayName = SelectPrimitive.Label.displayName;

const SelectItem = React.forwardRef<
    React.ElementRef<typeof SelectPrimitive.Item>,
    React.ComponentPropsWithoutRef<typeof SelectPrimitive.Item>
>(({ className, children, ...props }, ref) => (
    <SelectPrimitive.Item
        ref={ref}
        className={cn(
            "relative flex w-full cursor-default select-none items-center rounded-sm py-2.5 pl-8 pr-2 text-sm outline-none focus:bg-accent focus:text-accent-foreground data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
            className,
        )}
        {...props}
    >
        <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
            <SelectPrimitive.ItemIndicator>
                <Check className="h-4 w-4" />
            </SelectPrimitive.ItemIndicator>
        </span>

        <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
));
SelectItem.displayName = SelectPrimitive.Item.displayName;

const SelectSeparator = React.forwardRef<
    React.ElementRef<typeof SelectPrimitive.Separator>,
    React.ComponentPropsWithoutRef<typeof SelectPrimitive.Separator>
>(({ className, ...props }, ref) => (
    <SelectPrimitive.Separator
        ref={ref}
        className={cn("-mx-1 my-1 h-px bg-muted", className)}
        {...props}
    />
));
SelectSeparator.displayName = SelectPrimitive.Separator.displayName;

export {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectLabel,
    SelectScrollDownButton,
    SelectScrollUpButton,
    SelectSeparator,
    SelectTrigger,
    SelectValue,
};
