const copyrightName = "CypressTestCopyright";
const moreThan50Chars =
    "lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua";
const invalidInput = ";@$^&*!@#$%^&*()_+";

describe("Copyright page", () => {
    beforeEach(() => {
        cy.visit(Cypress.config().baseUrl + "login");
        cy.login("admin", "secret");
        cy.homeShouldBeVisible();
        cy.get(".md-toolbar-row")
            .contains("Manage")
            .click()
            .get(".md-list-item-content")
            .contains("Copyright")
            .click();
        cy.copyrightPageShouldBeVisible();
    });

    // afterEach(() => {
    //     cy.logout();
    // });

    // Add a new copyright to the list
    it("Should add a new copyright successfully", () => {
        cy.get("table")
            .get("tbody")
            .then((ele) => {
                if (!ele.text().includes(copyrightName)) {
                    cy.get(".md-button").contains("ADD").click();
                    cy.get("#form-save-copyright")
                        .get("input[name='copyright']")
                        .type(copyrightName);
                    cy.get("#form-save-copyright")
                        .get(".md-radio")
                        .contains("BCIT Employee")
                        .click();
                    cy.get("#form-save-copyright")
                        .get(".md-button-content")
                        .contains("Save")
                        .click();
                    cy.get(".md-dialog-actions")
                        .get("button")
                        .contains("Close")
                        .click();
                    cy.get("table").should("contain", copyrightName);
                }
            });
    });

    // Search for an existing copyright
    it("Should search for an existing copyright successfully", () => {
        cy.get("input[placeholder='Search by name...']").type(copyrightName);
        cy.get("button").contains("Search").click();
        cy.get(".md-table-row").should("not.have.length", 0);
    });

    // Edit an existing copyright
    it("Should edit an existing copyright successfully", () => {
        cy.get("table")
            .get(".md-table-cell-container")
            .then((ele) => {
                if (ele.text().includes(copyrightName)) {
                    cy.contains(copyrightName)
                        .parent()
                        .parent()
                        .contains("Edit")
                        .click();
                    cy.get("#form-save-copyright")
                        .get("input[name=copyright]")
                        .type("Modified");
                    cy.get("#form-save-copyright")
                        .get(".md-dialog-actions")
                        .get("button")
                        .contains("Save")
                        .click();
                    cy.get(".md-dialog-actions")
                        .get("button")
                        .contains("Close")
                        .click();
                    cy.get("table").should("contain", "Modified");
                }
            });
    });

    // Delete an existing copyright
    it("Should delete an existing copyright successfully", () => {
        cy.get("table")
            .get(".md-table-cell-container")
            .then((ele) => {
                if (ele.text().includes(copyrightName)) {
                    cy.contains(copyrightName)
                        .parent()
                        .parent()
                        .contains("Delete")
                        .click();
                    cy.get(".md-dialog-actions")
                        .get("button")
                        .contains("Delete")
                        .click();
                    cy.get(".md-dialog-actions")
                        .get("button")
                        .contains("Ok")
                        .click();
                }
            });
    });

    // Check if warning displayed when the new copyright's length is more than 50 chars.
    // it("Should display warning when search input length is more than 50 chars", () => {
    //     cy.get(".md-button").contains("ADD").click();
    //     cy.get("#form-save-copyright")
    //         .get("input[name=copyright]")
    //         .type(moreThan50Chars);
    //     cy.get("#form-save-copyright")
    //         .get(".md-radio")
    //         .contains("BCIT Employee")
    //         .click();
    //     cy.get("#form-save-copyright")
    //         .get(".md-button-content")
    //         .contains("Save")
    //         .click();
    //     cy.get("#form-save-copyright")
    //         .get(".md-error")
    //         .should("not.have.length", 0);
    //     cy.get(".md-dialog-actions").get("button").contains("Close").click();
    // });

    // Check it's not allowing special characters in the new copyright's name.
    it("Should not allow special characters in the copyright's name", () => {
        cy.get(".md-button").contains("ADD").click();
        cy.get("#form-save-copyright")
            .get("input[name=copyright]")
            .type(invalidInput);
        cy.get("#form-save-copyright")
            .get(".md-radio")
            .contains("BCIT Employee")
            .click();
        cy.get("#form-save-copyright")
            .get(".md-button-content")
            .contains("Save")
            .click();

        cy.get("#form-save-copyright")
            .get(".md-form-copyright")
            .get(".md-error")
            .should(
                "contain",
                "Only number, letter, single whitespace, '-' and '_' are allowed."
            );
        cy.get(".md-dialog-actions").get("button").contains("Close").click();
    });
});
