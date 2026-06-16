import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ImageMetadataFields from "../../src/components/ImageMetadataFields";
import type { ImageMetadataValues } from "../../src/components/ImageMetadataFields";

const defaultValues: ImageMetadataValues = {
    copyright: "",
    note: "",
    active: true,
};

const longNote = [
    "**Lorem Ipsum**\u00A0is simply dummy text of the printing and typesetting industry.",
    "Lorem Ipsum has been the industry's standard dummy text ever since 1966, when designers at Letraset and James Mosley, the librarian at St Bride Printing Library in London, took a 1914 Cicero translation and scrambled it to make dummy text for Letraset's Body Type sheets.",
    "It has survived not only many decades, but also the leap into electronic typesetting, remaining essentially unchanged.",
    "It was popularised thanks to these sheets and more recently with desktop publishing software including versions of Lorem Ipsum.",
].join(" ");

describe("ImageMetadataFields", () => {
    it("renders all form fields", () => {
        render(
            <ImageMetadataFields values={defaultValues} onChange={vi.fn()} />,
        );
        expect(screen.getByLabelText(/copyright/i)).toBeInTheDocument();
        expect(screen.getByLabelText(/note/i)).toBeInTheDocument();
        expect(screen.getByLabelText(/visibility/i)).toBeInTheDocument();
    });

    it("calls onChange when copyright text is entered", async () => {
        const onChange = vi.fn();
        const user = userEvent.setup();
        render(
            <ImageMetadataFields values={defaultValues} onChange={onChange} />,
        );

        const copyrightField = screen.getByLabelText(/copyright/i);
        await user.type(copyrightField, "A");

        expect(onChange).toHaveBeenCalledWith(
            expect.objectContaining({ copyright: "A" }),
        );
    });

    it("calls onChange when note text is entered", async () => {
        const onChange = vi.fn();
        const user = userEvent.setup();
        render(
            <ImageMetadataFields values={defaultValues} onChange={onChange} />,
        );

        const noteField = screen.getByLabelText(/note/i);
        await user.type(noteField, "X");
        expect(onChange).toHaveBeenCalledWith(
            expect.objectContaining({ note: "X" }),
        );
    });

    it("renders the note field as a multiline textarea", () => {
        render(
            <ImageMetadataFields values={defaultValues} onChange={vi.fn()} />,
        );

        expect(screen.getByLabelText(/note/i)).toBeInstanceOf(
            HTMLTextAreaElement,
        );
    });

    it("renders a long note paragraph in the multiline field", () => {
        render(
            <ImageMetadataFields
                values={{ ...defaultValues, note: longNote }}
                onChange={vi.fn()}
            />,
        );

        const noteField = screen.getByLabelText(/note/i);

        expect(noteField).toBeInstanceOf(HTMLTextAreaElement);
        expect(noteField).toBeVisible();
        expect(noteField).toHaveDisplayValue(longNote);
    });

    it("calls onChange when active toggle is switched", async () => {
        const onChange = vi.fn();
        const user = userEvent.setup();
        render(
            <ImageMetadataFields values={defaultValues} onChange={onChange} />,
        );

        const toggle = screen.getByRole("switch", {
            name: /visibility.*visible to students/i,
        });
        await user.click(toggle);
        expect(onChange).toHaveBeenCalledWith(
            expect.objectContaining({ active: false }),
        );
    });

    it("shows placeholder text for copyright and note", () => {
        render(
            <ImageMetadataFields
                values={defaultValues}
                onChange={vi.fn()}
                copyrightPlaceholder="custom copyright"
                notePlaceholder="custom note"
            />,
        );
        expect(
            screen.getByPlaceholderText("custom copyright"),
        ).toBeInTheDocument();
        expect(screen.getByPlaceholderText("custom note")).toBeInTheDocument();
    });
});
