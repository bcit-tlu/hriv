<template>
  <div class="md-card md-card-zoomify md-theme-default">
    <div
      class="md-toolbar md-table-toolbar md-transparent md-theme-default md-elevation-0 table-responsive"
    >
      <h1 class="md-title">{{imagetitle}}</h1>
      <div
        v-if="imagedescription != ''"
        class="description-tooltip"
        @click="tooltipActive = !tooltipActive"
      >
        <md-icon>help_outline</md-icon>
        <md-tooltip :md-active.sync="tooltipActive">{{imagedescription}}</md-tooltip>
      </div>

      <div v-if="modalShare.enable" class="md-alignment-right" @click="showModal()">
        <md-icon md-src="/images/bcitlogo.svg" />
        <md-tooltip>Click to generate link to embed in the Learning Hub</md-tooltip>
      </div>

      <md-dialog :md-active.sync="modalShare.show">
        <md-dialog-title>{{modalShare.title}}</md-dialog-title>

        <md-content>
          <img src="/images/embed_instruction_optimized.gif" alt="embed_instruction_hd" />
        </md-content>
        <md-content>&nbsp;</md-content>
        <!-- <md-content>{{modalShare.sharetag}}</md-content> -->
        <!-- <md-content>{{modalShare.embedElement}}</md-content> -->

        <md-dialog-actions>
          <md-button
            class="md-dense"
            v-clipboard:copy="modalShare.embedElement"
            v-clipboard:success="onCopy"
            v-clipboard:error="onError"
          >
            <div v-bind:class="{ active: modalShare.copyDone }" v-if="modalShare.copyDone">
              Copied
              <md-icon>done</md-icon>
            </div>
            <div v-else>Copy Embed Link To Clipboard</div>
          </md-button>

          <md-button class="md-dense md-accent" @click="closeModal()">Close</md-button>
        </md-dialog-actions>
      </md-dialog>
    </div>
    
    <div class="md-theme-default copyright">
      <div>
      <md-icon>copyright</md-icon>{{ image_copyright }}
      </div>
    </div>

    <div
      class="md-toolbar md-toolbar-zoomify md-table-toolbar md-transparent md-theme-default md-elevation-0 table-responsive"
    >
      <div id="zoomify-image-container" class="zoomify"></div>
    </div>
  </div>
</template>

<script>
export default {
  props: ["imagetitle", "imagedescription", "image_copyright", "adminrole"],
  data: function() {
    // let url = document.location;
    // let href = document.location.href;
    // let pathname =  document.location.pathname;
    // const regex = /\/([a-z0-9-]*$)/;
    // const found = pathname.match(regex);
    // const urlpathname = found[1];
    return {
      tooltipActive: false,
      modalShare: {
        enable: this.adminrole,
        show: false,
        title: "Embed this image to the Learning Hub",
        height: 200,
        sharetag: "#CORGI " + document.location.href,
        embedElement:
          "<article><h2>" +
          this.imagetitle +
          '</h2><a href="' + document.location.href + '"><img src="' + document.location.href + '/preview" alt="' + this.imagetitle + '"></a></article>',
        copyDone: false
      }
    };
  },
  methods: {
    showModal: function() {
      this.modalShare.show = true;
    },
    closeModal: function() {
      this.modalShare.show = false;
    },
    onCopy: function(e) {
      this.modalShare.copyDone = true;
      setTimeout(
        function() {
          this.modalShare.copyDone = false;
        }.bind(this),
        3000
      );
    },
    onError: function(e) {
      alert("Failed to copy texts");
    }
  },
  created() {},
  mounted: function() {
  }
};
</script>

<style lang="scss">
.copyright {
  margin-left: 20px;
}
.md-card-zoomify {
  height: 95%;
  overflow: hidden !important;
  .md-toolbar {
    .md-title {
      flex: none;
      margin-right: 20px;
    }
  }
  .md-toolbar-zoomify {
    height: 93%;
    .zoomify {
      border: none !important;
      width: 100%;
      height: 100%;
      margin: auto;
      border: 1px;
      border-style: solid;
      border-color: #696969;
      #ToolbarDisplay {
        background-color: #fff !important;
        height: 35px !important;
      }
      #navigatorDisplay0 {
        left: 0 !important;
      }
    }
    .zoomify audio,
    .zoomify canvas,
    .zoomify embed,
    .zoomify iframe,
    .zoomify img,
    .zoomify object,
    .zoomify video {
      max-width: unset !important;
      vertical-align: unset !important;
    }

    .zoomify audio:not(.md-image),
    .zoomify canvas:not(.md-image),
    .zoomify embed:not(.md-image),
    .zoomify iframe:not(.md-image),
    .zoomify img:not(.md-image),
    .zoomify object:not(.md-image),
    .zoomify video:not(.md-image) {
      height: unset !important;
    }
  }
}
.md-tooltip {
  width: 94.5%;
  height: auto;
  white-space: normal;
  padding: 0.5em;
  font-size: 1.8em;
  margin-left: 15px;
}

.md-dialog {
  flex: none;
  .md-dialog-title {
    justify-self: center;
    align-self: center;
    font-size: 1.2em;
  }
  .md-content {
    justify-self: center;
    align-self: center;
    font-size: 0.9em;
    margin-left: 10%;
    margin-right: 10%;
  }
  .md-button {
    justify-self: center;
    align-self: center;
  }
  .active {
    color: green;
    .md-icon {
      color: green;
    }
  }
}

@media screen and (max-width: 479px) {
  .md-card-zoomify {
    .md-toolbar {
      .md-title {
        flex: 1;
      }
    }
  }
}
</style>