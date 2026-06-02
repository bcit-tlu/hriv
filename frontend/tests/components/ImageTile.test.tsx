/**
 * Unit tests for the ImageTile component.
 *
 * Covers:
 * 1. Basic rendering — image name, thumbnail, and card structure
 * 2. Inactive indicator — dimmed title and DisabledVisible icon when active=false
 * 3. Active images — no inactive indicator when active=true
 * 4. Copyright text — renders copyright when present
 * 5. Edit details button — renders and calls callback
 * 6. Visibility toggle — renders toggle button, calls callback, correct icon states
 */

import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ImageTile from "../../src/components/ImageTile";
import { MIME_HRIV_IMAGE } from "../../src/components/ImageTile";
import type { ImageItem } from "../../src/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeImage(overrides: Partial<ImageItem> = {}): ImageItem {
    return {
        id: 1,
        name: "Test Image",
        thumb: "/thumbs/test.jpg",
        tileSources: "/tiles/test.dzi",
        programIds: [],
        active: true,
        sortOrder: 0,
        version: 1,
        ...overrides,
    };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ImageTile", () => {
    // ─── Basic rendering ──────────────────────────────────────────────

    describe("basic rendering", () => {
        it("renders the image name", () => {
            render(<ImageTile image={makeImage()} onClick={vi.fn()} />);
            expect(screen.getByText("Test Image")).toBeInTheDocument();
        });

        it("renders the thumbnail image", () => {
            render(<ImageTile image={makeImage()} onClick={vi.fn()} />);
            const img = screen.getByAltText("Test Image");
            expect(img).toBeInTheDocument();
            expect(img).toHaveAttribute("src", "/thumbs/test.jpg");
        });

        it("calls onClick when the card is clicked", async () => {
            const user = userEvent.setup();
            const image = makeImage();
            const onClick = vi.fn();
            render(<ImageTile image={image} onClick={onClick} />);

            await user.click(screen.getByText("Test Image"));
            expect(onClick).toHaveBeenCalledWith(image);
        });
    });

    // ─── Inactive indicator ───────────────────────────────────────────

    describe("inactive indicator", () => {
        it("shows the inactive icon with tooltip when image is inactive", () => {
            render(
                <ImageTile
                    image={makeImage({ active: false })}
                    onClick={vi.fn()}
                />,
            );
            expect(
                screen.getByTestId("DisabledVisibleIcon"),
            ).toBeInTheDocument();
        });

        it("dims the card content when image is inactive", () => {
            render(
                <ImageTile
                    image={makeImage({ active: false, name: "Inactive Slide" })}
                    onClick={vi.fn()}
                />,
            );
            const title = screen.getByText("Inactive Slide");
            expect(title.closest(".MuiCardContent-root")).toHaveStyle({
                opacity: 0.5,
            });
        });

        it("does not show the inactive icon when image is active", () => {
            render(
                <ImageTile
                    image={makeImage({ active: true })}
                    onClick={vi.fn()}
                />,
            );
            expect(
                screen.queryByTestId("DisabledVisibleIcon"),
            ).not.toBeInTheDocument();
        });

        it("card content has full opacity when image is active", () => {
            render(
                <ImageTile
                    image={makeImage({ active: true, name: "Active Slide" })}
                    onClick={vi.fn()}
                />,
            );
            const title = screen.getByText("Active Slide");
            expect(title.closest(".MuiCardContent-root")).toHaveStyle({
                opacity: 1,
            });
        });
    });

    // ─── Copyright ────────────────────────────────────────────────────

    describe("copyright", () => {
        it("renders copyright text when present", () => {
            render(
                <ImageTile
                    image={makeImage({ copyright: "BCIT 2024" })}
                    onClick={vi.fn()}
                />,
            );
            expect(screen.getByText(/BCIT 2024/)).toBeInTheDocument();
        });

        it("does not render copyright when not provided", () => {
            render(
                <ImageTile
                    image={makeImage({ copyright: null })}
                    onClick={vi.fn()}
                />,
            );
            expect(screen.queryByText(/©/)).not.toBeInTheDocument();
        });
    });

    // ─── Edit details button ──────────────────────────────────────────

    describe("edit details button", () => {
        it("renders the edit button when onEditDetails is provided", () => {
            render(
                <ImageTile
                    image={makeImage()}
                    onClick={vi.fn()}
                    onEditDetails={vi.fn()}
                />,
            );
            expect(
                screen.getByLabelText("Edit image details"),
            ).toBeInTheDocument();
            expect(screen.getByTestId("EditIcon")).toBeInTheDocument();
        });

        it("calls onEditDetails when the edit button is clicked", async () => {
            const user = userEvent.setup();
            const image = makeImage();
            const onEditDetails = vi.fn();
            render(
                <ImageTile
                    image={image}
                    onClick={vi.fn()}
                    onEditDetails={onEditDetails}
                />,
            );

            await user.click(screen.getByLabelText("Edit image details"));
            expect(onEditDetails).toHaveBeenCalledWith(image);
        });

        it("does not render the edit button when onEditDetails is not provided", () => {
            render(<ImageTile image={makeImage()} onClick={vi.fn()} />);
            expect(
                screen.queryByLabelText("Edit image details"),
            ).not.toBeInTheDocument();
        });
    });

    // ─── Visibility toggle ────────────────────────────────────────────

    describe("visibility toggle", () => {
        it("renders the VisibilityIcon when image is active and toggle provided", () => {
            render(
                <ImageTile
                    image={makeImage({ active: true })}
                    onClick={vi.fn()}
                    onToggleVisibility={vi.fn()}
                />,
            );
            expect(screen.getByTestId("VisibilityIcon")).toBeInTheDocument();
            expect(
                screen.queryByTestId("DisabledVisibleIcon"),
            ).not.toBeInTheDocument();
        });

        it("renders the DisabledVisibleIcon when image is inactive and toggle provided", () => {
            render(
                <ImageTile
                    image={makeImage({ active: false })}
                    onClick={vi.fn()}
                    onToggleVisibility={vi.fn()}
                />,
            );
            expect(
                screen.getByTestId("DisabledVisibleIcon"),
            ).toBeInTheDocument();
            expect(
                screen.queryByTestId("VisibilityIcon"),
            ).not.toBeInTheDocument();
        });

        it("calls onToggleVisibility with the image id when toggling", async () => {
            const user = userEvent.setup();
            const onToggle = vi.fn();
            render(
                <ImageTile
                    image={makeImage({ id: 42, active: true })}
                    onClick={vi.fn()}
                    onToggleVisibility={onToggle}
                />,
            );

            await user.click(screen.getByLabelText("Toggle visibility"));
            expect(onToggle).toHaveBeenCalledWith(42);
        });

        it("does not render the toggle button when onToggleVisibility is not provided", () => {
            render(
                <ImageTile
                    image={makeImage({ active: false })}
                    onClick={vi.fn()}
                />,
            );
            expect(
                screen.queryByLabelText("Toggle visibility"),
            ).not.toBeInTheDocument();
        });

        it("suppresses inline DisabledVisibleIcon when toggle is provided", () => {
            render(
                <ImageTile
                    image={makeImage({ active: false })}
                    onClick={vi.fn()}
                    onToggleVisibility={vi.fn()}
                />,
            );
            // Only one DisabledVisibleIcon (in the toggle button), not the inline one next to title
            const icons = screen.getAllByTestId("DisabledVisibleIcon");
            expect(icons).toHaveLength(1);
        });
    });

    // ─── Drag and drop ─────────────────────────────────────────────────

    describe("drag and drop", () => {
        it("sets draggable attribute when draggable prop is true", () => {
            const { container } = render(
                <ImageTile
                    image={makeImage()}
                    onClick={vi.fn()}
                    draggable
                />,
            );
            const card = container.querySelector(".MuiCard-root");
            expect(card).toHaveAttribute("draggable", "true");
        });

        it("does not set draggable when draggable prop is false", () => {
            const { container } = render(
                <ImageTile image={makeImage()} onClick={vi.fn()} />,
            );
            const card = container.querySelector(".MuiCard-root");
            expect(card).not.toHaveAttribute("draggable", "true");
        });

        it("sets image data on drag start", () => {
            const { container } = render(
                <ImageTile
                    image={makeImage({ id: 42 })}
                    onClick={vi.fn()}
                    draggable
                />,
            );
            const card = container.querySelector(".MuiCard-root")!;
            const dataStore: Record<string, string> = {};
            const dragEvent = new Event("dragstart", { bubbles: true });
            Object.assign(dragEvent, {
                dataTransfer: {
                    setData: (type: string, data: string) => {
                        dataStore[type] = data;
                    },
                    effectAllowed: "",
                },
            });
            fireEvent(card, dragEvent);
            expect(dataStore[MIME_HRIV_IMAGE]).toBe(
                JSON.stringify({ id: 42 }),
            );
        });

        it("reduces opacity while dragging", () => {
            const { container } = render(
                <ImageTile
                    image={makeImage()}
                    onClick={vi.fn()}
                    draggable
                />,
            );
            const card = container.querySelector(".MuiCard-root")!;
            const dragStart = new Event("dragstart", { bubbles: true });
            Object.assign(dragStart, {
                dataTransfer: {
                    setData: vi.fn(),
                    effectAllowed: "",
                },
            });
            fireEvent(card, dragStart);
            expect(card).toHaveStyle({ opacity: 0.4 });

            fireEvent.dragEnd(card);
            expect(card).toHaveStyle({ opacity: 1 });
        });
    });
});
