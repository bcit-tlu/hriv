<?php

namespace App;

use Config;
use Illuminate\Database\Eloquent\Model;
use App\Image;
use DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Auth;
use App\User;
use App\Admin_program;

class Category extends Model
{
    protected $fillable = [
        'status_id', 'name', 'id_path'
    ];

    /**
     * Get all of the posts for the user.
     */
    public function image()
    {
        return $this->hasMany('App\Image');
    }

    public function status()
    {
        return $this->belongsTo('App\Status', 'status_id', 'id');
    }

    public function admin_status()
    {
        return $this->belongsTo('App\Status', 'admin_status_id', 'id');
    }

    public function admin_program()
    {
        return $this->belongsTo(Admin_program::class, 'admin_program_id', 'id');
    }

    public function getListAll($slug = null, $q = null) {

        $imageRoute = route('image-detail');
        $slug = $slug ? "/$slug/" : $slug;

        //***** SQL - default home page categories list *****/

        //     select  
        //     JCI.id,
        //    JCI.name,
        //    0 as `order`, 
        //    JCI.admin_program_id,
        //    JCI.slug_path as url,
        //    "category" as type, 
        //    "" as image_url,
        //    Count(C.id) as categories_count,
        //    JCI.images_count    
        
        //    from  categories  as C
        //    right join (
        //        select  JC.*, COUNT(I.id) as images_count
        //        from  categories  as JC
        //        left join images as I
        //            on JC.id=I.category_id
        //        where JC.id_path REGEXP '^\/[0-9]+\/$'
        //        and ((JC.status_id = 1 And I.status_id = 1) or (JC.status_id=1 and I.status_id is NULL))
        //        group by JC.id
        //      ) as JCI
        //    on C.id_path =  CONCAT(JCI.id_path, C.id, "/")      
        //    group by JCI.id
        //    order by JCI.id


        //*****  SQL - single category folder *****/ // e.g. folder slug is 'ttest'

        //    select  
        //    JCI.id,
        //    JCI.name,
        //    0 as `order`, 
        //    JCI.admin_program_id,
        //    JCI.slug_path as url,
        //    "category" as type, 
        //    "" as image_url,
        //    Count(C.id) as categories_count,
        //    JCI.images_count    
        
        //    from  categories  as C
        //    right join (
        //        select  JC.*,  COUNT(I.id)  as images_count
		// 		  from  (SELECT * from categories where categories.slug_path REGEXP CONCAT('.*\/','ttest', '\/[a-zA-Z0-9]+\/$'))  as JC
		// 		  left join images as I
		// 			on JC.id=I.category_id
		// 		  where (JC.status_id=1 and I.status_id=1) or (JC.status_id=1 and I.status_id is NULL)
        //           group by JC.id
    
        //      ) as JCI
        //    on C.id_path =  CONCAT(JCI.id_path, C.id, "/")      
        //    group by JCI.id
        //    order by JCI.id


        //***** SQL - search category folders by part of name *****/ // e.g. folder name is 'ttest'

        //    select  
        //    JCI.id,
        //    JCI.name,
        //    0 as `order`, 
        //    JCI.admin_program_id,
        //    JCI.slug_path as url,
        //    "category" as type, 
        //    "" as image_url,
        //    Count(C.id) as categories_count,
        //    JCI.images_count    
        
        //    from  categories  as C
        //    right join (
        //        select  JC.*,  COUNT(I.id)  as images_count
		// 		  from  (SELECT * from categories where categories.name LIKE '%ttest%')  as JC
		// 		  left join images as I
		// 			on JC.id=I.category_id
		// 		  where (JC.status_id=1 and I.status_id=1) or (JC.status_id=1 and I.status_id is NULL)
        //           group by JC.id
                  
        //      ) as JCI
        //    on C.id_path =  CONCAT(JCI.id_path, C.id, "/")      
        //    group by JCI.id
        //    order by JCI.id



        $matching_regx='^\/[0-9]+\/$';

        $input1='';
        $input2='';

        $isAdminUser = Auth::user()->isAdmin();

        if($isAdminUser){

            if (!$q && $slug){ // single category folder
                $JCI=Category::selectRaw('JC.*, COUNT(I.id) as images_count')
                    ->from(DB::raw('(SELECT * from categories WHERE (categories.status_id = 1 OR categories.status_id = 2) AND categories.slug_path REGEXP CONCAT(\'.*\',?, \'[a-zA-Z0-9\-\_]+\/$\')) as JC') )  // '?' is the placeholder for the $input
                    ->leftJoin('images as I', 'JC.id', '=', 'I.category_id')
                    ->whereRaw('((JC.status_id = 1 OR JC.status_id = 2) And (I.status_id = 1 OR I.status_id = 2))')
                    ->orWhereRaw(DB::raw('((JC.status_id=1 OR JC.status_id=2) AND I.status_id is NULL)'))
                    ->groupBy('JC.id');
                
                $input1 = $slug;
    
            } elseif ($q){ // search name
                $JCI=Category::selectRaw('JC.*, COUNT(I.id) as images_count')
                    ->from(DB::raw('(SELECT * from categories WHERE (categories.status_id = 1 OR categories.status_id = 2) AND categories.name LIKE ?) as JC') ) // '?' is the placeholder for the $input
                    ->leftJoin('images as I', 'JC.id', '=', 'I.category_id')
                    ->whereRaw('((JC.status_id = 1 OR JC.status_id = 2) And (I.status_id = 1 OR I.status_id = 2))')
                    ->orWhereRaw(DB::raw('((JC.status_id=1 OR JC.status_id=2) AND I.status_id is NULL)'))
                    ->groupBy('JC.id');
    
                $input1 = '%'.$q.'%';
    
            } else { // default home page categories list
                $JCI=Category::selectRaw('JC.*, COUNT(I.id) as images_count')
                    ->from(DB::raw('(SELECT * from categories WHERE categories.status_id = 1 OR categories.status_id = 2) as JC'))
                    ->leftJoin('images as I', 'JC.id', '=', 'I.category_id')
                    ->whereRaw('JC.id_path REGEXP \''. $matching_regx .'\'')
                    ->whereRaw(DB::raw('(((JC.status_id = 1 OR JC.status_id = 2) And (I.status_id = 1 OR I.status_id = 2)) or ((JC.status_id=1 OR JC.status_id=2) AND I.status_id is NULL))'))
                    ->groupBy('JC.id');
            }
    
            $categories=Category::selectRaw('
                  JCI.id,
                  JCI.name,
                  JCI.status_id,
                  0 as `order`,
                  JCI.admin_program_id, 
                  JCI.slug_path as url,
                  "category" as type, 
                  "" as image_url,
                  Count(C.id) as categories_count,
                  JCI.images_count  ')
            ->from(DB::raw('(SELECT * from categories WHERE categories.status_id = 1 OR categories.status_id = 2) as C'))  
            ->rightJoin(DB::raw("({$JCI->toSql()}) as JCI"),  'C.id_path', '=', DB::raw('CONCAT(JCI.id_path, C.id, \'/\')'))
            ->groupBy('JCI.id')
            ->orderBy('JCI.id');


        } else {


            if (!$q && $slug){ // single category folder
                $JCI=Category::selectRaw('JC.*, COUNT(I.id) as images_count')
                    ->from(DB::raw('(SELECT * from categories WHERE categories.status_id = 1 AND categories.slug_path REGEXP CONCAT(\'.*\',?, \'[a-zA-Z0-9\-\_]+\/$\')) as JC') )  // '?' is the placeholder for the $input
                    ->leftJoin('images as I', 'JC.id', '=', 'I.category_id')
                    ->whereRaw('(JC.status_id = 1 And I.status_id = 1)')
                    ->orWhereRaw(DB::raw('(JC.status_id=1 and I.status_id is NULL)'))
                    ->groupBy('JC.id');
                
                $input1 = $slug;
    
            } elseif ($q){ // search name
                $JCI=Category::selectRaw('JC.*, COUNT(I.id) as images_count')
                    ->from(DB::raw('(SELECT * from categories WHERE categories.status_id = 1 AND categories.name LIKE ?) as JC') ) // '?' is the placeholder for the $input
                    ->leftJoin('images as I', 'JC.id', '=', 'I.category_id')
                    ->whereRaw('(JC.status_id = 1 And I.status_id = 1)')
                    ->orWhereRaw(DB::raw('(JC.status_id=1 and I.status_id is NULL)'))
                    ->groupBy('JC.id');
    
                $input1 = '%'.$q.'%';
    
            } else { // default home page categories list
                $JCI=Category::selectRaw('JC.*, COUNT(I.id) as images_count')
                    ->from(DB::raw('(SELECT * from categories WHERE categories.status_id = 1) as JC'))
                    ->leftJoin('images as I', 'JC.id', '=', 'I.category_id')
                    ->whereRaw('JC.id_path REGEXP \''. $matching_regx .'\'')
                    ->whereRaw(DB::raw('((JC.status_id = 1 And I.status_id = 1) or (JC.status_id=1 and I.status_id is NULL))'))
                    ->groupBy('JC.id');
            }
    

            $categories=Category::selectRaw('
                  JCI.id,
                  JCI.name,
                  JCI.status_id,
                  0 as `order`,
                  JCI.admin_program_id, 
                  JCI.slug_path as url,
                  "category" as type, 
                  "" as image_url,
                  Count(C.id) as categories_count,
                  JCI.images_count  ')
            ->from(DB::raw('(SELECT * from categories WHERE categories.status_id = 1) as C'))  
            ->rightJoin(DB::raw("({$JCI->toSql()}) as JCI"),  'C.id_path', '=', DB::raw('CONCAT(JCI.id_path, C.id, \'/\')'))
            ->groupBy('JCI.id')
            ->orderBy('JCI.id');
        }


        // combine category list with image list
        if ($q || $slug) {
            if($isAdminUser){

                if(config('filesystems.enable_aws_storage') == true){
                    $query = 
                    Image::select(
                        'I.id', 
                        'I.name', 
                        'I.status_id',
                        'I.order',
                        'I.admin_program_id')
                    ->selectRaw('CONCAT("' . $imageRoute . '", "/", I.slug) as url')
                    ->selectRaw('"image" as type, CONCAT("' . config('filesystems.cdnroot') . '", I.thumbnail) as image_url')  //  append the cdn access root url
                    ->selectRaw('0 as categories_count, 0 as images_count')
                    ->from('images as I')
                    ->join(DB::raw('(SELECT * from categories WHERE (categories.status_id = 1 OR categories.status_id = 2)) as C'), 'C.id', '=', 'I.category_id')
                    ->whereRaw('(I.status_id = 1 OR I.status_id = 2)')
                    ->union($categories)
                    ->orderBy('type')
                    ->orderBy('order')
                    ->orderBy('name');
                } else {
                    $query = 
                    Image::select(
                        'I.id', 
                        'I.name', 
                        'I.status_id',
                        'I.order',
                        'I.admin_program_id')
                    ->selectRaw('CONCAT("' . $imageRoute . '", "/", I.slug) as url')
                    ->selectRaw('"image" as type, I.thumbnail as image_url')
                    ->selectRaw('0 as categories_count, 0 as images_count')
                    ->from('images as I')
                    ->join(DB::raw('(SELECT * from categories WHERE (categories.status_id = 1 OR categories.status_id = 2)) as C'), 'C.id', '=', 'I.category_id')
                    ->whereRaw('(I.status_id = 1 OR I.status_id = 2)')
                    ->union($categories)
                    ->orderBy('type')
                    ->orderBy('order')
                    ->orderBy('name');
                }


            } else {

                if(config('filesystems.enable_aws_storage') == true){
                    $query = 
                    Image::select(
                        'I.id', 
                        'I.name', 
                        'I.status_id',
                        'I.order',
                        'I.admin_program_id')
                    ->selectRaw('CONCAT("' . $imageRoute . '", "/", I.slug) as url')
                    ->selectRaw('"image" as type, CONCAT("' . config('filesystems.cdnroot') . '", I.thumbnail) as image_url')  //  append the cdn access root url
                    ->selectRaw('0 as categories_count, 0 as images_count')
                    ->from('images as I')
                    ->join(DB::raw('(SELECT * from categories WHERE categories.status_id = 1) as C'), 'C.id', '=', 'I.category_id')
                    ->whereRaw('I.status_id = 1')
                    ->union($categories)
                    ->orderBy('type')
                    ->orderBy('order')
                    ->orderBy('name');
                } else {
                    $query = 
                    Image::select(
                        'I.id', 
                        'I.name', 
                        'I.status_id',
                        'I.order',
                        'I.admin_program_id')
                    ->selectRaw('CONCAT("' . $imageRoute . '", "/", I.slug) as url')
                    ->selectRaw('"image" as type, I.thumbnail as image_url')
                    ->selectRaw('0 as categories_count, 0 as images_count')
                    ->from('images as I')
                    ->join(DB::raw('(SELECT * from categories WHERE categories.status_id = 1) as C'), 'C.id', '=', 'I.category_id')
                    ->whereRaw('I.status_id = 1')
                    ->union($categories)
                    ->orderBy('type')
                    ->orderBy('order')
                    ->orderBy('name');
                }
            }


            if ($q){
                $query->where('I.name', 'LIKE', "%" . $q . "%"); //  toSql() below will turn this into 'I.name LIKE ?'
                $input2 = "%" . $q . "%";
            } else {
                $query->where('C.slug_path', 'LIKE', $slug); //  toSql() below will turn this into 'I.slug_path LIKE ?'
                $input2 = $slug;
            }

            $final_query = Image::query()
                ->selectRaw('RJ.*,
                             admin_programs.display_name AS admin_program_display_name')
                ->fromRaw(DB::raw("({$query->toSql()}) as RJ"))
                ->leftJoin('admin_programs', 'admin_programs.id', '=', 'RJ.admin_program_id')
                ->setBindings([$input1, $input2]); // must include becasue toSql() does not include binding variables; Using ->mergeBindings($JCI->getQuery()) shows err;

        } else {
            $final_query = Image::query()
            ->selectRaw('RJ.*,
                         admin_programs.display_name AS admin_program_display_name')
            ->fromRaw(DB::raw("({$categories->toSql()}) as RJ"))
            ->leftJoin('admin_programs', 'admin_programs.id', '=', 'RJ.admin_program_id')
            ->setBindings([$input1]); // must include becasue toSql() does not include binding variables; Using ->mergeBindings($JCI->getQuery()) shows err;
        }
        
        return $final_query;

    }

    public function getManageQueryList(
            $current_user = null, 
            $linked_admin_programs_ids = null, 
            $qid = false, 
            $searchText = false, 
            $sorting
        ) 
    {

        $field      = null;
        $order      = false;
        $dataField  = false;

        if($sorting) {

            list($field, $order) = array_pad(explode('-', $sorting), 2, 'asc');
            
            // Below swtich is for sorting the manage category list
            switch ($field) {
                case 'ID':
                    $dataField = 'id';
                    break;
                case 'Name':
                    $dataField = 'name';
                    break;
                case 'Path':
                    $dataField = 'name_path';
                    break;
                case 'Modified':
                    $dataField = 'updated_at';
                    break;
                case 'Qty. Items':
                    $dataField = 'count_items';
                    break;
                default:
                    $dataField = 'id';
                    break;
            }
        }

        // get current user linking admin_programs
        if(!$current_user){
            $current_user = Auth::user();
        }
        if(!is_array($linked_admin_programs_ids)){
            $linked_admin_programs_ids = array_keys(User::get_linked_admin_programs($current_user));
        }

        // // Count images under each categories and sub categories
        // // Frontent use `editable` True/False to control show/hide edit,delete,sort,disable buttons
        // select `categories`.*, 
        // `admin_programs`.display_name AS `admin_program_display_name`,
        // `categories`.`admin_program_id` in (1,3) AS `editable`, -- True AS `editable`
        // count(images.id) as count_images 
        // from `categories` 
        // left join `images` on `images`.`category_id` = `categories`.`id` 
        // left join `admin_programs` on `categories`.`admin_program_id` = `admin_programs`.`id` 
        // group by `categories`.`id`;
        
        if(User::isSuperAdmin($current_user)){ // if is super admin then set `editable` for all categoreis to true

            $JCI = Category::select('categories.*')
                    ->selectRaw('admin_programs.display_name AS admin_program_display_name')
                    ->selectRaw('True AS editable')
                    ->selectRaw('count(images.id) AS count_images')
                    ->leftJoin('images', 'images.category_id', '=', 'categories.id')
                    ->leftJoin('admin_programs', 'admin_programs.id', '=', 'categories.admin_program_id')
                    ->groupBy('categories.id');

        }elseif(!empty($linked_admin_programs_ids)){ // if linked admin_programs list is not empty then set `editable` to true for categoreis with foreign key admin_program_id same in the admin_programs list

            $JCI = Category::select('categories.*')
                    ->selectRaw('admin_programs.display_name AS admin_program_display_name')
                    ->selectRaw('categories.admin_program_id in (' . substr(json_encode($linked_admin_programs_ids), 1,-1) . ') as editable')
                    ->selectRaw('count(images.id) AS count_images')
                    ->leftJoin('images', 'images.category_id', '=', 'categories.id')
                    ->leftJoin('admin_programs', 'admin_programs.id', '=', 'categories.admin_program_id')
                    ->groupBy('categories.id');

        }else{ // if linked admin_programs list is empty then set `editable` for all categoreis to false

            $JCI = Category::select('categories.*')
                    ->selectRaw('admin_programs.display_name AS admin_program_display_name')
                    ->selectRaw('False AS editable')
                    ->selectRaw('count(images.id) AS count_images')
                    ->leftJoin('images', 'images.category_id', '=', 'categories.id')
                    ->leftJoin('admin_programs', 'admin_programs.id', '=', 'categories.admin_program_id')
                    ->groupBy('categories.id');

        }
        
        // Count one level down sub categories under each categories
        // Count images + Count sub categories = Count items
        $query=Category::selectRaw('
              JCI.count_images,
              count(categories.id) + JCI.count_images as count_items,
              JCI.*')
              ->rightJoin(DB::raw("({$JCI->toSql()}) as JCI"),  'categories.id_path', '=', DB::raw('CONCAT(JCI.id_path, categories.id, \'/\')'))
              ->groupBy('JCI.id')
              ;

        // limit list with category id
        if( $qid )
            $query->where('JCI.id_path', 'like', "%/" . $qid . "/%");

        // set dispaly categories list order
        if($dataField && $order ) {
            $query->orderBy($dataField, $order);
        } else {
            $query->orderBy('JCI.editable', 'DESC')
            ->orderBy('JCI.id', 'ASC');
        }

        if( $searchText ) {

            // search category with string
            $searchDate = str_replace('/', '-', $searchText);
            $query->where(function($queryin) use ($searchText) {
                $queryin->where('JCI.name', 'like', "%" . $searchText . "%")
                ->orWhere('JCI.name_path', 'like', "%" . $searchText . "%")
                ->orWhere('JCI.id', $searchText);
            });

            // search with datetime
            if (preg_match("/^[2-4][0-9]{3}[\/\-][0-1][0-9][\/\-][0-3][0-9]$/", $searchText)) { // matching 'YYYY/mm/dd' or 'YYYY-mm-dd'

                $date = date('Y-m-d', strtotime(str_replace('/', '-', $searchText)));
                $query->orWhereDate('JCI.updated_at', $date);

            } else if(preg_match("/^[2-4][0-9]{3}[\/\-][0-1][0-9][\/\-][0-3][0-9]\s[0-2][0-9]\:[0-5][0-9]\:[0-5][0-9]$/", $searchText)) { // matching 'YYYY/mm/dd HH:ii:ss' or 'YYYY-mm-dd HH:ii:ss'

                $date = date('Y-m-d H:i:s', strtotime(str_replace('/', '-', $searchText)));
                $query->orWhere('JCI.updated_at', $date);

            } else if(preg_match("/^[0-2][0-9]\:[0-5][0-9]\:[0-5][0-9]$/", $searchText)) { // matching 'HH:ii:ss'

                $time = date('H:i:s', strtotime(str_replace('/', '-', $searchText)));
                $query->orWhereTime('JCI.updated_at', $time);

            }

        }

        $query->where('JCI.admin_status_id', 1); 

        return $query;

    }
    
    public function count_category_total_items($category_id)  
    {
        // Count images under the attempt to delete category
        $JCI = Category::select('categories.*')
                ->selectRaw('count(images.id) as count_images')
                ->where('categories.id', $category_id)
                ->leftJoin('images', 'images.category_id', '=', 'categories.id')
                ->groupBy('categories.id');

        // Count sub categories  under the attempt to delete category
        // Count images + Count sub categories = Count items
        $query=Category::selectRaw('
            JCI.count_images,
            count(categories.id) + JCI.count_images as count_items,
            JCI.*')
            ->rightJoin(DB::raw("({$JCI->toSql()}) as JCI"),  'categories.id_path', '=', DB::raw('CONCAT(JCI.id_path, categories.id, \'/\')'))
            ->groupBy('JCI.id')
            ->setBindings([$category_id]) ;

        return $query;
            
    }

    // We need  to make sure the category is empty before trying to delete
    public function category_is_not_empty_check($category_id) {
        return $this->count_category_total_items($category_id)->first()->count_item != 0;
    }

    public function toggle_images_availability_under_category($categoryId, $categoryStatusId) {

        $status_id = ($categoryStatusId == 1) ? 2 : 1 ;
        
        DB::table('images')
        ->where('category_id', $categoryId)
        ->whereIn('status_id', [1,2]) 
        ->update(['status_id' => $status_id]);
    }

    public function toggle_all_subcategory($categoryIdPath, $categoryStatusId) { // when parent category is disabled, then all the subcategorys should be disabled aswell. Vice versa.

        $status_id = ($categoryStatusId == 1) ? 2 : 1 ;
        
        Category::where('id_path', 'LIKE', $categoryIdPath . "%")
        ->whereIn('status_id', [1,2])
        ->update(['status_id' => $status_id]);
    }

    public function toggle_category_availability($single_category) {
        
        if($single_category->status_id == 1) {
            $single_category->status_id = 2;
        } elseif($single_category->status_id == 2) {
            $single_category->status_id = 1;
        }else {
            // do nothing keep the original status
        }

        return $single_category->save();
    }

}
