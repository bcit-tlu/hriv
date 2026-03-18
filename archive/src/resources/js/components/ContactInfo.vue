<template>

<div class="md-card md-table md-theme-default" md-card="" md-fixed-header="">

        <div class="md-toolbar md-table-toolbar md-transparent md-theme-default md-elevation-0 table-responsive">
            <h1 class="md-title">{{title}}</h1>
            <p class="md-description"> {{description}} </p>
        </div>
        <div class="md-layout md-gutter md-alignment-top-center">
            <div class="md-layout-item md-size-60">
                <h3>Message to the public:</h3>
                Want to use this website in your course curriculum?
                <br><br>
                Please contact <a href="mailto:vsm_team@bcit.ca" style="color: blue;">vsm_team@bcit.ca</a> for further information.
            </div>
        </div>

        <div class="md-layout md-gutter md-alignment-top-center">
            <div class="md-layout-item md-size-60">
                <h3>Information about this website:</h3>
                Corgi, stands for Creation Of Really Gorgeous Images, a state-of-the-art image viewer website developed for BCIT. The image viewer is a sharing repository of images that are useful across schools and programs. 
                <br><br>
                The image viewer allows users to incorporate high-resolution pictures—up to 26 billion pixels!— into curricula. This user-friendly application, accessible across devices such as mobile phone, tablet, laptop, and desktop computer, allows instructors to easily upload high-resolution images up to a microscopic level, eliminating the need for users to have access to a microscope.
                <br><br>
                Instructors can easily embed images into Learning Hub and students can view it seamlessly without leaving the Learning Hub.
                <br><br><br>
            </div>
        </div>
         
</div>
</template>

<script>
    export default {
        props: ['title', 'description'],
        data: function(){
            return {

            }
        },
        created() {
            
        },
        methods: {
            
        }
    };
</script>

<style lang="scss">

    .md-table > .table-responsive {
        width: 100% !important;
        overflow-x: auto;
    }

    .md-table > .table-responsive > .md-table-fixed-header-container > table > tbody > .md-table-row > .md-table-cell > .md-alignment-center, .md-table > .table-responsive > .md-table-fixed-header-container > table > tbody > .md-table-row > .md-table-cell > a > .md-alignment-center {
        text-align: center;
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

        .md-table > .md-table-pagination > .pagination > .page-item > .page-link > .page-link-label {
            display: none;        
        }
        .md-table > .md-table-toolbar {
            display: block;
        }
    }
</style>