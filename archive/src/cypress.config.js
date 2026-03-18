const { defineConfig } = require("cypress");

module.exports = defineConfig({
    e2e: {
        baseUrl: "http://localhost:8080/",
        viewportHeight: 1080,
        viewportWidth: 1920,
        watchForFileChanges: false,
    },
});
