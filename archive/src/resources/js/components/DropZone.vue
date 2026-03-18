<template>
    <div>
        <vue-dropzone
            ref="myVueDropzone"
            id="dropzone"
            :options="dropzoneOptions"
            :useCustomSlot="true"
            @vdropzone-file-added="(file) => vadd(file)"
            @vdropzone-complete="(response) => vcomplete(response)"
            @vdropzone-success="(file, response) => vsuccess(file, response)"
            @vdropzone-error="
                (file, message, xhr) => verror(file, message, xhr)
            "
            @vdropzone-removed-file="
                (file, error, xhr) => vremove(file, error, xhr)
            "
        >
            <div class="dropzone-custom-content">
                <h3 class="dropzone-custom-title">
                    Drag & drop to upload content
                </h3>
                <div class="subtitle">...or click to upload file</div>
            </div>
        </vue-dropzone>
        <div
            class="drop-message"
            :class="message.class"
            v-if="message.enable"
            v-html="message.text"
        ></div>
    </div>
</template>

<script>
import vue2Dropzone from "vue2-dropzone";
import "vue2-dropzone/dist/vue2Dropzone.min.css";

var defaultData = function () {
    return {
        dropzoneOptions: {
            url: this.url,
            maxFilesize: 1024, //MB
            timeout: 1800000, // 1800 000 ms > 30 minutes
            maxFiles: 1,
            acceptedFiles: ".jpg, .jpeg, .tiff,.tif, .png",
            addRemoveLinks: true,
            uploadMultiple: false,
            ignoreHiddenFiles: true,
            previewTemplate: this.template(),
            headers: {
                "X-CSRF-TOKEN":
                    document.head.querySelector("[name=csrf-token]").content,
            },
        },
        message: {
            enable: false,
            class: "",
            text: "",
        },
    };
};

export default {
    props: ["url", "clear"],
    components: {
        vueDropzone: vue2Dropzone,
    },
    data: defaultData,
    watch: {
        clear() {
            if (this.clear) {
                this.$refs.myVueDropzone.removeAllFiles();
            }
        },
    },
    methods: {
        vpopulate(url, name, size) {
            var file = { size: size, name: name };
            var url = url;
            this.$refs.myVueDropzone.manuallyAddFile(file, url);
        },
        vadd(file) {
            this.$emit("uploaded-started");
        },
        vcomplete(response) {
            this.$emit("uploaded-finished");
        },
        vremove(file, error, xhr) {
            this.$data.message = this.$options.data.call(this).message;
        },
        vsuccess(file, response) {
            this.$emit("uploaded-file", {
                file: response.fileLocalName,
                response: "success",
            });
            this.message.enable = true;
            this.message.class = "drop-message-success";
            this.message.text =
                "<strong>Image uploaded Successfully!</strong> To continue, fill the form and click on SAVE/ADD.";
        },
        verror(file, response, xhr) {
            console.log("Error response", response);
            console.log("Error xhr", xhr);
            this.$emit("uploaded-file", { response: "error" });
            this.$refs.myVueDropzone.dropzone.removeFile(file);
            this.message.enable = true;
            this.message.class = "drop-message-error";
            this.message.text =
                "<strong>Action not allowed!</strong> Supported Image format: jpg/jpeg, png, tiff";
        },
        template: function () {
            return `<div class="dz-preview dz-file-preview">
                            <div class="dz-image"><img data-dz-thumbnail /></div>
                            <div class="dz-details">
                                <!-- <div class="dz-size"><span data-dz-size></span></div> -->
                                <div class="dz-filename"><span data-dz-name></span></div>
                            </div>
                            <div class="dz-progress"><span class="dz-upload" data-dz-uploadprogress></span></div>
                            <div class="dz-success-mark">
                                <svg width="54px" height="54px" viewBox="0 0 54 54" version="1.1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:sketch="http://www.bohemiancoding.com/sketch/ns">
                                    <title>Check</title>
                                    <defs></defs>
                                    <g id="Page-1" stroke="none" stroke-width="1" fill="none" fill-rule="evenodd" sketch:type="MSPage">
                                        <path d="M23.5,31.8431458 L17.5852419,25.9283877 C16.0248253,24.3679711 13.4910294,24.366835 11.9289322,25.9289322 C10.3700136,27.4878508 10.3665912,30.0234455 11.9283877,31.5852419 L20.4147581,40.0716123 C20.5133999,40.1702541 20.6159315,40.2626649 20.7218615,40.3488435 C22.2835669,41.8725651 24.794234,41.8626202 26.3461564,40.3106978 L43.3106978,23.3461564 C44.8771021,21.7797521 44.8758057,19.2483887 43.3137085,17.6862915 C41.7547899,16.1273729 39.2176035,16.1255422 37.6538436,17.6893022 L23.5,31.8431458 Z M27,53 C41.3594035,53 53,41.3594035 53,27 C53,12.6405965 41.3594035,1 27,1 C12.6405965,1 1,12.6405965 1,27 C1,41.3594035 12.6405965,53 27,53 Z" id="Oval-2" stroke-opacity="0.198794158" stroke="#747474" fill-opacity="0.816519475" fill="#FFFFFF" sketch:type="MSShapeGroup"></path>
                                    </g>
                                </svg>
                            </div>
                            <div class="dz-error-mark">
                                <svg width="54px" height="54px" viewBox="0 0 54 54" version="1.1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:sketch="http://www.bohemiancoding.com/sketch/ns">
                                    <title>Error</title>
                                    <defs></defs>
                                    <g id="Page-1" stroke="none" stroke-width="1" fill="none" fill-rule="evenodd" sketch:type="MSPage">
                                        <g id="Check-+-Oval-2" sketch:type="MSLayerGroup" stroke="#747474" stroke-opacity="0.198794158" fill="#FFFFFF" fill-opacity="0.816519475">
                                            <path d="M32.6568542,29 L38.3106978,23.3461564 C39.8771021,21.7797521 39.8758057,19.2483887 38.3137085,17.6862915 C36.7547899,16.1273729 34.2176035,16.1255422 32.6538436,17.6893022 L27,23.3431458 L21.3461564,17.6893022 C19.7823965,16.1255422 17.2452101,16.1273729 15.6862915,17.6862915 C14.1241943,19.2483887 14.1228979,21.7797521 15.6893022,23.3461564 L21.3431458,29 L15.6893022,34.6538436 C14.1228979,36.2202479 14.1241943,38.7516113 15.6862915,40.3137085 C17.2452101,41.8726271 19.7823965,41.8744578 21.3461564,40.3106978 L27,34.6568542 L32.6538436,40.3106978 C34.2176035,41.8744578 36.7547899,41.8726271 38.3137085,40.3137085 C39.8758057,38.7516113 39.8771021,36.2202479 38.3106978,34.6538436 L32.6568542,29 Z M27,53 C41.3594035,53 53,41.3594035 53,27 C53,12.6405965 41.3594035,1 27,1 C12.6405965,1 1,12.6405965 1,27 C1,41.3594035 12.6405965,53 27,53 Z" id="Oval-2" sketch:type="MSShapeGroup"></path>
                                        </g>
                                    </g>
                                </svg>
                            </div>
                        </div>`;
        },
    },
    mounted() {
        this.$refs.myVueDropzone.dropzone.on("addedfile", function (file) {
            if (this.files.length > 1) {
                this.removeFile(this.files[0]);
            }
        });
        this.$refs.myVueDropzone.dropzone.on(
            "maxfilesexceeded",
            function (file) {
                this.removeFile(file);
            }
        );
    },
};
</script>

<style>
.dropzone {
    color: black;
    height: 80%;
    display: flex;
    justify-content: center;
    align-items: center;
    border: 1px dashed #003c79;
    width: 100%;
}
.dropzone:hover {
    background: white;
    color: black;
}
.dropzone .dz-preview {
    min-height: 170px;
    min-width: 170px;
}
.drop-message {
    padding: 6px 10px;
    text-shadow: 0 1px 0 rgba(255, 255, 255, 0.5);
    border: 1px solid #fbeed5;
    -webkit-border-radius: 0 0 4px 4px;
    -moz-border-radius: 0 0 4px 4px;
    border-radius: 0 0 4px 4px;
    width: 100%;
    height: 40px;
}

.drop-message-success {
    background-color: #dff0d8;
    border-color: #d6e9c6;
    color: #468847;
}

.drop-message-error {
    color: #761b18;
    background-color: #f9d6d5;
    border-color: #f7c6c5;
}
</style>
