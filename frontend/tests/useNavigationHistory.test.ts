/**
 * Unit tests for useNavigationHistory hook and helpers.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import {
    useNavigationHistory,
    buildNavHistoryState,
} from "../src/useNavigationHistory";
import type { NavHistoryState } from "../src/useNavigationHistory";

describe("buildNavHistoryState", () => {
    it("returns an object with _hriv marker", () => {
        const state = buildNavHistoryState("browse", [], null);
        expect(state._hriv).toBe(true);
    });

    it("stores page, catIds, and imageId", () => {
        const state = buildNavHistoryState("manage", [1, 2, 3], 42);
        expect(state.page).toBe("manage");
        expect(state.catIds).toEqual([1, 2, 3]);
        expect(state.imageId).toBe(42);
    });
});

describe("useNavigationHistory", () => {
    let pushStateSpy: ReturnType<typeof vi.spyOn>;
    let addEventSpy: ReturnType<typeof vi.spyOn>;
    let removeEventSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        pushStateSpy = vi.spyOn(window.history, "pushState");
        addEventSpy = vi.spyOn(window, "addEventListener");
        removeEventSpy = vi.spyOn(window, "removeEventListener");
    });

    afterEach(() => {
        pushStateSpy.mockRestore();
        addEventSpy.mockRestore();
        removeEventSpy.mockRestore();
    });

    it("registers a popstate listener on mount", () => {
        const onPopState = vi.fn();
        renderHook(() => useNavigationHistory(onPopState));
        expect(addEventSpy).toHaveBeenCalledWith(
            "popstate",
            expect.any(Function),
        );
    });

    it("removes the popstate listener on unmount", () => {
        const onPopState = vi.fn();
        const { unmount } = renderHook(() => useNavigationHistory(onPopState));
        unmount();
        expect(removeEventSpy).toHaveBeenCalledWith(
            "popstate",
            expect.any(Function),
        );
    });

    describe("pushNavState", () => {
        it("calls history.pushState with a NavHistoryState object", () => {
            const onPopState = vi.fn();
            const { result } = renderHook(() =>
                useNavigationHistory(onPopState),
            );

            act(() => {
                result.current.pushNavState("browse", [5, 12], 456);
            });

            expect(pushStateSpy).toHaveBeenCalledTimes(1);
            const [state, , url] = pushStateSpy.mock.calls[0];
            const nav = state as NavHistoryState;
            expect(nav._hriv).toBe(true);
            expect(nav.page).toBe("browse");
            expect(nav.catIds).toEqual([5, 12]);
            expect(nav.imageId).toBe(456);
            expect(url).toContain("cat=5%2C12");
            expect(url).toContain("image=456");
        });

        it("omits page param for browse (default)", () => {
            const onPopState = vi.fn();
            const { result } = renderHook(() =>
                useNavigationHistory(onPopState),
            );

            act(() => {
                result.current.pushNavState("browse", [], null);
            });

            const [, , url] = pushStateSpy.mock.calls[0];
            expect(url).not.toContain("page=");
        });

        it("includes page param for non-browse pages", () => {
            const onPopState = vi.fn();
            const { result } = renderHook(() =>
                useNavigationHistory(onPopState),
            );

            act(() => {
                result.current.pushNavState("manage", [], null);
            });

            const [, , url] = pushStateSpy.mock.calls[0];
            expect(url).toContain("page=manage");
        });

        it("builds a clean pathname when browse with no cat/image", () => {
            const onPopState = vi.fn();
            const { result } = renderHook(() =>
                useNavigationHistory(onPopState),
            );

            act(() => {
                result.current.pushNavState("browse", [], null);
            });

            const [, , url] = pushStateSpy.mock.calls[0];
            // Should be just the pathname with no query string
            expect(url).toBe(window.location.pathname);
        });
    });

    describe("popstate handling", () => {
        it("calls onPopState with decoded state on popstate event", () => {
            const onPopState = vi.fn();
            renderHook(() => useNavigationHistory(onPopState));

            // Simulate a popstate event with our state
            const navState: NavHistoryState = {
                _hriv: true,
                page: "manage",
                catIds: [1, 2],
                imageId: 99,
            };
            const event = new PopStateEvent("popstate", { state: navState });
            window.dispatchEvent(event);

            expect(onPopState).toHaveBeenCalledWith("manage", [1, 2], 99);
        });

        it("defaults to browse root when popstate has no recognized state", () => {
            const onPopState = vi.fn();
            renderHook(() => useNavigationHistory(onPopState));

            const event = new PopStateEvent("popstate", { state: null });
            window.dispatchEvent(event);

            expect(onPopState).toHaveBeenCalledWith("browse", [], null);
        });

        it("defaults to browse root for foreign state objects", () => {
            const onPopState = vi.fn();
            renderHook(() => useNavigationHistory(onPopState));

            const event = new PopStateEvent("popstate", {
                state: { someOtherApp: true },
            });
            window.dispatchEvent(event);

            expect(onPopState).toHaveBeenCalledWith("browse", [], null);
        });

        it("uses the latest callback reference", () => {
            const first = vi.fn();
            const second = vi.fn();
            const { rerender } = renderHook(
                ({ cb }) => useNavigationHistory(cb),
                { initialProps: { cb: first } },
            );

            rerender({ cb: second });

            const event = new PopStateEvent("popstate", {
                state: { _hriv: true, page: "admin", catIds: [], imageId: null },
            });
            window.dispatchEvent(event);

            expect(first).not.toHaveBeenCalled();
            expect(second).toHaveBeenCalledWith("admin", [], null);
        });
    });
});
