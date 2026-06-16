import "@testing-library/jest-dom/vitest";

function createMemoryStorage(): Storage {
    const items = new Map<string, string>();

    return {
        get length() {
            return items.size;
        },
        clear() {
            items.clear();
        },
        getItem(key: string) {
            return items.get(key) ?? null;
        },
        key(index: number) {
            return Array.from(items.keys())[index] ?? null;
        },
        removeItem(key: string) {
            items.delete(key);
        },
        setItem(key: string, value: string) {
            items.set(key, String(value));
        },
    };
}

const testLocalStorage = createMemoryStorage();

Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: testLocalStorage,
    writable: true,
});

if (typeof window !== "undefined") {
    Object.defineProperty(window, "localStorage", {
        configurable: true,
        value: testLocalStorage,
        writable: true,
    });
}

// @dnd-kit/dom requires ResizeObserver which jsdom does not provide.
if (typeof globalThis.ResizeObserver === "undefined") {
    globalThis.ResizeObserver = class ResizeObserver {
        observe() {}
        unobserve() {}
        disconnect() {}
    } as unknown as typeof globalThis.ResizeObserver;
}
