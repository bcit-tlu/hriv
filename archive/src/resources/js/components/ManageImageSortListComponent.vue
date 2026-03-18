<template>
  <div class="md-card md-table md-theme-default" md-card="" md-fixed-header="">
    <div
      class="md-toolbar md-table-toolbar md-transparent md-theme-default md-elevation-0 table-responsive"
    >
      <h1 class="md-title">{{ title }}</h1>
      <p class="md-description" v-html="description"></p>
    </div>
    <div
      class="md-toolbar md-table-toolbar md-transparent md-theme-default md-elevation-0 table-responsive"
    >
      <div class="md-layout-item md-size-10">
        <md-button class="md-dense md-raised md-primary" @click="reset"
          >Reset</md-button
        >
      </div>
      <div class="md-layout-item">
        <transition name="fade">
          <div v-if="showFlashMessage" class="alert alert-success">
            <strong>Well done!</strong> You successfully to sort the images.
          </div>
        </transition>
      </div>
    </div>
    <div
      class="md-toolbar md-table-toolbar md-transparent md-theme-default md-elevation-0 table-responsive"
    >
      <div class="md-layout-item sortable-list">
        <draggable
          class="sortable-list-group"
          tag="ul"
          v-model="list"
          v-bind="dragOptions"
          @start="onStart"
          @end="onEnd"
        >
          <transition-group type="transition" name="sortable-flip-list">
            <li
              v-for="(element, index) in list"
              :key="index + 0"
              :md-ripple="false"
              class="sortable-list-item"
            >
              <md-icon>drag_indicator</md-icon>
              <img
                v-bind:src="thumnailbaseurl + element.thumbnail"
                :title="element.name"
              />
              <span v-if="element.status_id == 1"> {{ element.name }} </span>
              <span v-else>(Disabled) {{ element.name }}</span>
            </li>
          </transition-group>
        </draggable>
      </div>
    </div>
  </div>
</template>

<script>
import draggable from "vuedraggable";

export default {
  props: ["items", "title", "thumnailbaseurl", "description", "urlsort"],
  data() {
    return {
      list: false,
      isDragging: true,
      showFlashMessage: false,
    };
  },
  created() {
    this.list = this.items;
  },
  components: {
    draggable,
  },
  methods: {
    reset() {
      this.$data.list = this.items;
      this.save();
    },
    onStart() {
      this.isDragging = true;
    },
    onEnd() {
      this.isDragging = false;
      this.save();
    },
    save() {
      this.$http
        .post(
          this.urlsort,
          { images: this.list },
          {
            headers: {
              "X-CSRF-TOKEN": document.head.querySelector("[name=csrf-token]")
                .content,
            },
            responseType: "json",
          }
        )
        .then(
          (response) => {
            this.flashMessage();
          },
          (response) => {}
        );
    },
    flashMessage() {
      this.showFlashMessage = true;
      setTimeout(
        function () {
          this.showFlashMessage = false;
        }.bind(this),
        1000
      );
    },
  },
  computed: {
    dragOptions() {
      return {
        animation: 200,
        group: "description",
        disabled: false,
        ghostClass: "ghost",
      };
    },
  },
};
</script>

<style lang="scss" scoped>
.sortable-list {
  margin: 10px 0 50px 0;
  .sortable-list-group {
    margin: 0;
    padding: 0;
    span {
      .sortable-list-item:first-child {
        border-top-left-radius: 0.25rem;
        border-top-right-radius: 0.25rem;
      }
      .sortable-list-item:last-child {
        margin-bottom: 0;
        border-bottom-right-radius: 0.25rem;
        border-bottom-left-radius: 0.25rem;
      }
      .sortable-list-item {
        position: relative;
        display: block;
        padding: 0.75rem 1.25rem;
        margin-bottom: -1px;
        background-color: #fff;
        border: 1px solid rgba(0, 0, 0, 0.125);
        cursor: pointer;
        i {
          vertical-align: top;
        }
        img {
          height: 100px;
          width: 100px;
          object-fit: cover;
          object-position: 50% 50%;
        }
        span {
          vertical-align: top;
          margin-left: 10px;
          font-weight: 500;
        }
      }
      .ghost {
        opacity: 0.3;
        background: var(--md-theme-default-primary);
      }
    }
  }
}

.alert {
  padding: 6px 10px;
  text-shadow: 0 1px 0 rgba(255, 255, 255, 0.5);
  border: 1px solid #fbeed5;
  -webkit-border-radius: 4px;
  -moz-border-radius: 4px;
  border-radius: 4px;
  width: 100%;
}

.alert-success {
  background-color: #dff0d8;
  border-color: #d6e9c6;
  color: #468847;
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.5s;
}
.fade-enter,
.fade-leave-to {
  opacity: 0;
  transition: opacity 3s;
}
</style>