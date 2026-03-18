
<template>
  <md-card>
    <md-card-header>
      <div class="md-title">Frequently Asked Questions</div>
      <div class="md-subhead">Questions for administrative features</div>
    </md-card-header>

    <md-card-content>
      <VueFaqAccordion :items="myItems" />
    </md-card-content>
  </md-card>
</template>

<script>
import VueFaqAccordion from "vue-faq-accordion";
export default {
  components: {
    VueFaqAccordion
  },
  props: [],
  data: function() {
    return {
      myItems: [
        {
          title: "Adding Images Walkthrough",
          value: '<iframe src="https://player.vimeo.com/video/490478194" width="640" height="386" frameborder="0" allow="autoplay; fullscreen" allowfullscreen></iframe>',
          category: "Admin Training Video"
        },
        {
          title: "Add/Edit/Delete Copyright Walkthrough",
          value: '<iframe src="https://player.vimeo.com/video/505452237" width="640" height="315" frameborder="0" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen></iframe>',
          category: "Admin Training Video"
        },
        {
          title: "Adding Categories Walkthrough",
          value: '<iframe src="https://player.vimeo.com/video/490479342" width="640" height="360" frameborder="0" allow="autoplay; fullscreen" allowfullscreen></iframe>',
          category: "Admin Training Video"
        },
        {
          title: "Edit & Delete Categories Walkthrough",
          value: '<iframe src="https://player.vimeo.com/video/501531872" width="640" height="360" frameborder="0" allow="autoplay; fullscreen" allowfullscreen></iframe>',
          category: "Admin Training Video"
        },
        {
          title: "Disable & Enable Categories Walkthrough",
          value: '<iframe src="https://player.vimeo.com/video/501531497" width="640" height="564" frameborder="0" allow="autoplay; fullscreen" allowfullscreen></iframe>',
          category: "Admin Training Video"
        },
        {
          title: "Sort Images in Category Walkthrough",
          value: '<iframe src="https://player.vimeo.com/video/501912322" width="640" height="564" frameborder="0" allow="autoplay; fullscreen" allowfullscreen></iframe>',
          category: "Admin Training Video"
        },
        {
          title: "Embed Corgi Images to Learning Hub Walkthrough",
          value: '<iframe src="https://player.vimeo.com/video/501531892" width="640" height="564" frameborder="0" allow="autoplay; fullscreen" allowfullscreen></iframe>',
          category: "Admin Training Video"
        },
        {
          title: "Admin Programs Demo & Walkthrough",
          value: '<iframe src="https://player.vimeo.com/video/503148113" width="640" height="564" frameborder="0" allow="autoplay; fullscreen" allowfullscreen></iframe>',
          category: "Admin Training Video"
        },
        {
          title: "My program is not recognized?",
          value:
            "Please contact vsm_team@bcit.ca <br/> You need to provide your BCIT email and the BCIT program you are currently in. <br/> Please note that you won't be able to add, edit, delete images/categories until your program is recognized.",
          category: "Admin"
        },
        {
          title: "How does Admin program works?",
          value:
            "Only admin from that belongs to the program can add, edit, or delete images or categories. <br/> E.g. Admin from SOHS_MLS can only delete images in SOHS_MLS program",
          category: "Admin"
        },
        // {
        //   title: "Who has access to User List?",
        //   value:
        //     "Only administrator has access to user list.",
        //   category: "Admin"
        // },
        {
          title: "What does CORGI stand for?",
          value:
            "CORGI, stands for Creation Of Really Gorgeous Images, a state-of-the-art image viewer website developed for BCIT",
          category: "Admin"
        },
        {
          title: "Where are the images stored ?",
          value: "All images are store on Canadian Servers.",
          category: "Image"
        },
        {
          title: "What is the Maximum supported upload image size ?",
          value: "1 GB which is 1024 MB",
          category: "Image"
        },
        {
          title: "What image format are supported ?",
          value: "JPG/JPEG, PNG and TIFF",
          category: "Image"
        },
        {
          title: "Which special characters are supported ?",
          value: 'Space " ", Dash "-" and Underscore "_"',
          category: "Image"
        },
        {
          title: "How long can an upload take ?",
          value:
            "An upload can take 30 minutes. If it takes longer, the upload has been stalled or there is an connection issue. Please try again",
          category: "Image"
        },
        {
          title: "Can a deleted Image be recovered ?",
          value: "Once an image is deleted it cannot be recovered.",
          category: "Image"
        },
        {
          title: "Can an updated image be recovered ?",
          value:
            "The replaced image cannot be recovered. <br/> After update an old image to a new one. It will take from 15 minutes up to 24 hours to show the new image. We cache the image for faster serving time. Takes up to 24 hours to refresh the entire cache.",
          category: "Image"
        },
        {
          title: "Is Watermark feature supported ?",
          value:
            "Watermark feature is possible, but it will impact all the images on the website to have the watermark. <br/> Some images are viewed at the microscopic level and the watermark will affect visibility. ",
          category: "Image"
        },
        {
          title:
            "I uploaded an image and the status show 'Processing', what does this mean ?",
          value:
            "The image is being prepared and will be ready for viewing. This process can take a long time depending on its position in the queue and the image size",
          category: "Image"
        },
        {
          title:
            "I uploaded an image and the status show 'Error', what does this mean ?",
          value:
            "This means the image file could be corrupted, Please try again with a different Image. If the error persists, please contact vsm_team@bcit.ca.",
          category: "Image"
        },
        {
          title: "Can I create a subcategory inside a category ?",
          value: "One level of subcategory can be created within a category",
          category: "Category"
        },
        {
          title: "Can a category be deleted ?",
          value:
            "A category can only be deleted when it’s empty (no images, no subcategory)",
          category: "Category"
        },
        {
          title: "Which special characters are supported ?",
          value: 'Space " ", Dash "-" and Underscore "_"',
          category: "Category"
        },
        {
          title: "Can copyright be deleted ?",
          value: "Yes, a copyright can only be deleted when it is not being used by any image. (Image Count is zero)",
          category: "Copyright"
        },
        {
          title: "How many copyrights can I create ?",
          value: "It is unlimited at the moment, as long as your copyright is not duplicated with any existing copyright.",
          category: "Copyright"
        },
        {
          title: "What is the Image Count on the copyright page ?",
          value: "Image Count displays how many images are currently using a certain copyright.",
          category: "Copyright"
        },
        {
          title: "Who can view/use copyrights created by me ?",
          value: "Any admin can view & use your copyright when adding an image.",
          category: "Copyright"
        },
        {
          title: "Which special characters are supported ?",
          value: 'Space " ", Dash "-", Underscore "_", and Dot "."',
          category: "Copyright"
        },
      ]
    };
  },
  methods: {},
  created() {},
  mounted: function() {}
};
</script>

<style lang="scss">
iframe {
    height: 350px !important;
}
</style>