const IMAGE_NAME = "cypress_test_medium_size_image" + Cypress._.random(0, 1e6);
const IMAGE_DESCRIPTION = "This image has a size of 29MB.";
const NEW_CATEGORY_NAME = "CypressTestCategory";
const IMAGE_RELATIVE_FILE_PATH = "../assets/megakaryocyte-fragments.jpg";
const IMAGE_PROGRAM = "BCIT Employee";
const IMAGE_COPYRIGHT = "BCIT";

// In milliseconds. => 90 seconds. => 1.5 minutes
const WAIT_TIME_BEFORE_IMAGE_ENABLED_BACKEND = 90000;

// In milliseconds. => 20 seconds
const WAIT_TIME_AT_DROPZONE_IMAGE_FRONTEND = 20000;

// In milliseconds. => 1 second
const COPYRIGHT_SEARCH_DELAY = 1000;

describe("medium size image test", () => {
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
        // cy.logout();
    });

    // add a test category if none existed.
    it("Should add a test category when none existed", () => {
        cy.get(".md-toolbar-row")
            .contains("Manage")
            .click()
            .get(".md-list-item-content")
            .contains("Categories")
            .click();
        cy.categoryPageShouldBeVisible();
        cy.addTestCategoryWhenNone(NEW_CATEGORY_NAME); // OPTIMIZE Way 1: replace the includes() with a better function for 100% confirmation of the categry name.
        // OPTIMIZE Way 2: confirm it in the backend (database) instead of frontend.
    });

    // add the large image
    it("Should add an medium size 52 MB image successfully (wait time is 90 seconds)", () => {
        cy.get(".md-button").contains("Add").click();
        cy.url().should("eq", Cypress.config().baseUrl + "manage/images/add");

        cy.get("input[name=name]").type(IMAGE_NAME);
        cy.get("textarea[name=description]").type(IMAGE_DESCRIPTION);

        cy.get("input[id=input-search-copyright]").type(IMAGE_COPYRIGHT);
        cy.get(".md-button-content").contains("Search Copyright").click();
        cy.wait(COPYRIGHT_SEARCH_DELAY);
        cy.get(".md-radio").contains(IMAGE_COPYRIGHT).click();

        cy.get("input[id=input-search-category]").type(NEW_CATEGORY_NAME);
        cy.get(".md-button-content").contains("Search Category").click();
        cy.get(".md-radio").contains("Cypress").click();

        cy.get(".md-radio").contains(IMAGE_PROGRAM).click();

        cy.get("[id='dropzone']").attachFile(IMAGE_RELATIVE_FILE_PATH, {
            encoding: "utf-8",
            subjectType: "drag-n-drop",
        });

        // wait for the image to be uploaded at the drop zone
        cy.wait(WAIT_TIME_AT_DROPZONE_IMAGE_FRONTEND);
        cy.get(".md-button-content").contains("ADD").click();

        cy.get(".md-button-content").contains("Back to Images List").click();

        cy.get("table").get("tbody").contains(IMAGE_NAME);

        // wait for the image to be enabled.
        cy.wait(WAIT_TIME_BEFORE_IMAGE_ENABLED_BACKEND);
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

    // OPTIMIZE for finding specific image
    // Delete the first existing image.
    it("Delete selected image properly", () => {
        cy.get("tbody").children().first().get("a").contains("Delete").click();
        cy.get(".md-button-content").contains("Delete").click();
        cy.get(".md-button-content").contains("Ok").click();
    });
});
