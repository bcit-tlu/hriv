import { useEffect, useCallback, useRef } from "react";

/** Navigation state stored in `history.state` for back/forward support. */
export interface NavHistoryState {
    _hriv: true;
    page: string;
    catIds: number[];
    imageId: number | null;
}

function isNavState(s: unknown): s is NavHistoryState {
    return (
        s != null &&
        typeof s === "object" &&
        (s as NavHistoryState)._hriv === true
    );
}

/** Build a NavHistoryState object (for use with `replaceState`). */
export function buildNavHistoryState(
    page: string,
    catIds: number[],
    imageId: number | null,
): NavHistoryState {
    return { _hriv: true, page, catIds, imageId };
}

/**
 * Listen for `popstate` (back/forward) and provide `pushNavState` for
 * pushing new history entries on user-initiated navigation.
 */
export function useNavigationHistory(
    onPopState: (
        page: string,
        catIds: number[],
        imageId: number | null,
    ) => void,
) {
    const callbackRef = useRef(onPopState);
    callbackRef.current = onPopState;

    useEffect(() => {
        const handler = (event: PopStateEvent) => {
            if (isNavState(event.state)) {
                callbackRef.current(
                    event.state.page,
                    event.state.catIds,
                    event.state.imageId,
                );
            } else {
                callbackRef.current("browse", [], null);
            }
        };
        window.addEventListener("popstate", handler);
        return () => window.removeEventListener("popstate", handler);
    }, []);

    const pushNavState = useCallback(
        (page: string, catIds: number[], imageId: number | null) => {
            const state = buildNavHistoryState(page, catIds, imageId);
            const params = new URLSearchParams();
            if (page !== "browse") params.set("page", page);
            if (page === "browse" && catIds.length > 0)
                params.set("cat", catIds.join(","));
            if (page === "browse" && imageId != null)
                params.set("image", String(imageId));
            const qs = params.toString();
            const url = qs
                ? `${window.location.pathname}?${qs}`
                : window.location.pathname;
            window.history.pushState(state, "", url);
        },
        [],
    );

    return { pushNavState };
}
