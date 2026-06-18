import "@testing-library/jest-dom/vitest";

class LocalStorageMock implements Storage {
    private store = new Map<string, string>();

    get length() {
        return this.store.size;
    }

    clear() {
        this.store.clear();
    }

    getItem(key: string) {
        return this.store.get(key) ?? null;
    }

    key(index: number) {
        return Array.from(this.store.keys())[index] ?? null;
    }

    removeItem(key: string) {
        this.store.delete(key);
    }

    setItem(key: string, value: string) {
        this.store.set(key, String(value));
    }
}

function installLocalStorage(): void {
    const storage = new LocalStorageMock();

    if (typeof window !== "undefined") {
        Object.defineProperty(window, "localStorage", {
            value: storage,
            configurable: true,
        });
    }

    Object.defineProperty(globalThis, "localStorage", {
        value: storage,
        configurable: true,
    });
}

installLocalStorage();

// @dnd-kit/dom requires ResizeObserver which jsdom does not provide.
if (typeof globalThis.ResizeObserver === "undefined") {
    globalThis.ResizeObserver = class ResizeObserver {
        observe() {}
        unobserve() {}
        disconnect() {}
    } as unknown as typeof globalThis.ResizeObserver;
}
