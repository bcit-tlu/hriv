describe("Login", () => {
    beforeEach(() => {
        cy.visit(Cypress.config().baseUrl + "login");
    });

    it("should redirect to home page after login successfully", () => {
        cy.login("admin", "secret");
        cy.homeShouldBeVisible();
    });

    it("should show error message when login failed", () => {
        cy.login("admin", "wrong-password");
        cy.contains("Username/Password incorrect!!!");
        cy.url().should("eq", Cypress.config().baseUrl + "login");
    });
});
