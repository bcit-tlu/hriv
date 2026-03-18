const imageName = "CypressTestImage" + Cypress._.random(0, 1e6);
const imageDescription = "This image has a size of 73KB.";
const newCategoryName = "CypressTestCategory";

// In milliseconds.
const waitTimeBeforeImageEnabled = 8500;

// In milliseconds.
const copyright_search_delay = 1000;

describe("Images page", () => {
    beforeEach(() => {
        cy.visit(Cypress.config().baseUrl + "login");
        cy.login("admin", "secret");
        cy.homeShouldBeVisible();
        cy.get(".md-toolbar-row")
            .contains("Manage")
            .click()
            .get(".md-list-item-content")
            .contains("Images")
            .click();
        cy.imagePageShouldBeVisible();
    });

    afterEach(() => {
        cy.logout();
    });

    // Add a test category if none existed.
    it("Should add a test category when none existed", () => {
        cy.get(".md-toolbar-row")
            .contains("Manage")
            .click()
            .get(".md-list-item-content")
            .contains("Categories")
            .click();
        cy.categoryPageShouldBeVisible();
        cy.addTestCategoryWhenNone(newCategoryName);
    });

    // Add an image.
    it("Should add an image successfully", () => {
        cy.get(".md-button").contains("Add").click();
        cy.url().should("eq", Cypress.config().baseUrl + "manage/images/add");

        cy.get("input[name=name]").type(imageName);
        cy.get("textarea[name=description]").type(imageDescription);

        cy.get("input[id=input-search-copyright]").type("BCIT");
        cy.get(".md-button-content").contains("Search Copyright").click();
        cy.wait(copyright_search_delay);
        cy.get(".md-radio").contains("BCIT").click();

        cy.get("input[id=input-search-category]").type("Cypress");
        cy.get(".md-button-content").contains("Search Category").click();
        cy.get(".md-radio").contains("Category").click();

        cy.get(".md-radio").contains("BCIT Employee").click();

        cy.get("[id='dropzone']").attachFile("../assets/test-image.jpg", {
            encoding: "utf-8",
            subjectType: "drag-n-drop",
        });

        cy.get(".md-button-content").contains("ADD").click();

        cy.get(".md-button-content").contains("Back to Images List").click();

        cy.get("table").get("tbody").contains(imageName);

        // wait for the image to be enabled.
        cy.wait(waitTimeBeforeImageEnabled);
    });

    // View an existing image.
    it("View selected image properly", () => {
        cy.get("tbody")
            .children()
            .first()
            .get("a")
            .contains("View")
            .invoke("removeAttr", "target")
            .click();
        cy.url().should("include", "/detail");
    });

    // Edit an existing image.
    it("Edit selected image properly", () => {
        cy.get("tbody").children().first().get("a").contains("Edit").click();
        cy.url().should("include", "/manage/images/edit/");
        cy.get("h1").contains("Edit Image");
        cy.get("input[name='name']").type("Edited");
        cy.get(".md-button-content").contains("SAVE").click();
        cy.get(".md-button-content").contains("Back to Images List").click();
    });

    // Delete an existing image.
    it("Delete selected image properly", () => {
        cy.get("tbody").children().first().get("a").contains("Delete").click();
        cy.get(".md-button-content").contains("Delete").click();
        cy.get(".md-button-content").contains("Ok").click();
    });
});
