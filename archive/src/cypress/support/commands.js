import "cypress-file-upload";

const programSelection = "LTC Users";
const programSelection2 = "BCIT Employee";

Cypress.Commands.add("login", (username, password) => {
    cy.get('input[name="username"]').type(username);
    cy.get('input[name="password"]').type(password);
    cy.get('button[type="submit"]').click();
});

Cypress.Commands.add("logout", () => {
    cy.get(".md-toolbar-row")
        .get(".md-toolbar-section-end")
        .contains("Logout")
        .click();
    cy.url().should("eq", Cypress.config().baseUrl + "login");
});

Cypress.Commands.add("homeShouldBeVisible", () => {
    cy.url().should("eq", Cypress.config().baseUrl);
    cy.contains("Home");
    cy.get("div").should("have.class", "md-toolbar-row");
});

Cypress.Commands.add("copyrightPageShouldBeVisible", () => {
    cy.url().should("eq", Cypress.config().baseUrl + "manage/copyright");
    cy.get(".breadcrumb").contains("Copyright List");
});

Cypress.Commands.add("categoryPageShouldBeVisible", () => {
    cy.url().should("eq", Cypress.config().baseUrl + "manage/categories");
    cy.get(".breadcrumb").contains("Categories");
});

Cypress.Commands.add("imagePageShouldBeVisible", () => {
    cy.url().should("eq", Cypress.config().baseUrl + "manage/images");
    cy.get(".breadcrumb").contains("Images");
});

Cypress.Commands.add("contactPageShouldBeVisible", () => {
    cy.url().should("eq", Cypress.config().baseUrl + "contact");
    cy.get(".breadcrumb").contains("Contact");
});

// Temporarily add a new category for test.
Cypress.Commands.add("addTestCategoryWhenNone", (newCategoryName) => {
    cy.get("table")
        .get("tbody")
        .then((ele) => {
            if (!ele.text().includes(newCategoryName)) {
                cy.get(".md-button").contains("ADD").click();
                cy.get("#form-save-category")
                    .get("input[name='category']")
                    .type(newCategoryName);
                cy.get("#form-save-category")
                    .get(".md-radio")
                    .contains(programSelection)
                    .click();
                cy.get("#form-save-category")
                    .get(".md-button-content")
                    .contains("Save")
                    .click();
                cy.get(".md-dialog-actions")
                    .get("button")
                    .contains("Close")
                    .click();
            }
        });
});
