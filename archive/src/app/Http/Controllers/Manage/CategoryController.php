<?php

namespace App\Http\Controllers\Manage;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Pagination\Paginator;
use Illuminate\Validation\Rule;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;
use App\Http\Controllers\Controller;
use App\Category;
use Illuminate\Support\Facades\Auth;
use App\User;
use App\Admin_program;
use App\Deleted_image_or_category;
use Carbon\Carbon;
use Config; 

class CategoryController extends Controller
{
    const CATEGORY_NAME_REGEX = '/^[\-\w]+(?: [\-\w]+)*$/';  // Only number, letter, single whitesapce, \'-\' and \'_\' are allowed

    public function index(Request $request)
    {
        
        Paginator::defaultView('manage.pagination');

        $searchText         = $request->get('q', null);
        $showing            = $request->get('showing', 10);
        $sorting            = $request->get('sorting', null);
        $qid                = $request->get('qid', null);
        $defaultSort        = 'ID';
        $currentCategory    = null;
        $breadCrumb         = ['Home' => '/', 'Categories' => ''];
        $tableTitle         = 'Categories';
        $tableDescription   = 'List of the categories';
        $showing            = $showing > 100 ? 100 : $showing;
        $category           = new Category();
        
        if( $qid ) { // if category id is provided then update breadCrumb list
            $currentCategory = Category::find($qid);

            if($currentCategory) {
                Log::info("Category found with query category id " . $qid);
                $tableTitle                 = 'Subcategories of the ' . $currentCategory->name;
                $tableDescription           = 'List of the subcategories of the category "' . $currentCategory->name . '"';
                $breadCrumb['Categories']   = route('category-list');
                $categoriesName             = array_filter(explode("/", $currentCategory->name_path));
                $categoriesId               = array_filter(explode("/", $currentCategory->id_path));

                foreach($categoriesName as $key => $val) {

                    if($key == count($categoriesName)) {

                        $breadCrumb[$val] = '';

                    } else {

                        $breadCrumb[$val] = route('category-list',  ['qid' => $categoriesId[$key]]);

                    }

                }

            }
        }        

        $current_user = Auth::user();
        $linked_admin_programs = User::get_linked_admin_programs($current_user);

        return view('manage.category.list', [
                'categories' => $category->getManageQueryList($current_user, array_keys($linked_admin_programs), $qid, $searchText, $sorting)->paginate($showing), 
                'currentCategory' => $currentCategory,
                'breadCrumb' =>  $breadCrumb, 
                'tableTitle' => $tableTitle, 
                'tableDescription' => $tableDescription,
                'linkedAdminPrograms' => $linked_admin_programs
            ]);

    }

    public function save(Request $request)
    {        
        Log::notice("==================== CategoryController save() function Start ====================");
        $validateField = [
            'category'      => 'required|unique:categories,name|max:50|min:3|regex:'. self::CATEGORY_NAME_REGEX, 
            'isSubcategory' => 'required|boolean',
            'subcategory'   => 'sometimes|required_if:isSubcategory,1|nullable|exists:categories,id',
            'programId'     => 'required|integer|exists:admin_programs,id'
        ];

        $validateMessages = [
            'required_if'   => 'The :attribute field is required. Search by the category above and select below one of the categories found  to be continue.',
            'regex'         => 'Only number, letter, single whitesapce, \'-\' and \'_\' are allowed.',
        ];

        $editId = $request->get('editId', null);
        $categorySelected = null;

        if($editId) {
            Log::info("Editing category with Category ID [" . $editId . "]");
            $validateField['category'] = 'required|max:50|min:3|regex:'. self::CATEGORY_NAME_REGEX;
            $categorySelected = Category::find($editId);
        }

        $validatedData = $request->validate($validateField, $validateMessages);

        if($validatedData) {
            $isSubcategory  = $request->get('isSubcategory', null);
            $subcategoryId  = $request->get('subcategory', null);
            $programId = $request->get('programId', null);
            
            $category               = $categorySelected ?? new Category();
            $categoryOld            = clone($category);

            $category->name         = $request->get('category');

            $category->slug         = Str::slug($category->name."-".Str::orderedUuid(), "-");

            // Log::info("CategoryController save() - Start Saving the Category [" . $category->name . "] with Category ID [" . $category->id . "]");
            Log::info("CategoryController save() - Start Saving the Category [" . $category->name . "] with Category ID [" . $category->id . "]", ['name' => $category->name, 'id' => $category->id, 'file' => __FILE__ , 'line' => __LINE__]);

            if($categorySelected == null) {
                $category->status_id = 1; 
            } 
            $category->admin_program_id = $programId;

            if($isSubcategory && $subcategoryId) {

                $subcategory = Category::find($subcategoryId);
                if(strpos($subcategory->id_path, $this->escapeToDataBase($category->id)) !== false) {
                    return response()->json(['errors' => ['subcategory' => ['Action not allowed!']]], 422);
                }

                $category->id_path      = $subcategory->id_path;
                if($subcategory->status_id == 2){ // if the parent category is already disabled then set the new sub category to disable
                    $category->status_id = 2;
                }
                $category->name_path    = $this->escapeToDataBase($subcategory->name_path . $category->name, true);
                $category->slug_path    = $this->escapeToDataBase($subcategory->slug_path . $category->slug, true);

            } else {

                $category->id_path      = '/';
                $category->name_path    = $this->escapeToDataBase($category->name);
                $category->slug_path    = $this->escapeToDataBase($category->slug);

            }           

            $category->save();
            $category->id_path .=  $this->escapeToDataBase($category->id, true);
            $category->save();

            $this->updateCategories($categoryOld, $category);
            Log::notice("CategoryController save() - Success saved the Category [" . $category->name . "] with Category ID [" . $category->id . "]", ['name' => $category->name, 'id' => $category->id, 'file' => __FILE__ , 'line' => __LINE__]);
            Log::notice("==================== CategoryController save() function End ====================");
            return response()->json('{"success": "true"}');

        } else {
            Log::error("CategoryController save() - Failed to validate data for category", ['file' => __FILE__ , 'line' => __LINE__]);
            Log::notice("==================== CategoryController save() function End - ERROR ====================");
            return response()->json($validatedData->errors());
        }

    }

    public function delete(Request $request)
    {
        Log::notice("==================== CategoryController delete() function Start ====================", ['file' => __FILE__ , 'line' => __LINE__]);

        $categoryId = $request->get('itemID');
        $category = Category::find($categoryId);

        if (!$category) {
            Log::info('CategoryController delete() function - Category ID [' . $categoryId . '] record doesn\'t exist', ['id' => $categoryId, 'file' => __FILE__ , 'line' => __LINE__]);
            Log::notice("==================== CategoryController delete() function Aborted ====================", ['file' => __FILE__ , 'line' => __LINE__]);
            abort(404);
        }
        try {
            Log::info('CategoryController delete() function - Category ID [' . $categoryId . '] record found. Checking if the category is empty', ['id' => $categoryId, 'file' => __FILE__ , 'line' => __LINE__]);
            if($category->category_is_not_empty_check($categoryId))
            {    
                // Abort if the category is not empty
                Log::warning("CategoryController delete() - Category [" . $$category->name . "] is not empty. Aborted", ['name' => $category->name, 'file' => __FILE__ , 'line' => __LINE__]);
                Log::notice("==================== CategoryController delete() function Aborted ====================", ['file' => __FILE__ , 'line' => __LINE__]);
                abort(404);
            }
            Log::info('CategoryController delete() - Category [' . $category->name . '] is empty. Deleting the category', ['name' => $category->name, 'file' => __FILE__ , 'line' => __LINE__]);

            // delete the category and return
            $current_user = Auth::user();
            $deleted_record = Deleted_image_or_category::create([
                'type'              => config('constants.category_label'), 
                'username'          => $current_user->username, 
                'user_display_name' => $current_user->name, 
                'item_name'         => $category->name,
                'deleted_at'        => Carbon::now(),// 'Carbon::now()' application time  //'DB::raw('now()')' database time  
                'user_data'         => $current_user->toJson(),
                'item_data'         => $category->toJson(),
                ]);
            $deleted_record->admin_program_id = $category->admin_program_id;
            $deleted_record->admin_program_display_name = Admin_program::find($category->admin_program_id)->display_name;
            $deleted_record->save();
            Log::notice("CategoryController delete() function - End deleting category [" . $category->name . "]" . " with Category ID [" . $categoryId . "]", ['name' => $category->name, 'id' => $categoryId, 'file' => __FILE__ , 'line' => __LINE__]);
            Log::notice("==================== CategoryController delete() function Finished ====================", ['file' => __FILE__ , 'line' => __LINE__]);
            return json_encode(['result' => $category->delete()]);
        } catch (Exception $e) {
            Log::error('CategoryController delete() - Error deleting category [' . $category->name . '] ' . 'with Category ID [' . $categoryId . '] with exception: ' . $e->getMessage() . "Aborted", ['name' => $category->name, 'id' => $categoryId, 'file' => __FILE__ , 'line' => __LINE__]);
            Log::notice("==================== CategoryController delete() function ERROR ====================", ['file' => __FILE__ , 'line' => __LINE__]);
            abort(404);            
        }
    }
    
    public function hide(Request $request)
    {   
        Log::notice("==================== CategoryController hide() function Start ====================", ['file' => __FILE__ , 'line' => __LINE__]);
        $categoryId = $request->get('itemID');
        $category = Category::find($categoryId);

        if (!$category) {
            Log::warning("No category found to hide category [" . $category->name . "] with Category ID [" . $categoryId . "]. Abort", ['name' => $category->name, 'id' => $categoryId, 'file' => __FILE__ , 'line' => __LINE__]);
            Log::notice("==================== CategoryController hide() function Aborted ====================", ['file' => __FILE__ , 'line' => __LINE__]);
            abort(404);
        }

        try {
            Log::info('Hiding category [' . $category->name . '] with Category ID [' . $category->id . ']', ['name' => $category->name, 'id' => $category->id, 'file' => __FILE__ , 'line' => __LINE__]);
            $category->toggle_images_availability_under_category($category->id, $category->status_id);
            $category->toggle_all_subcategory($category->id_path, $category->status_id);
            Log::notice('CategoryController hide() - Done hiding category [' . $category->name . ']  with Category ID [' . $category->id . ']', ['name' => $category->name, 'id' => $category->id, 'file' => __FILE__ , 'line' => __LINE__]);
            Log::notice("==================== CategoryController hide() function Finished ====================", ['file' => __FILE__ , 'line' => __LINE__]);
            return json_encode(['result' => $category->toggle_category_availability($category)]);    
        } catch (Exception $e) {
            Log::error('Failed to hide category [' . $category->name . ']  with Category ID [' . $category->id . '] with exception' . $e->getMessage(), ['name' => $category->name, 'id' => $category->id, 'file' => __FILE__ , 'line' => __LINE__]);
            Log::notice("==================== CategoryController hide() function ERROR ====================", ['file' => __FILE__ , 'line' => __LINE__]);
            abort(404);
        }
    }

    public function show(Request $request)
    {   
        Log::notice("==================== CategoryController show() function Start ====================", ['file' => __FILE__ , 'line' => __LINE__]);
        $categoryId = $request->get('itemID');
        $category = Category::find($categoryId);

        if (!$category) {
            Log::warning("No category found to show category [" . $category->name . "]  with Category ID [" . $categoryId . "]. Abort", ['name' => $category->name, 'id' => $categoryId, 'file' => __FILE__ , 'line' => __LINE__]);
            Log::notice("==================== CategoryController show() function Aborted ====================", ['file' => __FILE__ , 'line' => __LINE__]);
            abort(404);
        }

        try {
            Log::info("Showing category [" . $category->name . "] with Category ID [" . $category->id . "]", ['name' => $category->name, 'id' => $category->id, 'file' => __FILE__ , 'line' => __LINE__]);
            $category->toggle_images_availability_under_category($category->id, $category->status_id);
            $category->toggle_all_subcategory($category->id_path, $category->status_id);
            Log::notice("CategoryController show() - Done showing category [" . $category->name . "] with Category ID [" . $category->id . "]", ['name' => $category->name, 'id' => $category->id, 'file' => __FILE__ , 'line' => __LINE__]);
            Log::notice("==================== CategoryController show() function Finished ====================", ['file' => __FILE__ , 'line' => __LINE__]);
            return json_encode(['result' => $category->toggle_category_availability($category)]);    
        } catch (Exception $e) {
            Log::error('Failed to show category [' . $category->name . '] with Category ID [' . $category->id . '] with exception' . $e->getMessage(), ['name' => $category->name, 'id' => $category->id, 'file' => __FILE__ , 'line' => __LINE__]);
            Log::notice("==================== CategoryController show() function Aborted ====================", ['file' => __FILE__ , 'line' => __LINE__]);
            abort(404);
        }
    }

    private function updateCategories($categoryOld, $categoryNew) 
    {
        Log::notice("==================== CategoryController updateCategories() Start ====================", ['file' => __FILE__ , 'line' => __LINE__]);

        $updateCategories = 
            Category::where('id_path', 'like', "%/" . $categoryNew->id . "/%")
                ->where('id', '!=', $categoryNew->id)
                ->get();

        if($updateCategories) {

            Log::info("CategoryController updateCategories() function started - Updating categories [" . $categoryNew->name . "] with Category ID [" . $categoryNew->id . "]", ['name' => $categoryNew->name, 'id' => $categoryNew->id, 'file' => __FILE__ , 'line' => __LINE__]);

            foreach ($updateCategories as $item) {

                $item->id_path   = str_replace($categoryOld->id_path, $categoryNew->id_path, $item->id_path);
                $item->name_path = str_replace($categoryOld->name_path, $categoryNew->name_path, $item->name_path);
                $item->slug_path = str_replace($categoryOld->slug_path, $categoryNew->slug_path, $item->slug_path);
                $item->save();

            }

            Log::notice("CategoryController updateCategories() function finished - Successfully updated categories [" . $categoryNew->name . "] with Category ID [" . $categoryNew->id . "]", ['name' => $categoryNew->name, 'id' => $categoryNew->id, 'file' => __FILE__ , 'line' => __LINE__]);

        }else{
            Log::error("CategoryController updateCategories() function ERROR - Categories [" . $categoryNew->name . "] with Category ID [" . $categoryNew->id . "] not found.", ['name' => $categoryNew->name, 'id' => $categoryNew->id, 'file' => __FILE__ , 'line' => __LINE__]);
        }

        Log::notice("==================== CategoryController updateCategories() Finished ====================", ['file' => __FILE__ , 'line' => __LINE__]);
    }

    public function search(Request $request)
    {
        Log::info("==================== CategoryController search() Start ====================", ['file' => __FILE__ , 'line' => __LINE__]);
        $q          = $request->get('q', []);
        $limitq     = $request->get('limitq', null);
        $id         = $request->get('id', null);
        $ignoreId   = $request->get('ignoreId', null);

        $categories = Category::query();

        if($q) {
            Log::info("Searching category with query: $q", ['file' => __FILE__ , 'line' => __LINE__]);
            $validatedData_q = $request->validate(
                [
                    'q'     => 'min:1|max:50|regex:'. self::CATEGORY_NAME_REGEX,  
                ],
                [
                    'min'   => 'The search name may not be smaller than :min.',
                    'max'   => 'The search name may not be greater than :max.',
                    'regex' => 'Only number, letter, single whitesapce, \'-\' and \'_\' are allowed.',
                ]);

            if( ! $validatedData_q) {
                Log::warning("Failed to validate data for category search with query: $q", ['file' => __FILE__ , 'line' => __LINE__]);
                Log::warning("==================== CategoryController search() function - Invalid Query ====================", ['file' => __FILE__ , 'line' => __LINE__]);
                return response()->json([]);
            }

            $linked_admin_programs_ids = array_keys(User::get_linked_admin_programs(Auth::user()));
            $categories = $categories
                ->select('categories.id', 'categories.admin_program_id')
                ->selectRaw("
                    CASE WHEN categories.status_id = 2 
                    THEN CONCAT('".config('constants.disabled_label')."', categories.name)
                    ELSE categories.name
                    END AS name")// append config('constants.disable_label') to disabled categories name 
                ->leftJoin('admin_programs', 'admin_programs.id', '=', 'categories.admin_program_id')
                ->whereIn('categories.admin_program_id', $linked_admin_programs_ids)
                ->where('categories.name', 'like', "%" . $q . "%")
                ->where('categories.admin_status_id', 1)
                ->where(function($query) {
                    $query->where('categories.status_id', 1) // // Enable
                          ->orWhere('categories.status_id', 2) // // Disable
                          ->orWhere('categories.status_id', 4); // // Processing
                });

            if($limitq) {
                // limit search to maximum two level deep categories
                Log::info("Limiting search to maximum two level deep categories with query: $q", ['file' => __FILE__ , 'line' => __LINE__]);
                $categories = $categories->where('categories.id_path', 'REGEXP', "^(\/[0-9]+){1,2}\/$");
            }

            if($ignoreId) {
                Log::info("Ignoring category with ID [" . $ignoreId . "] with query: $q", ['file' => __FILE__ , 'line' => __LINE__]);
                $categories = $categories->where('categories.id_path', 'not like', "%/" . $ignoreId . "/%");
            }

            Log::info("Ordering categories found by names");
            $categories = $categories->orderBy('name')->get();

            Log::info("Found " . $categories->count() . " categories with query: $q", ['file' => __FILE__ , 'line' => __LINE__]);

        } else if($id) {
            Log::info('No query found, searching with Category ID [' . $id . ']', ['file' => __FILE__ , 'line' => __LINE__]);
            $categories = $categories->where('categories.id', $id)->first();
            Log::info('Found ' . $categories->count() . ' categories with Category ID [' . $id . ']' , ['file' => __FILE__ , 'line' => __LINE__]);
        }

        Log::info("==================== CategoryController search() Finished ====================", ['file' => __FILE__ , 'line' => __LINE__]);
        
        return response()->json($categories);

    }

    private function escapeToDataBase($field, $partial = false) 
    {
        Log::info("CategoryController escapeToDataBase()", ['file' => __FILE__ , 'line' => __LINE__]);
        return ($partial ? "" : "/") . $field . "/";

    }
}
