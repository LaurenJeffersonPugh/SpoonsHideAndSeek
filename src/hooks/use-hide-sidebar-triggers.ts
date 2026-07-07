import { useStore } from "@nanostores/react";

import { hiderSidebarOpen, SidebarContext } from "@/components/ui/sidebar-l";
import { rightSidebarOpen } from "@/components/ui/sidebar-r";

// On mobile the sidebars open as full-screen overlays, so the floating
// trigger buttons (questions / hider / zones) would sit on top of them. Hide
// those triggers whenever any sidebar is open on mobile — each sidebar has its
// own close control. Desktop keeps the triggers visible (they're the only
// toggle there, and the sidebars are docked rather than overlaid).
export const useHideSidebarTriggers = () => {
    const { isMobile, openMobile } = useStore(SidebarContext);
    const hiderOpen = useStore(hiderSidebarOpen);
    const rightOpen = useStore(rightSidebarOpen);

    return isMobile && (openMobile || hiderOpen || rightOpen);
};
