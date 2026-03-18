<template>
  <div>
    <md-empty-state v-if="alert.show"
      class="md-alert"
      :class="alert.class"
      :md-icon="alert.icon"
      :md-label="alert.title"
      :md-description="alert.message">
    </md-empty-state>
    <form v-if="show.form" id="form-save-category" class="md-layout" @submit.prevent="save()">
      <md-card-content class="md-layout md-form-category">
        <div class="md-layout-item md-small-size-100">
          <div class="md-layout-item md-small-size-100">
            <md-field :class="{'md-invalid': form.validation.category.hasError}">
              <label for="name">Category Name</label>
              <md-input name="category" id="category" maxlength="50" v-model="form.field.category"></md-input>
              <span class="md-error">{{form.validation.category.messageError}}</span>
            </md-field>
            <md-checkbox id="cb-is-subcategory" name="isSubcategory" v-model="form.field.isSubcategory" 
            @change="selectIsSubcategory" value="1" class="md-validator" :class="{'md-checked' : form.field.isSubcategory}">Is Subcategory?</md-checkbox>
            <md-field v-if="form.field.isSubcategory" 
            :class="{'md-invalid': form.validation.subcategory.hasError}">
              <label>Type to search the parent category...</label>
              <md-input id="input-search-category" name="q" v-model="form.field.q" class="md-input-button" @keyup.enter="searchCategory"></md-input>
              <md-button class="md-dense md-raised md-primary" @click="searchCategory">
              Search</md-button>
              <span class="md-error">{{form.validation.subcategory.messageError}}</span>
            </md-field>



            <div v-if="form.field.q && form.field.isSubcategory && categories && categories.length > 0" 
                class="md-form-category-subcategories"
               :class="{'md-form-category-subcategories-not-selected': form.validation.subcategory.hasError}">
              <h3>Select the parent category: </h3>
              <div class="md-layout-item md-small-size-100">
                <template v-for="category in categories">
                  <div class="md-layout-item">
                    <md-radio name="subcategory"
                    id="subcategory"
                    v-model="form.field.subcategory"
                    :value="category.id" :class="{'md-checked' : category.id == form.field.subcategory}">
                    {{ category.name }}
                    </md-radio>                                   
                  </div>
                </template>
              </div>
            </div>


            <div v-if="Object.keys(this.linkedprograms).length > 0" 
                class="md-form-category-subcategories"
               :class="{'md-form-category-subcategories-not-selected': form.validation.subcategory.hasError}">
              <h3>Select the program:  <i class="far fa-question-circle"></i>
                    <md-tooltip>This category will only be editable by the administrators in your selected program</md-tooltip>
              </h3>
              
              <div class="md-layout-item md-small-size-100">
                <template v-for="(programName, index) in this.linkedprograms">
                  <div class="md-layout-item">
                    <md-radio name="programid"
                    id="programid"
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
        </div>
      </md-card-content>
    </form>
    <md-dialog-actions>
      <md-button class="md-primary" @click="props.closeModal()">Close</md-button>
      <md-button v-if="show.btnSave" class="md-primary" @click="save()">Save</md-button>
      <md-button v-else-if="show.btnNewCategory" class="md-primary" @click="addNew()">ADD NEW</md-button>
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
        message: null
      },
      categories: null,
      show: {
        btnNewCategory: false,
        btnSave: true,
        form: true,
      },
      form: {
        field: {
          category: '',
          subcategory: '',
          isSubcategory: 0,
          q: '',
          admin_program_id: null
        },
        validation: {
          category: {
            hasError: false,
            messageError: null
          },
          subcategory: {
            hasError: false,
            messageError: null
          },
        }
      }
    }),
    created() {
      if(this.props.editId) {
        this.populate(this.props.editId)
      } else if (Object.keys(this.linkedprograms).length == 1) {
        this.form.field.admin_program_id = Number(Object.keys(this.linkedprograms)[0]);
      } else {
        // do nothing
      }
    },
    methods: {
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
      clearAll () {
        this.clearAlert()
        this.clearShow()
        this.clearForm()
        this.categories = null
      },
      clearShow() {
        this.$data.show = this.$options.data.call(this).show
      },
      clearForm () {
        this.$data.form = this.$options.data.call(this).form
      },
      clearFormValidation () {
        this.$data.form.validation = this.$options.data.call(this).form.validation
      },
      clearAlert() {
        this.$data.alert = this.$options.data.call(this).alert
      },
      addNew() {
        this.clearAll()
      },
      save () {
        let formData = new FormData()
        formData.append('category', this.form.field.category)
        formData.append('isSubcategory', this.form.field.isSubcategory ? 1 : 0)
        formData.append('subcategory', this.form.field.subcategory ? this.form.field.subcategory : "")
        formData.append('editId', this.props.editId ? this.props.editId : "")
        formData.append('programId', this.form.field.admin_program_id)
        this.$http.post(
          '/manage/categories/save', 
          formData,
          { 
            headers: { 'X-CSRF-TOKEN': document.querySelector('meta[name="csrf-token"]').getAttribute('content')}, 
            responseType: 'json',
            before: function() { this.clearFormValidation() }
        })
        .then(response => {
          this.clearAll()
          this.showAlert('Category save with success!', 'Click to new category to add new one or in close to back the category list.', 'success')
          this.show.btnNewCategory = true
          this.show.btnSave = false
          this.show.form = false
        }, response => {
          if(typeof(response.body.errors) !== "undefined"){
            let errors = response.body.errors
            if(errors) {
              for (const item in errors) {
                if(item && errors[item].length > 0) {
                  let eleName = item
                  let errorMsg = errors[item][0]
                  if(this.form.validation[eleName]) {
                    this.form.validation[eleName].hasError = true
                    this.form.validation[eleName].messageError = errorMsg  
                  }
                }
              }
            }
          }
        });
      },
      searchCategory: function (selectedSubcategoryId) {
        this.$http.post('/manage/categories/search', 
          {'q': this.form.field.q, 'limitq':this.form.field.q, 'ignoreId': this.props.editId ? this.props.editId : ""}, 
          { 
            headers: { 'X-CSRF-TOKEN': document.head.querySelector("[name=csrf-token]").content}, 
            responseType: 'json',
            before: function() { 
              this.clearFormValidation() 
              this.categories = null
            }
        })
        .then(response => {
          if(response.body.length > 0) {
            this.categories = response.body  
            if(selectedSubcategoryId) {
              this.form.field.subcategory = selectedSubcategoryId
            }
          } else {
            this.form.validation.subcategory.hasError = true
            this.form.validation.subcategory.messageError = "Category not found!"  
          }
        }, response => {
        });
      },
      selectIsSubcategory: function(isSubcategory) {
        this.form.field.isSubcategory = isSubcategory
        if(!isSubcategory) {
          this.form.field.q = null
          this.form.field.subcategory = null
        }
      },
      populate: function(editId) {
        this.$http.post('/manage/categories/search', 
          {'id': editId}, 
          { 
            headers: { 'X-CSRF-TOKEN': document.head.querySelector("[name=csrf-token]").content}, 
            responseType: 'json',
        })
        .then(response => {
          var categoryData = response.body
          if(categoryData) {
            this.form.field.category = categoryData.name
            this.form.field.admin_program_id = categoryData.admin_program_id
            var subcategoriesName = categoryData.name_path.split("/").filter((el) => {return el != ''})
            var subcategoriesId = categoryData.id_path.split("/").filter((el) => {return el != ''})
            if(subcategoriesName.length >= 2) {
              this.form.field.q = subcategoriesName[subcategoriesName.length - 2]
              this.selectIsSubcategory(true)
              this.searchCategory(subcategoriesId[subcategoriesId.length - 2])
            }
          }
        });
      }
    }
  }
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