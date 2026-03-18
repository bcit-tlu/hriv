<template>
  <div>
    <div class="md-layout">
        <div class="md-field md-theme-default md-clearable md-has-placeholder">
            <input v-model="searchText" type="text" placeholder="Search for Categories or Images ..." class="md-input md-input-button" @keyup.enter="search">
            <md-button class="md-dense md-raised md-primary" @click="search">Search</md-button>
        </div>
        <div class="md-layout-item" 
        v-for="(item,index) in items" 
        :key="index">
            <md-card v-if="item.type == 'category'" md-with-hover>
                <a :href="item.url" :title="item.name">
                    <md-card-area md-inset>
                        <md-card-header>
                            <md-avatar class="md-avatar-icon">
                              <md-icon>folder</md-icon>
                            </md-avatar>
                            <div class="md-title md-title-avatar">Category</div>
                        </md-card-header>
                        <md-card-header>
                            <div class="md-title">
                               <h1 v-if="item.status_id == 2" class="md-display-1">{{ "(Disabled) " + item.name}}</h1>
                               <h1 v-else class="md-display-1">{{item.name}}</h1>
                            </div>
                        </md-card-header>
                        <md-card-content>
                            <span class="md-title-span">Items: {{item.categories_count + item.images_count}}
                            </span>
                            <br>
                            <span v-bind:style="{color: 'gray'}" class="md-title-span" >Program: {{item.admin_program_display_name}}
                            </span>
                        </md-card-content>
                    </md-card-area>
                </a>
            </md-card>
            <md-card v-else-if="item.type == 'image'" md-with-hover>
                <a :href="item.url" :title="item.name">
                  <md-card-media>
                    <img :src="item.image_url" :alt="item.name">
                  </md-card-media>
                  <md-card-content>
                    <span v-if="item.status_id == 2" class="md-title-span">{{ "(Disabled) " + item.name}} </span>
                    <span v-else class="md-title-span">{{item.name}} </span>
                    <br>
                    <span v-bind:style="{color: 'gray'}" class="md-title-span" >Program: {{item.admin_program_display_name}}
                    </span>
                  </md-card-content>
                </a>
              </md-card>
        </div>
    </div>
    <div class="category-pagination">
      <slot name="tablepagination" :pageShowing="pageShowing" :showing="showing"></slot>
    </div>
  </div>
</template>

<script>
export default {
  props: ["items"],
  data: function() {
    return {
      url: null,
      queryString: null,
      pageShowing: "10"
    };
  },
  created() {
    this.url = new URL(window.location);
    this.queryString = new URLSearchParams(this.url.search);
    this.searchText = this.queryString.get("q");
    if (this.queryString.get("showing") !== null) {
      this.pageShowing = this.queryString.get("showing");
    }
  },
  methods: {
    search: function(event) {
        if(this.searchText !== '') {
            this.queryString.set('q', this.searchText)    
        } else {
            this.queryString.delete('q')    
        }
        this.queryString.delete('page')
        this.url.search = this.queryString.toString()
        window.location = this.url.toString()
    },
    showing: function(val) {
      if (val !== this.pageShowing) {
        this.queryString.set("showing", val);
      } else {
        this.queryString.delete("showing");
      }
      this.queryString.delete("page");
      this.url.search = this.queryString.toString();
      window.location = this.url.toString();
    }
  }
};
</script>

<style lang="scss" scoped>
.md-layout {
    width: 100%;
    display: block;
    .md-no-result {
        margin-top: 20%;
    }
    .md-field {
        margin: 0 auto 20px auto;
        width: 95%;
        .md-input {
            width: 100%;
        }
    }
    .md-layout-item {
        width: 20%;
        height: 320px;
        display: inline-block;
        margin: 0;
        padding: 10px;
        .md-card {
            width: 100%;
            height: 100%;
            float: left;
            overflow: hidden;
            margin: 0;
            a {
                text-decoration: none;
                height: 100%;
                width: 100%;
                position:absolute;
            }
            .md-card-media {
                height: 230px;
                overflow: hidden;
                img {
                    width: 100%;
                    height: 100%;
                    object-fit: cover;
                    object-position: 50% 50%;
                }
            }
            .md-card-area {
                height: 100%;
                .md-card-header {
                    .md-avatar {
                        background-color: var(--md-theme-default-primary-on-background, #e57373);
                    }
                    .md-title {
                        margin-top: 8px;
                        overflow: hidden;
                        .md-display-1 {
                            margin: 0;
                            font-size: 1em;
                            line-height: 1.5em;
                            color: var(--md-theme-default-primary-on-background, #e57373);
                        }
                    }
                }
                .md-card-content {
                    position: absolute;
                    bottom: 0;
                    width: 100%;
                    .md-title-span {
                        font-weight: 500;
                    }
                    .md-alignment-right {
                        text-align: right;
                        float: right;
                    }
                }
            }
        }
    }
}

@media screen and (max-width: 1600px) {
    .md-layout {
        .md-layout-item {
            width: 25%;
        }
    }
}

@media screen and (max-width: 1200px) {
    .md-layout {
        .md-layout-item {
            width: 33.3%;
        }
    }
}

@media screen and (max-width: 767px) {
    .md-layout {
        .md-layout-item {
            width: 50%;
        }
    }
}

@media screen and (max-width: 479px) {
    .md-layout {
        .md-layout-item {
            width: 100%;
        }
        .md-no-result {
            width: 290px !important;
            height: 290px !important;
        }
    }
}

.category-pagination {
  margin: 1em 0;
  display: flex;
  justify-content: center;
  flex-flow: column;

  .showing {
    margin: 0.4em auto;
    align-self: center;

    .md-field {
      width: 48px;
      min-height: 1em;
      display: inline-block;
      margin: 0 0 0 2em;
    }
  }

  .pagination {
    margin: 0.4em auto;
    padding: 0px;
    align-self: center;

    li {
      list-style: none;
      float: left;
      padding: 0;
      margin: 0 0.5em;

      &:not(.active):hover {
        box-shadow: 0 3px 1px -2px rgba(0, 0, 0, 0.2),
          0 2px 2px 0 rgba(0, 0, 0, 0.14), 0 1px 5px 0 rgba(0, 0, 0, 0.12);
      }

      & > a {
        display: block;
        height: inherit;
        min-width: 2em;
        line-height: 40px;
        text-align: center;
      }

      & > span {
        display: block;
        height: inherit;
        min-width: 2em;
        line-height: 40px;
        text-align: center;
      }
    }
  }
}
</style>