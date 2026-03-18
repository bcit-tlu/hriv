<?php

namespace App;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB; 
use App\User;
use App\Admin_program;

class ImageSource extends Model
{

    protected $table = 'images_source';

    /**
     * The attributes that are mass assignable.
     *
     * @var array
     */
    protected $fillable = [
        // 'name', 'icon', 'external', 'url'
        'name', 'icon', 'admin_program_id', 'image_count', 'icon'
    ];

    public function admin_program()
    {
        return $this->belongsTo(Admin_program::class, 'admin_program_id', 'id');
    }

    public function getCopyrightList(
        $current_user = null, 
        $linked_admin_programs_ids = null, 
        $searchText = false, 
        $sorting = false
    ) 
    {

        $order              = false;
        $dataField          = false;

        // Below swtich is for sorting the manage Copyright list
        if($sorting) {
            list($field, $order) = array_pad(explode('-', $sorting), 2, 'asc');
            switch ($field) {
                case 'ID':
                    $dataField = 'images_source.id';
                break;
                case 'Name':
                    $dataField = 'images_source.name';
                    break;
                case 'Image Count':
                    $dataField = 'images_source.image_count';
                    break;
                case 'Program':
                    $dataField = 'admin_programs.display_name';
                    break;
                case 'Modified':
                    $dataField = 'images_source.updated_at';
                    break;
                default:
                    $dataField = 'images_source.name';
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


        if(User::isSuperAdmin($current_user)){ // if is super admin then set `editable` for all copyright to true

            $query = DB::table('images_source')->select(
                    "images_source.id",
                    "images_source.name",
                    "images_source.image_count AS count",
                    "images_source.updated_at AS modified",
                    "admin_programs.display_name AS program_name",
                    "admin_programs.cn AS cn"
                )->selectRaw("True AS editable")
                ->leftjoin('admin_programs', 'admin_programs.id', '=', 'images_source.admin_program_id')
                ;

        }elseif(!empty($linked_admin_programs_ids)){ // if linked admin_programs list is not empty then set `editable` to true for copyright with foreign key admin_program_id same in the admin_programs list

            $query = DB::table('images_source')->select(
                    "images_source.id",
                    "images_source.name",
                    "images_source.image_count AS count",
                    "images_source.updated_at AS modified",
                    "admin_programs.display_name AS program_name",
                    "admin_programs.cn AS cn"
                )->selectRaw('images_source.admin_program_id in (' . substr(json_encode($linked_admin_programs_ids), 1,-1) . ') as editable')
                ->leftjoin('admin_programs', 'admin_programs.id', '=', 'images_source.admin_program_id')
                ;

        }else{ // if linked admin_programs list is empty then set `editable` for all copyright to false

            $query = DB::table('images_source')->select(
                    "images_source.id",
                    "images_source.name",
                    "images_source.image_count AS count",
                    "images_source.updated_at AS modified",
                    "admin_programs.display_name AS program_name",
                    "admin_programs.cn AS cn"
                )->selectRaw("False AS editable")
                ->leftjoin('admin_programs', 'admin_programs.id', '=', 'images_source.admin_program_id')
                ;

        }

        // set dispaly categories list order
        if($dataField && $order ) {
            $query->orderBy($dataField, $order);
        } else {
            $query->orderBy('editable', 'DESC')
            ->orderBy('images_source.id', 'ASC');
        }

        if( $searchText ) {

            // search category with string
            $searchDate = str_replace('/', '-', $searchText);
            $query->where(function($queryin) use ($searchText) {
                $queryin->where('images_source.name', 'like', "%" . $searchText . "%")
                ->orWhere('images_source.id', $searchText)
                ->orWhere('admin_programs.display_name', 'like', "%" . $searchText . "%");
            });

            // search with datetime
            if (preg_match("/^[2-4][0-9]{3}[\/\-][0-1][0-9][\/\-][0-3][0-9]$/", $searchText)) { // matching 'YYYY/mm/dd' or 'YYYY-mm-dd'

                $date = date('Y-m-d', strtotime(str_replace('/', '-', $searchText)));
                $query->orWhereDate('images_source.updated_at', $date);

            } else if(preg_match("/^[2-4][0-9]{3}[\/\-][0-1][0-9][\/\-][0-3][0-9]\s[0-2][0-9]\:[0-5][0-9]\:[0-5][0-9]$/", $searchText)) { // matching 'YYYY/mm/dd HH:ii:ss' or 'YYYY-mm-dd HH:ii:ss'

                $date = date('Y-m-d H:i:s', strtotime(str_replace('/', '-', $searchText)));
                $query->orWhere('images_source.updated_at', $date);

            } else if(preg_match("/^[0-2][0-9]\:[0-5][0-9]\:[0-5][0-9]$/", $searchText)) { // matching 'HH:ii:ss'

                $time = date('H:i:s', strtotime(str_replace('/', '-', $searchText)));
                $query->orWhereTime('images_source.updated_at', $time);

            }
        }


        return $query;

    }

    

}
