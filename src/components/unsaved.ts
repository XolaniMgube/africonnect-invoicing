"use client";
import { useEffect } from "react";
export function useUnsavedChanges(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    const warning = "You have unsaved changes. Leave and discard them?";
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    const click = (event: MouseEvent) => {
      const link = (event.target as Element).closest(
        "a[href]",
      ) as HTMLAnchorElement | null;
      // Download links (e.g. the PDF) don't leave the page.
      if (
        link &&
        !link.hasAttribute("download") &&
        link.href !== location.href &&
        !window.confirm(warning)
      ) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    // Navigation API covers browser back/forward in Chromium; link and unload guards cover other browsers.
    const navigation = (window as unknown as { navigation?: EventTarget })
      .navigation;
    const navigate = (event: Event) => {
      const e = event as Event & {
        navigationType: string;
        destination: { url: string };
        cancelable: boolean;
      };
      if (
        e.navigationType === "traverse" &&
        e.destination.url !== location.href &&
        e.cancelable &&
        !window.confirm(warning)
      )
        e.preventDefault();
    };
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("click", click, true);
    navigation?.addEventListener("navigate", navigate);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("click", click, true);
      navigation?.removeEventListener("navigate", navigate);
    };
  }, [dirty]);
}

export function hasVisibleUnsavedChanges() {
  return Array.from(document.querySelectorAll('[data-unsaved="true"]')).some(
    (element) => (element as HTMLElement).offsetParent !== null,
  );
}
