const mix = require("laravel-mix");

/*
 |--------------------------------------------------------------------------
 | Mix Asset Management
 |--------------------------------------------------------------------------
 |
 | Mix provides a clean, fluent API for defining some Webpack build steps
 | for your Laravel application. By default, we are compiling the Sass
 | file for the application as well as bundling up all the JS files.
 |
 */

mix.js("resources/js/app.js", "public/js").extract(["vue"]);

mix.sass("resources/sass/app.scss", "public/css");

mix.browserSync({
    // proxy: 'http://localhost:9000/',
    proxy: "http://localhost:8080/",
    // ui: false,
    // injectChanges: true,
    // open: true,
    watchOptions: {
        usePolling: true,
        interval: 500,
    },
});

if (mix.inProduction()) {
    mix.version();
}
