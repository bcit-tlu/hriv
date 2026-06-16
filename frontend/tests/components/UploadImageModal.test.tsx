import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../../src/api", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../../src/api")>();
    return {
        ...actual,
        uploadSourceImage: vi.fn(),
        bulkImportImages: vi.fn(),
    };
});

// CategoryPickerSelect uses canvas internally; mock it
vi.mock("../../src/components/CategoryPickerSelect", () => ({
    default: () => <div data-testid="category-picker" />,
}));

import UploadImageModal from "../../src/components/UploadImageModal";
import type { Category, Program } from "../../src/types";

const categories: Category[] = [
    {
        id: 1,
        label: "Root",
        parentId: null,
        children: [],
        images: [],
        programIds: [],
        groupIds: [],
        sortOrder: 0,
        version: 1,
        cardImageId: null,
        hidden: false,
    },
];

const programs: Program[] = [
    {
        id: 1,
        name: "Medical Lab",
        oidc_group: null,
        created_at: "",
        updated_at: "",
    },
];

const longNote = [
    "**Lorem Ipsum**\u00A0is simply dummy text of the printing and typesetting industry.",
    "Lorem Ipsum has been the industry's standard dummy text ever since 1966, when designers at Letraset and James Mosley, the librarian at St Bride Printing Library in London, took a 1914 Cicero translation and scrambled it to make dummy text for Letraset's Body Type sheets.",
    "It has survived not only many decades, but also the leap into electronic typesetting, remaining essentially unchanged.",
    "It was popularised thanks to these sheets and more recently with desktop publishing software including versions of Lorem Ipsum.",
].join(" ");

describe("UploadImageModal", () => {
    beforeEach(() => vi.clearAllMocks());

    it("renders title and upload area when open", () => {
        render(
            <UploadImageModal
                open
                onClose={vi.fn()}
                onUploaded={vi.fn()}
                categories={categories}
                programs={programs}
            />,
        );
        expect(screen.getByText("Add Images")).toBeInTheDocument();
        expect(
            screen.getByText(/drag.*drop|choose.*files/i),
        ).toBeInTheDocument();
    });

    it("renders Cancel button", () => {
        render(
            <UploadImageModal
                open
                onClose={vi.fn()}
                onUploaded={vi.fn()}
                categories={categories}
                programs={programs}
            />,
        );
        expect(
            screen.getByRole("button", { name: /cancel/i }),
        ).toBeInTheDocument();
    });

    it("blurs the focused cancel button before closing after a long note is entered", async () => {
        const user = userEvent.setup();
        const onClose = vi.fn();
        render(
            <UploadImageModal
                open
                onClose={onClose}
                onUploaded={vi.fn()}
                categories={categories}
                programs={programs}
            />,
        );

        fireEvent.change(screen.getByLabelText(/note/i), {
            target: { value: longNote },
        });

        const cancelButton = screen.getByRole("button", { name: /cancel/i });
        cancelButton.focus();

        await user.click(cancelButton);

        expect(onClose).toHaveBeenCalledOnce();
        expect(cancelButton).not.toHaveFocus();
    });

    it("renders category picker", () => {
        render(
            <UploadImageModal
                open
                onClose={vi.fn()}
                onUploaded={vi.fn()}
                categories={categories}
                programs={programs}
            />,
        );
        expect(screen.getByTestId("category-picker")).toBeInTheDocument();
    });

    it("renders combined helper text", () => {
        render(
            <UploadImageModal
                open
                onClose={vi.fn()}
                onUploaded={vi.fn()}
                categories={categories}
                programs={programs}
            />,
        );
        expect(
            screen.getByText(
                /Uploaded images are processed into zoomable views/,
            ),
        ).toBeInTheDocument();
        expect(
            screen.getByText(/ZIP uploads are automatically extracted/),
        ).toBeInTheDocument();
    });

    it("renders nothing when closed", () => {
        const { container } = render(
            <UploadImageModal
                open={false}
                onClose={vi.fn()}
                onUploaded={vi.fn()}
                categories={categories}
                programs={programs}
            />,
        );
        expect(container.querySelector('[role="dialog"]')).toBeNull();
    });
});
