<template>
    <div class="md-card md-table md-theme-default" md-card="" md-fixed-header="">
        <div class="md-toolbar md-table-toolbar md-transparent md-theme-default md-elevation-0 table-responsive">
            <h1 class="md-title">{{this.constStr.pageActionTitle}}</h1>
            <p class="md-description">{{this.constStr.pageActionDescription}}</p>
        </div>

        <div v-if="alert.show" class="md-toolbar md-table-toolbar md-transparent md-theme-default md-elevation-0 table-responsive">
            <md-empty-state 
              class="md-alert"
              :class="alert.class"
              :md-icon="alert.icon"
              :md-label="alert.title"
              :md-description="alert.message">
            </md-empty-state>
            <div class="md-form-button md-layout-item md-size-100">
                <md-button class="md-dense md-raised md-primary" @click.prevent="backToList">Back to Images List</md-button>
                <md-button v-if="!this.is_edit" class="md-dense md-raised" @click.prevent="addNewImage">{{this.constStr.resultModelButtonText}}</md-button>
            </div>
        </div>

        <div v-else class="md-toolbar md-table-toolbar md-transparent md-theme-default md-elevation-0 table-responsive">
            <form class="md-layout md-form-image" method="POST" :action="posturl" ref="form">
                <input type="hidden" name="_token" :value="csrfToken">
                <div class="md-layout-item md-size-100">
                    <md-field :class="{'md-invalid': form.validation.name.hasError}">
                        <label for="input-name">Name</label>
                        <md-input name="name" id="input-name" v-model="form.field.name"/>
                        <span class="md-error">{{form.validation.name.messageError}}</span>
                    </md-field>
                </div>

                <!-- <div class="md-layout-item md-size-100">
                    <md-field :class="{'md-invalid': form.validation.title.hasError}">
                        <label for="input-title">Title</label>
                        <md-input name="title" id="input-title" v-model="form.field.title"/>
                        <span class="md-error">{{form.validation.title.messageError}}</span>
                    </md-field>
                </div> -->

                <div class="md-layout-item md-size-100 md-textarea-align">
                    <md-field :class="{'md-invalid': form.validation.description.hasError}">
                        <label for="input-description">Description</label>
                        <md-textarea name="description" id="input-description" v-model="form.field.description"></md-textarea>
                        <span class="md-error">{{form.validation.description.messageError}}</span>
                    </md-field>
                </div>
                <div class="md-layout-item md-size-100">
                    <md-field :class="{'md-invalid': form.validation.copyright_id.hasError}">
                        <label>Type to search the Copyright...</label>
                        <md-input id="input-search-copyright" name="copyright_name" v-model="form.field.copyright_name" class="md-input-button" @keyup.enter="searchCopyright"></md-input>
                        <md-button class="md-dense md-raised md-primary" @click="searchCopyright">
                        Search Copyright</md-button>
                        <span class="md-error">{{form.validation.copyright_id.messageError}}</span>
                    </md-field>

                    <div v-if="form.field.copyright_name && copyright_list && copyright_list.length > 0" 
                        class="md-form-category-list">
                      <h3>Select the Copyright: </h3>
                      <div class="md-layout-item md-form-category-list-item md-small-size-100">
                        <template v-for="copyr in copyright_list">
                          <div class="md-layout-item">
                            <md-radio name="copyr_id"
                            id="input-copyright"
                            v-model="form.field.copyright_id"
                            :value="copyr.id" 
                            :class="{'md-checked' : copyr.id == form.field.copyright_id}">
                            {{ copyr.name }}
                            </md-radio>                                   
                          </div>
                        </template>
                      </div>
                    </div>

                </div>
                <div class="md-layout-item md-size-100">
                    <md-field :class="{'md-invalid': form.validation.category_id.hasError}">
                        <label>Type to search the Category...</label>
                        <md-input id="input-search-category" name="q" v-model="form.field.q" class="md-input-button" @keyup.enter="searchCategory"></md-input>
                        <md-button class="md-dense md-raised md-primary" @click="searchCategory">
                        Search Category</md-button>
                        <span class="md-error">{{form.validation.category_id.messageError}}</span>
                    </md-field>

                    <div v-if="form.field.q && categories && categories.length > 0" 
                        class="md-form-category-list">
                      <h3>Select the Category: </h3>
                      <div class="md-layout-item md-form-category-list-item md-small-size-100">
                        <template v-for="category in categories">
                          <div class="md-layout-item">
                            <md-radio name="category_id"
                            id="input-category"
                            v-model="form.field.category_id"
                            :value="category.id" 
                            :class="{'md-checked' : category.id == form.field.category_id}">
                            {{ category.name }}
                            </md-radio>                                   
                          </div>
                        </template>
                      </div>
                    </div>

                    <div v-if="Object.keys(this.linkedprograms).length > 0" 
                        class="md-form-category-list">
                      <h3>Select the Program:  <i class="far fa-question-circle"></i>
                            <md-tooltip>This image will only be editable by the administrators in your selected program</md-tooltip>
                     </h3>
                      <div class="md-layout-item md-form-category-list-item md-small-size-100">
                        <template v-for="(programName, index) in this.linkedprograms">
                          <div class="md-layout-item">
                            <md-radio name="programid"
                            id="input-programid"
                            v-model="form.field.admin_program_id"
                            :value="index" 
                            :class="{'md-checked' : index == form.field.admin_program_id}">
                            {{ programName }}
                            </md-radio>                                   
                          </div>
                        </template>
                      </div>
                    </div>

                </div>
                <div class="md-layout-item md-size-100">
                    <div class="md-dropzone-field" :class="{'md-invalid': form.validation.path.hasError}">
                        <dropZone @uploaded-file="getFile" 
                        @uploaded-started="blockAction" 
                        @uploaded-finished="unblockAction" 
                        class="md-textarea-align" 
                        :url="this.uploadimageurl"
                        :clear="upload.clear"
                        ref="dropzone"
                        />
                        <span class="md-error">{{form.validation.path.messageError}}</span>
                    </div>
                </div>
                <transition>
                    <div v-if="!upload.processing" class="md-form-button md-layout-item md-size-100">
                        <md-button class="md-dense md-raised md-primary" @click.prevent="onSubmit">{{this.constStr.submitButtonText}}</md-button>
                        <md-button v-if="!this.is_edit" class="md-dense md-raised" @click.prevent="clearForm">Clear Form</md-button>
                    </div>
                </transition>
                <transition>
                    <div v-if="upload.processing" class="md-form-button md-layout-item md-size-100">
                        <md-progress-spinner md-mode="indeterminate" :md-diameter="30"></md-progress-spinner>
                        <span class="md-progress-spinner-span md-body-2">{{this.constStr.ProcessingText}}</span>
                    </div>
                </transition>
            </form>
        </div>
    </div>
</template>

<script>
var uploadedFile;
import dropZone from './DropZone';

export default {
    props: [
        'posturl', 
        'imagelisturl', 
        'searchcopyrighturl', 
        'searchcategoryurl', 
        'uploadimageurl', 
        'dataform', 
        'is_edit',
        'linkedprograms'
        ],
    components: {
        dropZone
    },
    data: () => ({
        alert: {
            class: null,
            icon: null,
            show: false,
            title: null,
            message: null,
        },
        form: {
            field: {
                id: '',
                name: '',
                title: '',
                description: '',
                path: '',
                category_id: null,
                category_name: '',
                q: '',
                copyright_id: null,
                copyright_name: '',
                admin_program_id: null
            },
            validation: {
                name: {
                    hasError: false,
                    messageError: null
                },
                title: {
                    hasError: false,
                    messageError: null
                },
                description: {
                    hasError: false,
                    messageError: null
                },
                path: {
                    hasError: false,
                    messageError: null
                },
                category_id: {
                    hasError: false,
                    messageError: null
                },
                copyright_id: {
                    hasError: false,
                    messageError: null
                },
            }
        },
        upload: {
            processing: false,
            clear: false,
            successNewUpload: false,
        },
        uploadedFile,
        csrfToken: null,
        categories: null,
        copyright_list: null,
        constStr:{
            pageActionTitle: "Add Image",
            pageActionDescription: "Form to add a new image in the Corgi System.",
            submitButtonText: "ADD",
            resultModelButtonText: "Add new Image",
            ProcessingText: "Please wait until the upload is complete.",
            ProcessingTextSave: "Processing",
            ProcessingTextUploadImage: "Please wait until the upload is complete.",
    },
    }),
    created() {
        this.csrfToken = document.querySelector('meta[name="csrf-token"]').getAttribute('content');
        if(this.is_edit){
            this.constStr.pageActionTitle = "Edit Image"
            this.constStr.pageActionDescription = "Form to edit image in the Corgi System."
            this.constStr.submitButtonText = "SAVE"
            this.constStr.resultModelButtonText = "Back to edit Image"
        } else if (Object.keys(this.linkedprograms).length == 1) {
            this.form.field.admin_program_id = Number(Object.keys(this.linkedprograms)[0]);
        } else {
            // do nothing
        }
    },
    mounted() {
        this.populateForm()
    },
    methods: {
        populateForm () {
            if (this.dataform != 'null') {
                var formData = JSON.parse(this.dataform);
                Object.assign(this.$data.form.field, formData);
                this.$refs.dropzone.vpopulate(this.form.field.path, this.form.field.name, formData.size);
                this.form.field.copyright_id = formData.image_source_id
                this.form.field.q = formData.category_name;
                this.searchCategory()
            }
        },
        addNewImage () {
            window.location = window.location
        },
        backToList () {
            window.location = this.imagelisturl
        },
        blockAction () {
            this.upload.processing = true
        },
        unblockAction () {
            this.upload.processing = false
        },
        clearForm () {
            this.upload.clear = true;
            setTimeout(() => { Object.assign(this.$data, this.$options.data.call(this));}, 10);
         },
        clearFormValidation () {
            this.$data.form.validation = this.$options.data.call(this).form.validation
        },
        getFile: function(response) {
            this.form.field.path = ''
            if (response.file)
                this.form.field.path = response.file
                this.upload.successNewUpload = true
        },
        onSubmit () {
            // https://bcitltc.atlassian.net/browse/CORGI-127
            // bug
            this.upload.processing = true;
            this.constStr.ProcessingText = this.constStr.ProcessingTextSave;
            var formData = new FormData()
            formData.append('id', this.form.field.id)
            formData.append('name', this.form.field.name)
            // https://bcitltc.atlassian.net/browse/CORGI-75 
            // we have decided to hide the title field set it equal to name.
            // formData.append('title', this.form.field.title)
            formData.append("title", this.form.field.name);

            // https://bcitltc.atlassian.net/browse/CORGI-128
            // we got a request to make description not required.
            // if it is empty use the name as default value
            if (this.form.field.description.length == 0) {
                formData.append(
                "description",
                "[This image does not have a description]"
                );
            } else {
                formData.append("description", this.form.field.description);
                        }

            formData.append("category_id", this.form.field.category_id);
            formData.append("path", this.form.field.path);
            formData.append("copyright_id", this.form.field.copyright_id);
            formData.append("programId", this.form.field.admin_program_id);
            formData.append("success_new_upload", this.upload.successNewUpload);
            
            this.$http.post(this.posturl, formData, {
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
                this.showAlert(
                "Image Saved Successfully!",
                "Your image is being processed and will be available to users when the process is complete. This process may take minutes or hours to complete.You can track the status of this image in the Image List in the management area.",
                "success"
                );
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
                        this.form.validation[eleName].hasError = true;
                        this.form.validation[eleName].messageError = errorMsg;
                                    }
                                }
                            }
                        }
                this.upload.processing = false;
                this.constStr.ProcessingText = this.constStr.ProcessingTextUploadImage;
                    } else {
                this.showAlert(
                    "Image not saved!",
                    "Your image can not be saved. Try again or contact us if this error to persist.",
                    "error"
                );
                }
                    }
            );
        },
        searchCategory: function () {
            this.$http.post(this.searchcategoryurl, {'q': this.form.field.q}, { 
                    headers: { 'X-CSRF-TOKEN': document.head.querySelector("[name=csrf-token]").content}, 
                    responseType: 'json',
                    before: function() { 
                        this.categories = null
                        this.clearFormValidation()
                    }
                }).then(response => {
                    if(response.body.length > 0) {
                        this.categories = response.body  
                    } else {
                        this.form.field.category_id = null
                        this.form.validation.category_id.hasError = true
                        this.form.validation.category_id.messageError = "Category not found!"  
                    }
                }, error_response => {
                    this.form.field.category_id = null
                    this.form.validation.category_id.hasError = true
                    this.form.validation.category_id.messageError = error_response.body.errors.q.join(' | ')
            });
        },
        searchCopyright: function () {
            this.$http.post(this.searchcopyrighturl, {'q': this.form.field.copyright_name}, { 
                    headers: { 'X-CSRF-TOKEN': document.head.querySelector("[name=csrf-token]").content}, 
                    responseType: 'json',
                    before: function() { 
                        this.copyright_list = null
                        this.clearFormValidation()
                    }
                }).then(response => {
                    if(response.body.length > 0) {
                        this.copyright_list = response.body  
                    } else { 
                        this.form.field.copyright_id = null
                        this.form.validation.copyright_id.hasError = true
                        this.form.validation.copyright_id.messageError = "Copyright not found!"  
                    }
                }, error_response => {
                    this.form.field.copyright_id = null
                    this.form.validation.copyright_id.hasError = true
                    this.form.validation.copyright_id.messageError = error_response.body.errors.q.join(' | ')
            });
        },
        showAlert (title, message, status) {

            this.alert.show = true
            this.alert.title = title
            this.alert.message = message

            switch(status) {
                case 'success':
                    this.alert.icon = 'done'
                    this.alert.class = 'md-alert-success'
                    break;
                case 'error':
                    this.alert.icon = 'error'
                    this.alert.class = 'md-alert-error'
                    break;
                case 'warning':
                    this.alert.icon = 'warning'
                    this.alert.class = 'md-alert-warning'
                    break;
                default:
                    this.alert.icon = 'info'
                    this.alert.class = 'md-alert-info'
            }
        },
    }
}
</script>

<style lang="scss" scoped>
.md-card {
    .md-toolbar {
        .md-alert {
            width: 100%;
        }
        .md-form-image {
            padding: 0 20px;
            margin-bottom: 20px;
        }
        .md-form-button {
            margin: 30px 20px 30px 0;
        }
        .md-layout {
            .md-textarea-align {
                margin-top: 20px;
            }
            .md-layout-item {
                .md-dropzone-field.md-invalid {
                    .vue-dropzone {
                        border-color: var(--md-theme-default-fieldvariant, #ff1744);    
                    }
                    .md-error {
                        color: var(--md-theme-default-fieldvariant, #ff1744);
                        font-size: 12px;
                        transition: .3s cubic-bezier(.4,0,.2,1);
                    }
                }
                .md-form-category-list {
                    margin-top: 30px;

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

                    .md-form-category-list-item {
                        max-height: 180px;
                        overflow: auto;

                        .md-layout-item {
                            margin-left: 20px;
                        }  
                    }
                } 
                .md-progress-spinner {
                    margin-top: 20px;
                    float: left;
                }   
                .md-progress-spinner-span {
                    margin-left: 15px;
                    margin-top: 25px;
                    display: inline-block;
                }
            }
        }
    }
}
</style>