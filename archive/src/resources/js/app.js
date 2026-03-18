
/**
 * First we will load all of this project's JavaScript dependencies which
 * includes Vue and other libraries. It is a great starting point when
 * building robust, powerful web applications using Vue and Laravel.
 */

// require('./bootstrap');

window.Vue = require('vue');

import VueMaterial from 'vue-material'
import 'vue-material/dist/vue-material.min.css'
import * as mdc from 'material-components-web'
import VueResource from 'vue-resource'
import VueClipboard from 'vue-clipboard2'
// import VueFaqAccordion from 'vue-faq-accordion';

// VueClipboard.config.autoSetContainer = true;
Vue.use(VueClipboard);
Vue.use(VueResource);
Vue.use(VueMaterial);
// Vue.use(VueFaqAccordion);

/**
 * The following block of code may be used to automatically register your
 * Vue components. It will recursively scan this directory for the Vue
 * components and automatically register them with their "basename".
 *
 * Eg. ./components/ExampleComponent.vue -> <example-component></example-component>
 */

// const files = require.context('./', true, /\.vue$/i);
// files.keys().map(key => Vue.component(key.split('/').pop().split('.')[0], files(key).default));

Vue.component('manage-add-image', require('./components/ManageAddImageComponent.vue').default);
Vue.component('manage-add-category', require('./components/ManageAddCategoryComponent.vue').default);
Vue.component('manage-add-copyright', require('./components/ManageAddCopyrightComponent.vue').default);
Vue.component('manage-image-sort-list', require('./components/ManageImageSortListComponent.vue').default);
Vue.component('manage-table', require('./components/ManageTableComponent.vue').default);
Vue.component('user-category-list', require('./components/UserCategoryListComponent.vue').default);
Vue.component('user-image-detail', require('./components/UserImageDetailComponent.vue').default);
Vue.component('admin-faq', require('./components/AdminFaq.vue').default);
Vue.component('contact-info', require('./components/ContactInfo.vue').default);
/**
 * Next, we will create a fresh Vue application instance and attach it to
 * the page. Then, you may begin adding components to this application
 * or customize the JavaScript scaffolding to fit your unique needs.
 */

const RESIZE_MENU_CHANGE = "787"

if(document.getElementById("app")){
    const app = new Vue({
        root: '/root',
        el: '#app',
        headers: {
            Authorization: 'Basic YXBpOnBhc3N3b3Jk'
        },
        data: () => ({
            menuVisible: false,
            menuResponsiveSeen: false,
            menuSeen: true,
            openManager: false
        }),
        methods: {
            // whenever the document is resized, re-set the 'fullHeight' variable
            handleWindowResize (event) {
                if(window.innerWidth < RESIZE_MENU_CHANGE) {
                    this.menuResponsiveSeen = true
                    this.menuSeen = false
                } else {
                    this.menuResponsiveSeen = false
                    this.menuSeen = true
                }
            },
            logout(url) {
                this.$http.post(
                  url, null, {
                    headers: { 'X-CSRF-TOKEN': document.head.querySelector("[name=csrf-token]").content,
                    responseType: 'json',
                }}).then(response => {
                    app.$destroy();
                    localStorage.clear();
                    window.location = response.body;
                }, response => {});
            }
        },
        created() {
            window.addEventListener('resize', this.handleWindowResize);
            this.handleWindowResize();
        },
        destroyed() {
            window.removeEventListener('resize', this.handleWindowResize)
        },
    });
}
