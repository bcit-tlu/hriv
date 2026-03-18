<?php

namespace App;

use Config;
use Illuminate\Database\Eloquent\Model;
use DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Auth;
use App\User;
use App\Category;
use App\Admin_program;

class Image extends Model
{
    /**
     * The attributes that are mass assignable.
     *
     * @var array
     */
    protected $fillable = [
        'name', 'category', 'sub_category'
    ];

    public function category()
    {
        return $this->belongsTo('App\Category', 'category_id', 'id');
    }

    public function status()
    {
        return $this->belongsTo('App\Status', 'status_id', 'id');
    }

    public function admin_status()
    {
        return $this->belongsTo('App\Status', 'admin_status_id', 'id');
    }

    public function zoomify()
    {
        return $this->hasOne('App\ImageZoomify', 'image_id', 'id');
    }

    public function imagesource()
    {
        return $this->hasOne('App\ImageSource', 'id', 'image_source_id'); //TODO check this if it finds the image source
    }

    public function admin_program()
    {
        return $this->belongsTo(Admin_program::class, 'admin_program_id', 'id');
    }

    public static function getImageDetailBySlug($slug = null)
    {
        if($slug) {
           /*
            *    SELECT name, slug, corgi.images_zoomify.image_id, corgi.images_zoomify.width, corgi.images_zoomify.height, 
                        corgi.images_zoomify.numimages, corgi.images_zoomify.numtiles, corgi.images_zoomify.version, corgi.images_zoomify.tilesize
                 FROM corgi.images
                 LEFT JOIN corgi.images_zoomify
                 ON corgi.images.id = corgi.images_zoomify.image_id
                 WHERE slug = "aorta";
            */
            if(config('filesystems.enable_aws_storage') == true){
                $imageDetailResult =  DB::table('images')
                    ->select(
                        'name', 
                        'slug', 
                        DB::raw("CONCAT('" . config('filesystems.cdnroot') . "',path) as path"),  //  append the cdn access root url
                        DB::raw("CONCAT('" . config('filesystems.cdnroot') . "',thumbnail) as thumbnail"), //  append the cdn access root url
                        'images_zoomify.image_id', 
                        'images_zoomify.width', 
                        'images_zoomify.height', 
                        'images_zoomify.numimages', 
                        'images_zoomify.numtiles', 
                        'images_zoomify.version', 
                        'images_zoomify.tilesize')
                    ->leftJoin('images_zoomify', 'images.id', '=', 'images_zoomify.image_id')
                    ->where('images.slug', $slug)
                    ->get()
                    ->first(); 
            } else {
                $imageDetailResult =  DB::table('images')
                    ->select(
                        'name', 
                        'slug', 
                        'path',
                        'thumbnail', 
                        'images_zoomify.image_id', 
                        'images_zoomify.width', 
                        'images_zoomify.height', 
                        'images_zoomify.numimages', 
                        'images_zoomify.numtiles', 
                        'images_zoomify.version', 
                        'images_zoomify.tilesize')
                    ->leftJoin('images_zoomify', 'images.id', '=', 'images_zoomify.image_id')
                    ->where('images.slug', $slug)
                    ->get()
                    ->first(); 
            }
                                              
            return $imageDetailResult;
        }
    }


    public function getManageQueryList(
            $current_user = null, 
            $linked_admin_programs_ids = null, 
            $searchText = false, 
            $sorting = false
        ) 
    {

        $order              = false;
        $dataField          = false;

        // Below swtich is for sorting the manage image list
        if($sorting) {
            list($field, $order) = array_pad(explode('-', $sorting), 2, 'asc');
            switch ($field) {
                case 'ID':
                    $dataField = 'I.id';
                    break;
                case 'Name':
                    $dataField = 'I.name';
                    break;
                case 'Copyright':
                    $dataField = 'IS.name';
                    break;
                case 'Category':
                    $dataField = 'C.name';
                    break;
                case 'Status':
                    $dataField = 'S.name';
                    break;
                case 'Modified':
                    $dataField = 'I.updated_at';
                    break;
                default:
                    $dataField = 'I.name';
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

        // // Get images attributes and status
        // // Frontent use `editable` True/False to control show/hide edit,delete,sort,disable buttons
        // select 
        //  `I`.*,
        //  `C`.`name` as `category_name`, 
        //  `S`.`name` as `status_name` 
        //  `admin_programs`.display_name AS `admin_program_display_name`,
        //  `I`.`admin_program_id` in (1,3) AS `editable`, -- True AS `editable`
        //  from `images` as `I`
        //  left join `categories` as `C` on `C`.`id` = `I`.`category_id` 
        //  left join `status` as `S` on `S`.`id` = `I`.`status_id`
        //  left join `admin_programs` on `admin_programs`.`id` = `I`.`admin_program_id` 
        //  where `I`.`status_id` in (1, 2, 4, 5)
        //  ;

        if(User::isSuperAdmin($current_user)){ // if is super admin then set `editable` for all images to true

            $query = Image::select('I.id', 'I.name', 'I.slug', 'I.created_at', 'I.updated_at', 'I.status_id')
                ->selectRaw('IS.name as image_source_name')
                ->selectRaw('C.name as category_name')
                ->selectRaw('S.name as status_name')
                ->selectRaw('admin_programs.display_name AS admin_program_display_name')
                ->selectRaw('True AS editable')
                ->from('images as I')
                ->leftjoin('images_source as IS', 'IS.id', '=', 'I.image_source_id')
                ->leftjoin('categories as C', 'C.id', '=', 'I.category_id')
                ->leftjoin('status as S',  'S.id', '=','I.status_id')
                ->leftJoin('admin_programs', 'admin_programs.id', '=', 'I.admin_program_id')
                ->whereIn('I.status_id', [1,2,4,5]); 

        }elseif(!empty($linked_admin_programs_ids)){ // if linked admin_programs list is not empty then set `editable` to true for images with foreign key admin_program_id same in the admin_programs list

            $query = Image::select('I.id', 'I.name', 'I.slug', 'I.created_at', 'I.updated_at', 'I.status_id')
                ->selectRaw('IS.name as image_source_name')
                ->selectRaw('C.name as category_name')
                ->selectRaw('S.name as status_name')
                ->selectRaw('admin_programs.display_name AS admin_program_display_name')
                ->selectRaw('I.admin_program_id in (' . substr(json_encode($linked_admin_programs_ids), 1,-1) . ') as editable')
                ->from('images as I')
                ->leftjoin('images_source as IS', 'IS.id', '=', 'I.image_source_id')
                ->leftjoin('categories as C', 'C.id', '=', 'I.category_id')
                ->leftjoin('status as S',  'S.id', '=','I.status_id')
                ->leftJoin('admin_programs', 'admin_programs.id', '=', 'I.admin_program_id')
                ->whereIn('I.status_id', [1,2,4,5]); 

        }else{ // if linked admin_programs list is empty then set `editable` for all images to false

            $query = Image::select('I.id', 'I.name', 'I.slug', 'I.created_at', 'I.updated_at', 'I.status_id')
                ->selectRaw('IS.name as image_source_name')
                ->selectRaw('C.name as category_name')
                ->selectRaw('S.name as status_name')
                ->selectRaw('admin_programs.display_name AS admin_program_display_name')
                ->selectRaw('False AS editable')
                ->from('images as I')
                ->leftjoin('images_source as IS', 'IS.id', '=', 'I.image_source_id')
                ->leftjoin('categories as C', 'C.id', '=', 'I.category_id')
                ->leftjoin('status as S',  'S.id', '=','I.status_id')
                ->leftJoin('admin_programs', 'admin_programs.id', '=', 'I.admin_program_id')
                ->whereIn('I.status_id', [1,2,4,5]); 

        }

        // set dispaly categories list order
        if($dataField && $order ) {
            $query->orderBy($dataField, $order);
        } else {
            $query->orderBy('editable', 'DESC')
            ->orderBy('I.id', 'ASC');
        }

        if( $searchText ) {

            // search category with string
            $searchDate = str_replace('/', '-', $searchText);
            $query->where(function($queryin) use ($searchText) {
                $queryin->where('I.name', 'like', "%" . $searchText . "%")
                ->orWhere('IS.name', 'like', "%" . $searchText . "%")
                ->orWhere('C.name', 'like', "%" . $searchText . "%")
                ->orWhere('S.name', 'like', "%" . $searchText . "%")
                ->orWhere('I.id', $searchText);
            });

            // search with datetime
            if (preg_match("/^[2-4][0-9]{3}[\/\-][0-1][0-9][\/\-][0-3][0-9]$/", $searchText)) { // matching 'YYYY/mm/dd' or 'YYYY-mm-dd'

                $date = date('Y-m-d', strtotime(str_replace('/', '-', $searchText)));
                $query->orWhereDate('I.updated_at', $date);

            } else if(preg_match("/^[2-4][0-9]{3}[\/\-][0-1][0-9][\/\-][0-3][0-9]\s[0-2][0-9]\:[0-5][0-9]\:[0-5][0-9]$/", $searchText)) { // matching 'YYYY/mm/dd HH:ii:ss' or 'YYYY-mm-dd HH:ii:ss'

                $date = date('Y-m-d H:i:s', strtotime(str_replace('/', '-', $searchText)));
                $query->orWhere('I.updated_at', $date);

            } else if(preg_match("/^[0-2][0-9]\:[0-5][0-9]\:[0-5][0-9]$/", $searchText)) { // matching 'HH:ii:ss'

                $time = date('H:i:s', strtotime(str_replace('/', '-', $searchText)));
                $query->orWhereTime('I.updated_at', $time);

            }
        }

        $query->where('I.admin_status_id', 1); 

        return $query;

    }

}
