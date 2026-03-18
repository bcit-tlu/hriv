<template>
    <div
        class="md-card md-table md-theme-default"
        md-card=""
        md-fixed-header=""
    >
        <md-dialog
            v-if="modalAddEdit.enable"
            :md-active.sync="modalAddEdit.show"
            class="md-modal-edit"
        >
            <md-dialog-title v-if="!modalAddEdit.editId">{{
                modalAddEdit.addtitle
            }}</md-dialog-title>
            <md-dialog-title v-if="modalAddEdit.editId">{{
                modalAddEdit.edittitle
            }}</md-dialog-title>
            <!-- edit category modal starts -->
            <slot
                name="modal-form"
                :closeModal="closeModal"
                :editId="modalAddEdit.editId"
            ></slot>
        </md-dialog>

        <!-- delete modal starts -->
        <md-dialog :md-active.sync="modalDelete.enable" class="md-modal-delete">
            <md-dialog-title>{{ modalDelete.title }}</md-dialog-title>
            <md-dialog-content
                v-if="!modalDelete.alert.show"
                v-html="modalDelete.content"
            ></md-dialog-content>
            <md-dialog-content v-else class="md-modal-delete-content-alert">
                <md-empty-state
                    v-if="modalDelete.alert.show"
                    class="md-alert"
                    :class="modalDelete.alert.class"
                    :md-icon="modalDelete.alert.icon"
                    :md-label="modalDelete.alert.title"
                    :md-description="modalDelete.alert.message"
                >
                </md-empty-state>
            </md-dialog-content>
            <md-dialog-actions>
                <md-button
                    v-if="!modalDelete.alert.show"
                    @click="modalDelete.enable = false"
                    >Cancel</md-button
                >
                <md-button
                    v-if="!modalDelete.alert.show"
                    class="md-primary"
                    @click="deleteConfirm"
                    >Delete</md-button
                >
                <md-button v-else="modalDelete.alert.show" @click="deleteClose"
                    >Ok</md-button
                >
            </md-dialog-actions>
        </md-dialog>
        <!-- delete modal ends -->

        <!-- hide modal starts -- note that this can be furthur refactored -->
        <md-dialog :md-active.sync="modalHide.enable" class="md-modal-delete">
            <md-dialog-title>{{ modalHide.title }}</md-dialog-title>
            <md-dialog-content
                v-if="!modalHide.alert.show"
                v-html="modalHide.content"
            ></md-dialog-content>
            <md-dialog-content v-else class="md-modal-delete-content-alert">
                <md-empty-state
                    v-if="modalHide.alert.show"
                    class="md-alert"
                    :class="modalHide.alert.class"
                    :md-icon="modalHide.alert.icon"
                    :md-label="modalHide.alert.title"
                    :md-description="modalHide.alert.message"
                >
                </md-empty-state>
            </md-dialog-content>
            <md-dialog-actions>
                <md-button
                    v-if="!modalHide.alert.show"
                    @click="modalHide.enable = false"
                    >Cancel</md-button
                >
                <md-button
                    v-if="!modalHide.alert.show"
                    class="md-primary"
                    @click="hideConfirm"
                    >Disable</md-button
                >
                <md-button v-else="modalHide.alert.show" @click="hideClose"
                    >Ok</md-button
                >
            </md-dialog-actions>
        </md-dialog>
        <!-- hide modal ends-->

        <!-- show modal starts -- note that this can be furthur refactored -->
        <md-dialog :md-active.sync="modalShow.enable" class="md-modal-delete">
            <md-dialog-title>{{ modalShow.title }}</md-dialog-title>
            <md-dialog-content
                v-if="!modalShow.alert.show"
                v-html="modalShow.content"
            ></md-dialog-content>
            <md-dialog-content v-else class="md-modal-delete-content-alert">
                <md-empty-state
                    v-if="modalShow.alert.show"
                    class="md-alert"
                    :class="modalShow.alert.class"
                    :md-icon="modalShow.alert.icon"
                    :md-label="modalShow.alert.title"
                    :md-description="modalShow.alert.message"
                >
                </md-empty-state>
            </md-dialog-content>
            <md-dialog-actions>
                <md-button
                    v-if="!modalShow.alert.show"
                    @click="modalShow.enable = false"
                    >Cancel</md-button
                >
                <md-button
                    v-if="!modalShow.alert.show"
                    class="md-primary"
                    @click="showConfirm"
                    >Enable</md-button
                >
                <md-button v-else="modalShow.alert.show" @click="showClose"
                    >Ok</md-button
                >
            </md-dialog-actions>
        </md-dialog>
        <!-- show modal ends-->

        <div
            class="md-toolbar md-table-toolbar md-transparent md-theme-default md-elevation-0 table-responsive"
        >
            <h1 class="md-title">{{ title }}</h1>
            <p class="md-description">{{ description }}</p>
        </div>
        <div
            v-if="!disableaddsearch"
            :class="{
                'md-xsmall-size-100 md-size-60':
                    !buttonAddEdit.enable && !modalAddEdit.enable,
            }"
            class="md-toolbar md-table-toolbar md-transparent md-theme-default md-elevation-0 md-layout-item table-responsive"
        >
            <div
                v-if="buttonAddEdit.enable || modalAddEdit.enable"
                class="md-toolbar-section-start md-theme-default"
            >
                <md-button
                    v-if="modalAddEdit.enable"
                    class="md-primary md-raised"
                    @click="showModal()"
                    >ADD</md-button
                >
                <md-button
                    v-else
                    class="md-dense md-raised md-primary"
                    :href="buttonAddEdit.href"
                    :title="buttonAddEdit.title"
                    >{{ buttonAddEdit.label }}</md-button
                >
            </div>
            <div
                :class="{
                    'md-toolbar-section-end':
                        buttonAddEdit.enable || modalAddEdit.enable,
                    'md-toolbar-section-start md-xsmall-size-100 md-size-60':
                        !buttonAddEdit.enable && !modalAddEdit.enable,
                }"
                class="md-field md-theme-default md-clearable md-has-placeholder"
            >
                <input
                    v-model="searchText"
                    type="text"
                    placeholder="Search by name..."
                    class="md-input md-input-button"
                    @keyup.enter="search"
                />
                <md-button class="md-dense md-raised md-primary" @click="search"
                    >Search</md-button
                >
            </div>
        </div>
        <div class="md-table-fixed-header table-responsive">
            <div class="md-table-fixed-header-container">
                <table>
                    <thead>
                        <tr>
                            <th
                                v-for="(header, index) in headersItems"
                                :class="{
                                    'md-numeric': header.type == 'number',
                                    'md-sortable': header.sortable,
                                }"
                                :style="{ width: header.width }"
                                class="md-table-head"
                                :label="header.label"
                                v-on:click="sorting($event, index)"
                            >
                                <div class="md-table-head-container md-ripple">
                                    <div class="md-table-head-label">
                                        <i
                                            class="md-icon md-icon-font md-icon-image md-theme-default fa-ul md-icon-align"
                                            v-if="header.sortable"
                                        >
                                            <svg
                                                v-if="
                                                    sortOrder == 'asc' &&
                                                    header.label == sortLabel
                                                "
                                                height="24"
                                                viewBox="0 0 24 24"
                                                width="24"
                                                xmlns="http://www.w3.org/2000/svg"
                                            >
                                                <path
                                                    d="M0 0h24v24H0V0z"
                                                    fill="none"
                                                />
                                                <path
                                                    d="m 12.389497,13 1.41,1.41 5.59,-5.5800003 V 21 h 2 V 8.8299997 l 5.58,5.5900003 1.42,-1.42 -8,-8.0000003 z"
                                                    fill="#546e7a"
                                                />
                                                <path
                                                    d="m 11.019694,12.999999 -1.41,-1.41 L 4.0196944,17.17 V 4.9999994 h -2 V 17.17 l -5.58,-5.590001 -1.420001,1.42 L 3.0196944,21 Z"
                                                    fill="#d3d3d3"
                                                />
                                            </svg>
                                            <svg
                                                v-else-if="
                                                    sortOrder == 'desc' &&
                                                    header.label == sortLabel
                                                "
                                                height="24"
                                                viewBox="0 0 24 24"
                                                width="24"
                                                xmlns="http://www.w3.org/2000/svg"
                                            >
                                                <path
                                                    d="M0 0h24v24H0V0z"
                                                    fill="none"
                                                />
                                                <path
                                                    d="m 12.389497,13 1.41,1.41 5.59,-5.5800003 V 21 h 2 V 8.8299997 l 5.58,5.5900003 1.42,-1.42 -8,-8.0000003 z"
                                                    fill="#d3d3d3"
                                                />
                                                <path
                                                    d="m 11.019694,12.999999 -1.41,-1.41 L 4.0196944,17.17 V 4.9999994 h -2 V 17.17 l -5.58,-5.590001 -1.420001,1.42 L 3.0196944,21 Z"
                                                    fill="#546e7a"
                                                />
                                            </svg>
                                            <svg
                                                v-else-if="
                                                    header.label != sortLabel
                                                "
                                                height="24"
                                                viewBox="0 0 24 24"
                                                width="24"
                                                xmlns="http://www.w3.org/2000/svg"
                                            >
                                                <path
                                                    d="M0 0h24v24H0V0z"
                                                    fill="none"
                                                />
                                                <path
                                                    d="m 12.389497,13 1.41,1.41 5.59,-5.5800003 V 21 h 2 V 8.8299997 l 5.58,5.5900003 1.42,-1.42 -8,-8.0000003 z"
                                                    fill="#d3d3d3"
                                                />
                                                <path
                                                    d="m 11.019694,12.999999 -1.41,-1.41 L 4.0196944,17.17 V 4.9999994 h -2 V 17.17 l -5.58,-5.590001 -1.420001,1.42 L 3.0196944,21 Z"
                                                    fill="#d3d3d3"
                                                />
                                            </svg>
                                        </i>
                                        <span>{{ header.label }}</span>
                                    </div>
                                </div>
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        <slot
                            name="table-content"
                            :showModal="showModal"
                            :deleteModal="deleteModal"
                            :disableModal="disableModal"
                            :enableModal="enableModal"
                        >
                        </slot>
                    </tbody>
                </table>
            </div>
        </div>
        <div class="md-table-pagination">
            <slot
                name="table-pagination"
                :pageShowing="pageShowing"
                :showing="showing"
            ></slot>
        </div>
    </div>
</template>

<script>
export default {
    props: [
        "title",
        "description",
        "headers",
        "buttonaddedit",
        "modaladdedit",
        "disableaddsearch",
    ],
    data: function () {
        return {
            url: null,
            queryString: null,
            searchText: "",
            pageShowing: "10",
            headersItems: null,
            sortLabel: null,
            sortOrder: null,
            disableaddsearch: false,
            modalAddEdit: {
                enable: false,
                title: "",
                height: 200,
                show: false,
                class: null,
                editId: null,
                addtitle: "Add",
                edittitle: "Edit",
            },
            modalDelete: {
                enable: false,
                title: "",
                content: "",
                deleteUrl: null,
                itemID: null,
                alert: {
                    class: null,
                    icon: null,
                    show: false,
                    title: null,
                    message: null,
                    reload: null,
                },
            },
            modalHide: {
                enable: false,
                title: "",
                content: "",
                hideUrl: null,
                itemID: null,
                alert: {
                    class: null,
                    icon: null,
                    show: false,
                    title: null,
                    message: null,
                    reload: null,
                },
            },
            modalShow: {
                enable: false,
                title: "",
                content: "",
                showUrl: null,
                itemID: null,
                alert: {
                    class: null,
                    icon: null,
                    show: false,
                    title: null,
                    message: null,
                    reload: null,
                },
            },
            buttonAddEdit: {
                enable: false,
                href: null,
                title: null,
                label: null,
            },
        };
    },
    created() {
        this.url = new URL(window.location);
        this.queryString = new URLSearchParams(this.url.search);
        this.searchText = this.queryString.get("q");
        if (this.queryString.get("showing") !== null) {
            this.pageShowing = this.queryString.get("showing");
        }

        var sortSelected = this.queryString.get("sorting");
        if (sortSelected) {
            var sort = sortSelected.split("-");
            if (sort.length == 2) {
                this.sortLabel = sort[0];
                this.sortOrder = sort[1];
            }
        }
        this.headersItems = this.headers;
        Object.assign(this.buttonAddEdit, this.buttonaddedit);
        Object.assign(this.modalAddEdit, this.modaladdedit);
    },
    methods: {
        search: function (event) {
            if (this.searchText !== "") {
                this.queryString.set("q", this.searchText);
            } else {
                this.queryString.delete("q");
            }
            this.queryString.delete("page");
            this.url.search = this.queryString.toString();
            window.location = this.url.toString();
        },
        showing: function (val) {
            if (val !== this.pageShowing) {
                this.queryString.set("showing", val);
            } else {
                this.queryString.delete("showing");
            }
            this.queryString.delete("page");
            this.url.search = this.queryString.toString();
            window.location = this.url.toString();
        },
        sorting: function (e, index) {
            if (this.headersItems[index].sortable == true) {
                var order = "-asc";
                if (
                    this.sortOrder == "asc" &&
                    this.sortLabel == this.headersItems[index].label
                ) {
                    order = "-desc";
                }
                this.queryString.set(
                    "sorting",
                    this.headersItems[index].label + order
                );
                this.queryString.delete("page");
                this.url.search = this.queryString.toString();
                window.location = this.url.toString();
            }
        },
        showModal: function (editId) {
            this.modalAddEdit.show = true;
            this.modalAddEdit.editId = editId;
        },
        closeModal: function () {
            this.modalAddEdit.show = false;
            window.location = window.location;
        },
        deleteModal: function (title, content, deleteUrl, itemID) {
            this.modalDelete.enable = true;
            this.modalDelete.title = title;
            this.modalDelete.content = content;
            this.modalDelete.deleteUrl = deleteUrl;
            this.modalDelete.itemID = itemID;
            console.log(this.modalDelete);
        },
        deleteConfirm: function (e) {
            if (this.modalDelete.deleteUrl && this.modalDelete.itemID)
                this.$http
                    .post(
                        this.modalDelete.deleteUrl,
                        { itemID: this.modalDelete.itemID },
                        {
                            headers: {
                                "X-CSRF-TOKEN":
                                    document.head.querySelector(
                                        "[name=csrf-token]"
                                    ).content,
                            },
                        }
                    )
                    .then(
                        (response) => {
                            this.modalDelete.alert.show = true;
                            this.modalDelete.alert.title = "Success";
                            this.modalDelete.alert.message =
                                "Item deleted successfully!";
                            this.modalDelete.alert.icon = "done";
                            this.modalDelete.alert.class = "md-alert-success";
                            this.modalDelete.alert.reload = true;
                        },
                        (response) => {
                            this.modalDelete.alert.show = true;
                            this.modalDelete.alert.title = "System Error";
                            this.modalDelete.alert.message =
                                "We had a problem with our system, and this item can not be deleted. Try again. If the error persists, please contact us.";
                            this.modalDelete.alert.icon = "error";
                            this.modalDelete.alert.class = "md-alert-error";
                        }
                    );
        },
        deleteClose: function (e) {
            this.modalDelete.enable = false;
            this.modalDelete.alert.show = false;
            if (this.modalDelete.alert.reload) window.location.reload();
        },
        disableModal: function (title, content, hideUrl, itemID) {
            this.modalHide.enable = true;
            this.modalHide.title = title;
            this.modalHide.content = content;
            this.modalHide.hideUrl = hideUrl;
            this.modalHide.itemID = itemID;
            console.log(this.modalHide);
        },
        hideConfirm: function (e) {
            if (this.modalHide.hideUrl && this.modalHide.itemID)
                this.$http
                    .post(
                        this.modalHide.hideUrl,
                        { itemID: this.modalHide.itemID },
                        {
                            headers: {
                                "X-CSRF-TOKEN":
                                    document.head.querySelector(
                                        "[name=csrf-token]"
                                    ).content,
                            },
                        }
                    )
                    .then(
                        (response) => {
                            this.modalHide.alert.show = true;
                            this.modalHide.alert.title = "Success";
                            this.modalHide.alert.message =
                                "Category hidden successfully!";
                            this.modalHide.alert.icon = "done";
                            this.modalHide.alert.class = "md-alert-success";
                            this.modalHide.alert.reload = true;
                        },
                        (response) => {
                            this.modalHide.alert.show = true;
                            this.modalHide.alert.title = "System Error";
                            this.modalHide.alert.message =
                                "We had a problem with our system, and this category can not be hidden. Try again. If the error persists, please contact us.";
                            this.modalHide.alert.icon = "error";
                            this.modalHide.alert.class = "md-alert-error";
                        }
                    );
        },
        hideClose: function (e) {
            this.modalHide.enable = false;
            this.modalHide.alert.show = false;
            if (this.modalHide.alert.reload) window.location.reload();
        },
        enableModal: function (title, content, showUrl, itemID) {
            this.modalShow.enable = true;
            this.modalShow.title = title;
            this.modalShow.content = content;
            this.modalShow.showUrl = showUrl;
            this.modalShow.itemID = itemID;
            console.log(this.modalShow);
        },
        showConfirm: function (e) {
            if (this.modalShow.showUrl && this.modalShow.itemID) {
                this.$http
                    .post(
                        this.modalShow.showUrl,
                        { itemID: this.modalShow.itemID },
                        {
                            headers: {
                                "X-CSRF-TOKEN":
                                    document.head.querySelector(
                                        "[name=csrf-token]"
                                    ).content,
                            },
                        }
                    )
                    .then(
                        (response) => {
                            this.modalShow.alert.show = true;
                            this.modalShow.alert.title = "Success";
                            this.modalShow.alert.message =
                                "Category enabled successfully!";
                            this.modalShow.alert.icon = "done";
                            this.modalShow.alert.class = "md-alert-success";
                            this.modalShow.alert.reload = true;
                        },
                        (response) => {
                            this.modalShow.alert.show = true;
                            this.modalShow.alert.title = "System Error";
                            this.modalShow.alert.message =
                                "We had a problem with our system, and this category can not be enabled. Try again. If the error persists, please contact us.";
                            this.modalShow.alert.icon = "error";
                            this.modalShow.alert.class = "md-alert-error";
                        }
                    );
            }
        },
        showClose: function (e) {
            this.modalShow.enable = false;
            this.modalShow.alert.show = false;
            if (this.modalShow.alert.reload) window.location.reload();
        },
    },
};
</script>

<style lang="scss">
.md-icon-align {
    vertical-align: text-bottom !important;
}

.md-table > .md-table-toolbar > h1 {
    margin-top: 20px;
}

.md-table > .md-table-toolbar > p {
    display: inline;
    width: 100%;
    margin-left: 10px;
}

.md-table > .md-table-toolbar > .md-toolbar-section-start {
    margin-left: 10px;
}

.md-table > .md-table-toolbar > .md-field > input {
    width: 100%;
    padding-right: 0;
}

.md-table > .md-table-toolbar > .md-toolbar-section-end {
    margin-right: 10px;
}

.md-table-button {
    text-transform: none !important;
    height: auto !important;
    width: auto !important;
    padding: 4px !important;
    min-width: auto !important;
    margin-left: 0;
}

.md-table-button > i {
    margin-right: 10px;
}

.md-table > .md-table-pagination {
    padding-top: 20px;
    margin-bottom: 20px;
    display: block;
}

.md-table > .md-table-pagination > .pagination {
    margin: auto 20px;
    padding: 0px;
    display: inline-block;
    vertical-align: top;
}

.md-table > .md-table-pagination > .showing {
    margin: auto 20px;
    padding: 0px;
    display: inline-block;
}

.md-table > .md-table-pagination > .showing > span,
.md-table > .md-table-pagination > .showing > div {
    display: inline-block;
    margin-left: 5px;
    margin-right: 5px;
}
.md-table > .md-table-pagination > .showing > span {
    padding-top: 10px;
    padding-bottom: 10px;
}

.md-table > .md-table-pagination > .pagination > li {
    list-style: none;
    float: left;
    padding: 10px;
}

.md-table > .table-responsive {
    width: 100% !important;
    overflow-x: auto;
}

.md-table
    > .table-responsive
    > .md-table-fixed-header-container
    > table
    > tbody
    > .md-table-row
    > .md-table-cell
    > .md-alignment-center,
.md-table
    > .table-responsive
    > .md-table-fixed-header-container
    > table
    > tbody
    > .md-table-row
    > .md-table-cell
    > a
    > .md-alignment-center {
    text-align: center;
}

.md-modal-delete {
    .md-dialog-container {
        .md-dialog-title {
            color: var(--md-theme-default-text-primary-on-modal-title);
        }
        .md-dialog-actions {
            .md-button.md-primary:hover:before {
                background-color: var(--md-theme-default-primary);
                opacity: 1;
            }
        }
        .md-modal-delete-content-alert {
            padding: 0;
        }
    }
}
.md-modal-edit {
    min-height: 750px !important;
}
/* start of desktop styles */

@media screen and (max-width: 961px) {
    /* start of large tablet styles */
    .md-table > .md-table-pagination {
        display: block;
        text-align: center;
    }
}

@media screen and (max-width: 767px) {
    /* start of medium tablet styles */

    .md-table
        > .md-table-pagination
        > .pagination
        > .page-item
        > .page-link
        > .page-link-label {
        display: none;
    }
    .md-table > .md-table-toolbar {
        display: block;
    }
}
</style>
