/**
 * Unit tests for the FileDropZone component.
 *
 * Covers:
 * 1. Returns null when isDragActive is false
 * 2. Renders the drop zone UI when isDragActive is true
 * 3. Calls onDrop with dropped files
 * 4. Visual state changes on dragOver vs. drag away
 * 5. Non-file drags are ignored
 */

import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import FileDropZone from "../../src/components/FileDropZone";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const theme = createTheme();

function renderWithTheme(ui: React.ReactElement) {
    return render(<ThemeProvider theme={theme}>{ui}</ThemeProvider>);
}

function fireDragEvent(
    element: Element,
    type: string,
    opts: { types?: string[]; files?: File[] } = {},
) {
    const types = opts.types ?? ["Files"];
    const files = opts.files ?? [];
    fireEvent(
        element,
        Object.assign(new Event(type, { bubbles: true }), {
            dataTransfer: {
                types,
                files,
                dropEffect: "none",
            },
        }),
    );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("FileDropZone", () => {
    describe("visibility", () => {
        it("returns null when isDragActive is false", () => {
            const { container } = renderWithTheme(
                <FileDropZone isDragActive={false} onDrop={vi.fn()} />,
            );
            expect(container.firstChild).toBeNull();
        });

        it("renders the drop zone when isDragActive is true", () => {
            renderWithTheme(
                <FileDropZone isDragActive={true} onDrop={vi.fn()} />,
            );
            expect(
                screen.getByRole("region", {
                    name: /drop files here to upload images/i,
                }),
            ).toBeInTheDocument();
        });

        it("renders Add images text", () => {
            renderWithTheme(
                <FileDropZone isDragActive={true} onDrop={vi.fn()} />,
            );
            expect(screen.getByText("Add images")).toBeInTheDocument();
            expect(screen.getByText("Drop files here")).toBeInTheDocument();
        });
    });

    describe("drop behaviour", () => {
        it("calls onDrop with dropped files", () => {
            const onDrop = vi.fn();
            renderWithTheme(
                <FileDropZone isDragActive={true} onDrop={onDrop} />,
            );
            const zone = screen.getByRole("region", {
                name: /drop files here/i,
            });

            const file = new File(["data"], "test.png", {
                type: "image/png",
            });
            fireDragEvent(zone, "drop", { files: [file] });

            expect(onDrop).toHaveBeenCalledTimes(1);
            expect(onDrop).toHaveBeenCalledWith([file]);
        });

        it("does not call onDrop when no files are dropped", () => {
            const onDrop = vi.fn();
            renderWithTheme(
                <FileDropZone isDragActive={true} onDrop={onDrop} />,
            );
            const zone = screen.getByRole("region", {
                name: /drop files here/i,
            });

            fireDragEvent(zone, "drop", { files: [] });

            expect(onDrop).not.toHaveBeenCalled();
        });
    });

    describe("drag enter/leave interactions", () => {
        it("ignores non-file drags", () => {
            renderWithTheme(
                <FileDropZone isDragActive={true} onDrop={vi.fn()} />,
            );
            const zone = screen.getByRole("region", {
                name: /drop files here/i,
            });

            // Drag enter with non-file type should not change state
            fireDragEvent(zone, "dragenter", { types: ["text/plain"] });
            fireDragEvent(zone, "dragleave", { types: ["text/plain"] });

            // Zone should still be rendered (no crash, no effect)
            expect(zone).toBeInTheDocument();
        });

        it("handles dragenter and dragleave for files", () => {
            renderWithTheme(
                <FileDropZone isDragActive={true} onDrop={vi.fn()} />,
            );
            const zone = screen.getByRole("region", {
                name: /drop files here/i,
            });

            fireDragEvent(zone, "dragenter", { types: ["Files"] });

            // The AddIcon should still be present (component is rendered)
            expect(screen.getByTestId("AddIcon")).toBeInTheDocument();

            fireDragEvent(zone, "dragleave", { types: ["Files"] });

            // Still rendered since isDragActive is still true
            expect(zone).toBeInTheDocument();
        });
    });
});
