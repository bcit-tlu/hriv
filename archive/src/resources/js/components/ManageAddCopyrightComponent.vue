<template>
    <div>
        <md-empty-state
            v-if="alert.show"
            class="md-alert"
            :class="alert.class"
            :md-icon="alert.icon"
            :md-label="alert.title"
            :md-description="alert.message"
        >
        </md-empty-state>
        <form
            v-if="show.form"
            id="form-save-copyright"
            class="md-layout"
            @submit.prevent="save()"
        >
            <md-card-content class="md-layout md-form-copyright">
                <div class="md-layout-item md-small-size-100">
                    <div class="md-layout-item md-small-size-100">
                        <md-field
                            :class="{
                                'md-invalid':
                                    form.validation.copyright.hasError,
                            }"
                        >
                            <label for="name">Copyright Name</label>
                            <md-input
                                name="copyright"
                                id="copyright"
                                maxlength="50"
                                v-model="form.field.copyright"
                            ></md-input>
                            <span class="md-error">{{
                                form.validation.copyright.messageError
                            }}</span>
                        </md-field>

                        <div
                            v-if="
                                form.field.q &&
                                images_source &&
                                images_source.length > 0
                            "
                        ></div>

                        <div v-if="Object.keys(this.linkedprograms).length > 0">
                            <h3>
                                Select the program:
                                <i class="far fa-question-circle"></i>
                                <md-tooltip
                                    >This copyright will only be editable by the
                                    administrators in your selected
                                    program</md-tooltip
                                >
                            </h3>

                            <div
                                class="md-layout-item md-small-size-100 copyright-fixed-height"
                            >
                                <template
                                    v-for="(programName, index) in this
                                        .linkedprograms"
                                >
                                    <div class="md-layout-item">
                                        <md-radio
                                            name="programid"
                                            id="programid"
                                            v-model="
                                                form.field.admin_program_id
                                            "
                                            :value="index"
                                            :class="{
                                                'md-checked':
                                                    index ==
                                                    form.field.admin_program_id,
                                            }"
                                        >
                                            {{ programName }}
                                        </md-radio>
                                    </div>
                                </template>
                            </div>
                        </div>
                    </div>
                </div>
            </md-card-content>
        </form>
        <md-dialog-actions>
            <md-button class="md-primary" @click="props.closeModal()"
                >Close</md-button
            >
            <md-button v-if="show.btnSave" class="md-primary" @click="save()"
                >Save</md-button
            >
            <md-button
                v-else-if="show.btnNewCopyright"
                class="md-primary"
                @click="addNew()"
                >ADD NEW</md-button
            >
        </md-dialog-actions>
    </div>
</template>

<script>
export default {
    props: ["props", "linkedprograms"],
    data: () => ({
        alert: {
            class: null,
            icon: null,
            show: false,
            title: null,
            message: null,
        },
        images_source: null,
        show: {
            btnNewCopyright: false,
            btnSave: true,
            form: true,
        },
        form: {
            field: {
                copyright: "",
                q: "",
                admin_program_id: null,
            },
            validation: {
                copyright: {
                    hasError: false,
                    messageError: null,
                },
            },
        },
    }),
    created() {
        if (this.props.editId) {
            this.populate(this.props.editId);
        } else if (Object.keys(this.linkedprograms).length == 1) {
            this.form.field.admin_program_id = Number(
                Object.keys(this.linkedprograms)[0]
            );
        } else {
            // do nothing
        }
    },
    methods: {
        showAlert(title, message, status) {
            this.alert.show = true;
            this.alert.title = title;
            this.alert.message = message;

            switch (status) {
                case "success":
                    this.alert.icon = "done";
                    this.alert.class = "md-alert-success";
                    break;
                case "error":
                    this.alert.icon = "error";
                    this.alert.class = "md-alert-error";
                    break;
                case "warning":
                    this.alert.icon = "warning";
                    this.alert.class = "md-alert-warning";
                    break;
                default:
                    this.alert.icon = "info";
                    this.alert.class = "md-alert-info";
            }
        },
        clearAll() {
            this.clearAlert();
            this.clearShow();
            this.clearForm();
            this.images_source = null;
        },
        clearShow() {
            this.$data.show = this.$options.data.call(this).show;
        },
        clearForm() {
            this.$data.form = this.$options.data.call(this).form;
        },
        clearFormValidation() {
            this.$data.form.validation =
                this.$options.data.call(this).form.validation;
        },
        clearAlert() {
            this.$data.alert = this.$options.data.call(this).alert;
        },
        addNew() {
            this.clearAll();
        },
        save() {
            let formData = new FormData();
            formData.append("copyright", this.form.field.copyright);
            formData.append(
                "editId",
                this.props.editId ? this.props.editId : ""
            );
            formData.append("programId", this.form.field.admin_program_id);
            this.$http
                .post("/manage/copyright/save", formData, {
                    headers: {
                        "X-CSRF-TOKEN": document
                            .querySelector('meta[name="csrf-token"]')
                            .getAttribute("content"),
                    },
                    responseType: "json",
                    before: function () {
                        this.clearFormValidation();
                    },
                })
                .then(
                    (response) => {
                        this.clearAll();
                        this.showAlert(
                            "Copyright save with success!",
                            "Click to new copyright to add new one or in close to back the copyright list.",
                            "success"
                        );
                        this.show.btnNewCopyright = true;
                        this.show.btnSave = false;
                        this.show.form = false;
                    },
                    (response) => {
                        if (typeof response.body.errors !== "undefined") {
                            let errors = response.body.errors;
                            if (errors) {
                                for (const item in errors) {
                                    if (item && errors[item].length > 0) {
                                        let eleName = item;
                                        let errorMsg = errors[item][0];
                                        if (this.form.validation[eleName]) {
                                            this.form.validation[
                                                eleName
                                            ].hasError = true;
                                            this.form.validation[
                                                eleName
                                            ].messageError = errorMsg;
                                        }
                                    }
                                }
                            }
                        }
                    }
                );
        },
        populate: function (editId) {
            this.$http
                .post(
                    "/manage/copyright/search",
                    { id: editId },
                    {
                        headers: {
                            "X-CSRF-TOKEN":
                                document.head.querySelector("[name=csrf-token]")
                                    .content,
                        },
                        responseType: "json",
                    }
                )
                .then((response) => {
                    var copyrightData = response.body;
                    if (copyrightData) {
                        this.form.field.copyright = copyrightData.name;
                        this.form.field.admin_program_id =
                            copyrightData.admin_program_id;
                    }
                });
        },
    },
};
</script>

<style lang="scss">
.md-form-category {
    width: 500px;
}

.md-form-category-subcategories {
    ::-webkit-scrollbar {
        -webkit-appearance: none;
    }

    ::-webkit-scrollbar:vertical {
        width: 15px;
    }

    ::-webkit-scrollbar-thumb {
        background-color: #ccc;
        border-radius: 10px;
        border: 2px solid #eee;
    }

    ::-webkit-scrollbar-track {
        border-radius: 10px;
        background-color: #eee;
    }

    .md-layout-item {
        margin-left: 20px;
    }

    & > div {
        max-height: 150px;
        overflow-y: auto;
    }
}

.copyright-fixed-height {
    height: 400px;
    overflow-y: auto;
}

.md-form-category-subcategories-not-selected {
    margin-top: 60px;
}

@media screen and (max-width: 427px) {
    .md-form-category-subcategories-not-selected {
        margin-top: 80px;
    }
}

@media screen and (max-width: 600px) {
    .md-form-category {
        width: auto;
    }
}
</style>
