/**
 * Unit tests for the SearchModal component.
 *
 * Covers:
 * 1. Search query persists after closing and re-opening the modal
 * 2. Filter selections persist after closing and re-opening the modal
 * 3. Search results display correctly for a matching query
 * 4. No results message displays for a non-matching query
 * 5. Selecting a result calls onClose and the appropriate navigation callback
 * 6. Searching by program name finds associated categories
 * 7. Searching by program name finds images within associated categories
 * 8. Searching by category name finds images within that category
 * 9. Searching by program name finds users assigned to that program
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SearchModal from "../../src/components/SearchModal";
import type { Category, Program } from "../../src/types";
import type { ApiUser } from "../../src/api";

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const testCategory: Category = {
    id: 1,
    label: "Histology",
    parentId: null,
    children: [],
    images: [
        {
            id: 10,
            name: "Liver Section",
            thumb: "/thumb/10.jpg",
            tileSources: "/tiles/10.dzi",
            categoryId: 1,
            copyright: "2026 BCIT",
            note: "Sample liver tissue",
            active: true,
            version: 1,
        },
    ],
    programIds: [1],
    status: null,
    cardImageId: null,
    metadataExtra: null,
};

const testPrograms: Program[] = [
    { id: 1, name: "Medical Lab Science", oidc_group: null, created_at: "", updated_at: "" },
];

const testUsers: ApiUser[] = [
    {
        id: 50,
        name: "Jane Doe",
        email: "jane@bcit.ca",
        role: "instructor",
        program_ids: [1],
        program_names: ["Medical Lab Science"],
        last_access: null,
        metadata_extra: null,
        created_at: "",
        updated_at: "",
    },
];

const defaultProps = {
    open: true,
    onClose: vi.fn(),
    categories: [testCategory],
    uncategorizedImages: [],
    programs: testPrograms,
    users: testUsers,
    isStudent: false,
    onSelectCategory: vi.fn(),
    onSelectImage: vi.fn(),
    onSelectProgram: vi.fn(),
    onSelectUser: vi.fn(),
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SearchModal", () => {
    it("persists the search query after closing and re-opening", async () => {
        const user = userEvent.setup();
        const { rerender } = render(
            <SearchModal {...defaultProps} open={true} />,
        );

        // Type a search query
        const input = screen.getByPlaceholderText(
            "Search categories, images, programs, people",
        );
        await user.type(input, "Liver");

        expect(input).toHaveValue("Liver");

        // Close the modal
        rerender(<SearchModal {...defaultProps} open={false} />);

        // Re-open the modal
        rerender(<SearchModal {...defaultProps} open={true} />);

        // Query should still be present
        const reopenedInput = screen.getByPlaceholderText(
            "Search categories, images, programs, people",
        );
        expect(reopenedInput).toHaveValue("Liver");
    });

    it("persists filter selections after closing and re-opening", async () => {
        const user = userEvent.setup();
        const { rerender } = render(
            <SearchModal {...defaultProps} open={true} />,
        );

        // Type a query to show filter chips
        const input = screen.getByPlaceholderText(
            "Search categories, images, programs, people",
        );
        await user.type(input, "Liver");

        // Click the "Images" type filter chip
        const imagesChip = screen.getByText("Images");
        await user.click(imagesChip);

        // Close the modal
        rerender(<SearchModal {...defaultProps} open={false} />);

        // Re-open the modal
        rerender(<SearchModal {...defaultProps} open={true} />);

        // The query should persist, and the Images chip should still be selected (filled variant)
        expect(
            screen.getByPlaceholderText(
                "Search categories, images, programs, people",
            ),
        ).toHaveValue("Liver");
        // The Images chip should still be in the selected (filled) state, not just present
        const imagesChipAfterReopen = screen
            .getByText("Images")
            .closest('[class*="MuiChip-root"]')!;
        expect(imagesChipAfterReopen.className).toMatch(/MuiChip-filled/);
        expect(imagesChipAfterReopen.className).not.toMatch(/MuiChip-outlined/);
    });

    it("displays search results for a matching query", async () => {
        const user = userEvent.setup();
        render(<SearchModal {...defaultProps} open={true} />);

        const input = screen.getByPlaceholderText(
            "Search categories, images, programs, people",
        );
        await user.type(input, "Liver");

        // Should find results for "Liver Section" (may appear multiple times for different field matches)
        const results = screen.getAllByText("Liver Section");
        expect(results.length).toBeGreaterThan(0);
    });

    it("displays no results message for a non-matching query", async () => {
        const user = userEvent.setup();
        render(<SearchModal {...defaultProps} open={true} />);

        const input = screen.getByPlaceholderText(
            "Search categories, images, programs, people",
        );
        await user.type(input, "xyznonexistent");

        expect(screen.getByText(/No results found/)).toBeInTheDocument();
    });

    it("calls onClose and onSelectImage when an image result is clicked", async () => {
        const user = userEvent.setup();
        const onClose = vi.fn();
        const onSelectImage = vi.fn();
        render(
            <SearchModal
                {...defaultProps}
                onClose={onClose}
                onSelectImage={onSelectImage}
                open={true}
            />,
        );

        const input = screen.getByPlaceholderText(
            "Search categories, images, programs, people",
        );
        await user.type(input, "Liver");

        // Click the first result button (image result for "Liver Section")
        const resultButtons = screen
            .getAllByRole("button")
            .filter((btn) => btn.closest('[class*="MuiCard"]'));
        await user.click(resultButtons[0]);

        expect(onClose).toHaveBeenCalled();
        expect(onSelectImage).toHaveBeenCalledWith(testCategory.images[0], [
            testCategory,
        ]);
    });

    it("calls onClose and onSelectCategory when a category result is clicked", async () => {
        const user = userEvent.setup();
        const onClose = vi.fn();
        const onSelectCategory = vi.fn();
        render(
            <SearchModal
                {...defaultProps}
                onClose={onClose}
                onSelectCategory={onSelectCategory}
                open={true}
            />,
        );

        const input = screen.getByPlaceholderText(
            "Search categories, images, programs, people",
        );
        await user.type(input, "Histology");

        // Click the first result button (category result for "Histology")
        const resultButtons = screen
            .getAllByRole("button")
            .filter((btn) => btn.closest('[class*="MuiCard"]'));
        await user.click(resultButtons[0]);

        expect(onClose).toHaveBeenCalled();
        expect(onSelectCategory).toHaveBeenCalledWith([testCategory]);
    });

    it("finds categories by associated program name", async () => {
        const user = userEvent.setup();
        render(<SearchModal {...defaultProps} open={true} />);

        const input = screen.getByPlaceholderText(
            "Search categories, images, programs, people",
        );
        await user.type(input, "Medical Lab");

        // Should find "Histology" category via its program association
        const labels = screen.getAllByText("Histology");
        expect(labels.length).toBeGreaterThan(0);

        // The matched field should show "Program"
        expect(screen.getAllByText(/Program:/).length).toBeGreaterThan(0);
    });

    it("finds images by parent category name", async () => {
        const user = userEvent.setup();
        render(<SearchModal {...defaultProps} open={true} />);

        const input = screen.getByPlaceholderText(
            "Search categories, images, programs, people",
        );
        await user.type(input, "Histology");

        // Should find "Liver Section" image via its parent category name
        const imageResults = screen.getAllByText("Liver Section");
        expect(imageResults.length).toBeGreaterThan(0);

        // One of the matched fields should show "Category"
        expect(screen.getAllByText(/Category:/).length).toBeGreaterThan(0);
    });

    it("finds images by program name of parent category", async () => {
        const user = userEvent.setup();
        render(<SearchModal {...defaultProps} open={true} />);

        const input = screen.getByPlaceholderText(
            "Search categories, images, programs, people",
        );
        await user.type(input, "Medical Lab");

        // Should find "Liver Section" image via its parent category's program
        const imageResults = screen.getAllByText("Liver Section");
        expect(imageResults.length).toBeGreaterThan(0);
    });

    it("finds users by assigned program name", async () => {
        const user = userEvent.setup();
        render(<SearchModal {...defaultProps} open={true} />);

        const input = screen.getByPlaceholderText(
            "Search categories, images, programs, people",
        );
        await user.type(input, "Medical Lab");

        // Should find "Jane Doe" user via her program assignment
        const userResults = screen.getAllByText("Jane Doe");
        expect(userResults.length).toBeGreaterThan(0);
    });

    it("displays thumbnail for image results", async () => {
        const user = userEvent.setup();
        render(<SearchModal {...defaultProps} open={true} />);

        const input = screen.getByPlaceholderText(
            "Search categories, images, programs, people",
        );
        await user.type(input, "Liver");

        const thumbs = screen.getAllByAltText("Liver Section");
        expect(thumbs.length).toBeGreaterThan(0);
        expect(thumbs[0]).toHaveAttribute("src", "/thumb/10.jpg");
    });

    it("displays category path for image results", async () => {
        const user = userEvent.setup();
        render(<SearchModal {...defaultProps} open={true} />);

        const input = screen.getByPlaceholderText(
            "Search categories, images, programs, people",
        );
        await user.type(input, "Liver");

        // The parent category "Histology" should appear in the image result card
        // as part of the category path (not just as a separate category result)
        const cards = screen.getAllByText("Liver Section");
        expect(cards.length).toBeGreaterThan(0);
        // Category path rendered inside image result
        const histologyLabels = screen.getAllByText("Histology");
        expect(histologyLabels.length).toBeGreaterThan(0);
    });

    it("displays right-aligned program chips on category results", async () => {
        const user = userEvent.setup();
        render(<SearchModal {...defaultProps} open={true} />);

        const input = screen.getByPlaceholderText(
            "Search categories, images, programs, people",
        );
        await user.type(input, "Histology");

        // Program chip "Medical Lab Science" should appear on the category result
        const chips = screen.getAllByText("Medical Lab Science");
        expect(chips.length).toBeGreaterThan(0);
    });

    it("displays right-aligned program chips on user results", async () => {
        const user = userEvent.setup();
        render(<SearchModal {...defaultProps} open={true} />);

        const input = screen.getByPlaceholderText(
            "Search categories, images, programs, people",
        );
        await user.type(input, "Jane");

        // Program chip "Medical Lab Science" should appear on the user result
        const chips = screen.getAllByText("Medical Lab Science");
        expect(chips.length).toBeGreaterThan(0);
    });
});
