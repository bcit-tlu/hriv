const mainCategory = "mainTestCategory";
const subCategory = "subTestCategory";
const thirdLevelSubCategory = "thirdLevelSubCateogry";
const moveToSubCategory = "MainToSub";

const categorySearchDelay = 2000;

const mainCategoryRegexFixed = new RegExp("^" + " " + mainCategory + " " + "$", "m");

const moreThan50Chars =
    "lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua";
const invalidInput = ";@$^&*!@#$%^&*()_+";

const programSelection = "LTC Users";
const programSelection2 = "BCIT Employee";

// Things to test on Categories page:
// 1. Navigation - DONE
// 2. Add main category - DONE
// 3. Add one-level sub category - DONE
// 4. Add second-level sub category - DONE
// 5. Disable sub category - DONE
// 6. Disable main category - DONE
// 7. Edit category
// 8. View category
// 9. Delete category
// 10. Search category
// 11. Check if warning displayed when the new copyright's length is more than 50 chars
// 12. Check it's not allowing special characters in the new copyright's name

describe("Categories Page", () => {
    beforeEach(() => {
        cy.visit(Cypress.config().baseUrl + "login");
        cy.login("admin", "secret");
        cy.get(".md-toolbar-row")
            .contains("Manage")
            .click()
            .get(".md-list-item-content")
            .contains("Categories")
            .click();
    });

    afterEach(() => {
        // cy.logout();
    });

    // Navigate to categories page
    it("Should navigate to categories page with valid authentication", () => {
        cy.categoryPageShouldBeVisible();
    });

    // Add main category
    it("Should add a new main cateogry successfully", () => {
        cy.get("table")
            .get("tbody")
            .then((ele) => {
                if (!ele.text().includes(mainCategory)) {
                    cy.get(".md-button").contains("ADD").click();

                    cy.get("#form-save-category")
                        .get("input[name=category]")
                        .type(mainCategory);

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

                    cy.get("table").should("contain", mainCategory);
                } else {
                    cy.log("Main category already exists");
                }
            });

        cy.get("table").should("contain", mainCategory);
    });

    // Add one level of sub category
    it("Should add a new sub category successfully", () => {
        cy.get("table")
            .get("tbody")
            .then((ele) => {
                if (!ele.text().includes(subCategory)) {
                    cy.get(".md-button").contains("ADD").click();

                    cy.get("#form-save-category")
                        .get("input[name=category]")
                        .type(subCategory);

                    cy.get("#form-save-category")
                        .get(".md-checkbox-label")
                        .contains("Is Subcategory")
                        .click();

                    cy.get("#form-save-category")
                        .get("#input-search-category")
                        .type(mainCategory);

                    cy.get(".md-overlay")
                        .get("#form-save-category")
                        .get(".md-button-content")
                        .contains(" Search")
                        .click();

                    cy.wait(categorySearchDelay);

                    cy.get("#form-save-category")
                        .get(".md-form-category-subcategories")
                        .get(".md-radio")
                        .contains(mainCategory)
                        .click();

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
                } else {
                    cy.log("Sub category already exists");
                }
            });
        
        cy.get("table").should("contain", subCategory);
    });

    // Add second level of sub category
    it("Should add a new second level sub category successfully", () => {
        cy.get("table")
            .get("tbody")
            .then((ele) => {
                if (!ele.text().includes(thirdLevelSubCategory)) {
                    cy.get(".md-button").contains("ADD").click();

                    cy.get("#form-save-category")
                        .get("input[name=category]")
                        .type(thirdLevelSubCategory);

                    cy.get("#form-save-category")
                        .get(".md-checkbox-label")
                        .contains("Is Subcategory")
                        .click();

                    cy.get("#form-save-category")
                        .get("#input-search-category")
                        .type(subCategory);

                    cy.get(".md-overlay")
                        .get("#form-save-category")
                        .get(".md-button-content")
                        .contains(" Search")
                        .click();

                    cy.wait(categorySearchDelay);
                    
                    cy.get("#form-save-category")
                        .get(".md-form-category-subcategories")
                        .get(".md-radio")
                        .contains(subCategory)
                        .click();
                    
                    cy.get("#form-save-category")
                        .get(".md-radio")
                        .contains(programSelection)
                        .click();
                    
                    cy.get("#form-save-category")
                        .get(".md-button-content")
                        .contains("Save")
                        .click();

                    cy.get(".md-dialog-actions").get("button").contains("Close").click();
                }
                else {
                    cy.log("Second level sub category already exists");
                }
            });
        
        cy.get("table").should("contain", subCategory);
    });

    // Add second level of sub category
    it("Should add a new second level sub category successfully", () => {
        cy.get("table")
            .get("tbody")
            .then((ele) => {
                if (!ele.text().includes(thirdLevelSubCategory)) {
                    cy.get(".md-button").contains("ADD").click();

                    cy.get("#form-save-category")
                        .get("input[name=category]")
                        .type(thirdLevelSubCategory);

                    cy.get("#form-save-category")
                        .get(".md-checkbox-label")
                        .contains("Is Subcategory")
                        .click();

                    cy.get("#form-save-category")
                        .get("#input-search-category")
                        .type(subCategory);

                    cy.get(".md-overlay")
                        .get("#form-save-category")
                        .get(".md-button-content")
                        .contains(" Search")
                        .click();

                    cy.wait(categorySearchDelay);
                    
                    cy.get("#form-save-category")
                        .get(".md-form-category-subcategories")
                        .get(".md-radio")
                        .contains(subCategory)
                        .click();
                    
                    cy.get("#form-save-category")
                        .get(".md-radio")
                        .contains(programSelection)
                        .click();
                    
                    cy.get("#form-save-category")
                        .get(".md-button-content")
                        .contains("Save")
                        .click();

                    cy.get(".md-dialog-actions").get("button").contains("Close").click();
                }
                else {
                    cy.log("Second level sub category already exists");
                }
            });
        
        cy.get("table").should("contain", thirdLevelSubCategory);
    });

    // Disable category
    it("Should disable category successfully", () => {
        cy.get("table")
            .get("tbody")
            .get(".md-table-cell-container")
            .then ((ele) => {
                if (ele.text().includes(mainCategory)) {

                    if (!ele.text().includes("Disabled")) {
                        cy.contains(mainCategoryRegexFixed)
                            .parents(".md-table-row")
                            .contains("Disable")
                            .click();

                        cy.get(".md-dialog-actions")
                            .get("button")
                            .contains("Disable")
                            .click();

                        cy.get(".md-dialog-actions")
                            .get("button")
                            .contains("Ok")
                            .click();
                    }
                    else {
                        cy.log("Sub category is already disabled");
                    }
                }
            });

        cy.get("table").should("contain", "Disabled");
    });

    // Edit category (including move main category to sub category)
    it("Should edit the category successfully", () => {
        // Edit category
        cy.get("table")
            .get("tbody")
            .get(".md-table-cell-container")
            .then((ele) => {
                if (ele.text().includes(mainCategory)) {
                    cy.contains(" (Disabled) "+mainCategory)
                        .parents(".md-table-row")
                        .contains("Edit")
                        .click();

                    cy.get("#form-save-category")
                        .get("input[name=category]")
                        .clear()
                        .type(mainCategory + "Modified");

                    cy.get("#form-save-category")
                        .get(".md-dialog-actions")
                        .get("button")
                        .contains("Save")
                        .click();

                    cy.get(".md-dialog-actions")
                        .get("button")
                        .contains("Close")
                        .click();
                }
                else {
                    cy.log("All categories have already been modified");
                }
            });
        
            // Add new main category
            cy.addTestCategoryWhenNone(moveToSubCategory);

        // Move main category to sub category
        cy.get("table")
            .get("tbody")
            .get(".md-table-cell-container")
            .then((ele) => {
                if (ele.text().includes(moveToSubCategory)) {
                    cy.contains(moveToSubCategory)
                        .parents(".md-table-row")
                        .contains("Edit")
                        .click();

                    cy.get("#form-save-category")
                        .get(".md-checkbox-label")
                        .contains("Is Subcategory")
                        .click();

                    cy.get("#form-save-category")
                        .get("#input-search-category")
                        .clear()
                        .type(mainCategory);

                    cy.get(".md-overlay")
                        .get("#form-save-category")
                        .get(".md-button-content")
                        .contains(" Search")
                        .click();

                    cy.wait(categorySearchDelay);
                    
                    cy.get("#form-save-category")
                        .get(".md-form-category-subcategories")
                        .get(".md-radio")
                        .contains(mainCategory)
                        .click();

                    cy.get("#form-save-category")
                        .get(".md-dialog-actions")
                        .get("button")
                        .contains("Save")
                        .click();

                    cy.get(".md-dialog-actions")
                        .get("button")
                        .contains("Close")
                        .click();
                }

                cy.log("Main category has been moved to sub category");

            });

        cy.get("table").should("contain", "/" + mainCategory + "Modified" + "/" + moveToSubCategory + "/");
        

        cy.get("table").should("contain", "Modified");
    });

    // View category
    it("Should navigate to selected category successfully", () => {
        cy.get("table")
            .get("tbody")
            .get(".md-table-cell-container")
            .get(".md-table-row")
            .contains("View")
            .invoke("removeAttr", "target")
            .click();
        cy.get(".breadcrumb").should("contain", mainCategory+"Modified");
    });
});
