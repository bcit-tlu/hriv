<?php

namespace App\Http\Controllers\Manage;

use Illuminate\Http\Request;
use App\Http\Controllers\Controller;
use Illuminate\Support\Facades\DB; 
use Illuminate\Pagination\Paginator;
use Illuminate\Support\Facades\Log;
use App\LdapMember;
use Illuminate\Support\Facades\Auth;
use App\User;
use App\Admin_program;
use App\ImageSource;
use App\Deleted_images_source;
use Carbon\Carbon;
use Config; 
use Validator;

class CopyrightController extends Controller
{   
    // Only number, letter, single whitesapce, \'-\' , \'_\' and \'.\' are allowed
    const COPYRIGHT_NAME_REGEX = '/^[\.\-\w]+(?: [\.\-\w]+)*$/';
    

    public function index(Request $request)
    {

        Paginator::defaultView('manage.pagination');

        $showing            = $request->get('showing', 10);
        $showing            = $showing > 100 ? 100 : $showing;
        $breadCrumb         = ['Home' => '/', 'Copyright List' => ''];
        $tableTitle         = 'Copyright';
        $tableDescription   = 'List of all Copyright';

        $searchText = $request->get('q', null);
        $sorting = $request->get('sorting', null);
        $defaultSort = 'Name';
        $query = new ImageSource();

        $current_user = Auth::user();
        $linked_admin_programs = User::get_linked_admin_programs($current_user);

        $copyright_list = $query->getCopyrightList($current_user, array_keys($linked_admin_programs), $searchText, $sorting);

        return view('manage.copyright.list', [
            'copyright_list' => $copyright_list->paginate($showing),
            'breadCrumb' =>  $breadCrumb, 
            'tableTitle' => $tableTitle, 
            'tableDescription' => $tableDescription,
            'linkedAdminPrograms' => $linked_admin_programs
        ]);

    }

    public function delete(Request $request)
    {
        Log::notice("==================== CopyrightController delete() Start ====================");
        $image_source_Id = $request->get('itemID');
        $image_source = ImageSource::find($image_source_Id);

        if (!$image_source) {
            Log::warning('CopyrightController delete() - Copyright ID [' . $image_source_Id . '] record doesn\'t exist. Abort', ['file' => __FILE__ , 'line' => __LINE__] );
            Log::notice("==================== CopyrightController delete() Aborted ====================");
            abort(404);
        }
        try {
            Log::info('CopyrightController delete() - Start Deleting the Copyright [' . $image_source->name . ']' . ' with ID: [' . $image_source->id . ']', ['name' => $image_source->name, 'id' => $image_source->id, 'file' => __FILE__ , 'line' => __LINE__] );
            if($image_source->image_count > 0)
            {
                // Abort if the ImageSource count is not 0. Some images are still using the copyright
                Log::info('CopyrightController delete() - Copyright Copyright ID [' . $image_source->id . '] is still in use', ['name' => $image_source->name, 'id' => $image_source->id, 'file' => __FILE__ , 'line' => __LINE__] );
                Log::notice("==================== CopyrightController delete() - Aborted! Image Source Count is not ZERO ====================");
                abort(404);
            }  
            // delete the category and return
            $current_user = Auth::user();
            $deleted_record = Deleted_images_source::create([
                'username'          => $current_user->username, 
                'user_display_name' => $current_user->name, 
                'item_name'         => $image_source->name,
                'deleted_at'        => Carbon::now(),// 'Carbon::now()' application time  //'DB::raw('now()')' database time  
                'user_data'         => $current_user->toJson(),
                'item_data'         => $image_source->toJson(),
                ]);
            $deleted_record->admin_program_id = $image_source->admin_program_id;
            if(!is_null($deleted_record->admin_program_id)){
                $deleted_record->admin_program_display_name = Admin_program::find($image_source->admin_program_id)->display_name;
            }
            $temp_image_source_name = $deleted_record->item_name;
            $deleted_record->save();
            Log::notice('CopyrightController delete() - Success deleted the Copyright [' . $temp_image_source_name . '] with ID: [' . $image_source->id . ']', ['name' => $temp_image_source_name, 'id' => $image_source->id, 'file' => __FILE__ , 'line' => __LINE__]);
            Log::notice("==================== CopyrightController delete() - Finished ====================");
            return json_encode(['result' => $image_source->delete()]);
        } catch (Exception $e) {
            Log::error('CopyrightController delete() - Error deleting Copyright Copyright [' . $image_source->name . '] with ID: [' . $image_source->id . '] with exception: ' . $e->getMessage() . '.', ['name' => $image_source->name, 'id' => $image_source->id, 'file' => __FILE__ , 'line' => __LINE__]);
            Log::notice("==================== CopyrightController delete() Aborted ====================");
            abort(404);
        }
    }

    public function save(Request $request)
    {
        Log::notice("==================== CopyrightController save() Start ====================");
        $validateField = [
            'copyright'      => 'required|unique:images_source,name|max:50|min:3|regex:'. self::COPYRIGHT_NAME_REGEX, 
            'programId'     => 'required|integer|exists:admin_programs,id'
        ];
        

        $validateMessages = [
            'regex'         => 'Only number, letter, single whitespace, \'-\' and \'_\' are allowed.',
        ];

        $editId = $request->get('editId', null);
        $previous_image_source_name;
        $image_source_selected = null;

        if($editId) {
            $validateField['copyright'] = 'required|max:50|min:3|regex:'. self::COPYRIGHT_NAME_REGEX;
            $image_source_selected = ImageSource::find($editId);
            $previous_image_source_name = $image_source_selected->name;
            Log::info('CopyrightController save() - Editing Copyright [' . $previous_image_source_name . '] with ID [' . $editId . ']');
        }

        $validatedData = $request->validate($validateField, $validateMessages);

        if($validatedData) {
            $programId = $request->get('programId', null);
            
            $image_source    = $image_source_selected ?? new ImageSource();

            Log::info('CopyrightController save() - Saving new copyright');
            
            $image_source->name             = $request->get('copyright');
            $image_source->admin_program_id = $programId;

            $image_source->save();

            if($editId) {
                Log::notice('CopyrightController save() - Success updated the existing Copyright [' . $image_source->name . '] with ID [' . $image_source->id . ']. Previous Image Source name: [' . $previous_image_source_name . ']', ['name' => $image_source->name, 'id' => $image_source->id, 'file' => __FILE__ , 'line' => __LINE__]);
            } else {
                Log::notice('CopyrightController save() - Success saved new Copyright [' . $image_source->name . '] with ID [' . $image_source->id . ']', ['name' => $image_source->name, 'id' => $image_source->id, 'file' => __FILE__ , 'line' => __LINE__]);
            }
            
            Log::notice("==================== CopyrightController save() Finished ====================");

            return response()->json('{"success": "true"}');
        } 
        else {
            Log::error('CopyrightController save() - Error: Unable to validate data for Copyright ID [' . $editId . ']', ['id' => $editId, 'file' => __FILE__ , 'line' => __LINE__]);
            Log::notice("==================== CopyrightController save() ERROR ====================");
            return response()->json($validatedData->errors());
        }
    }

    public function search(Request $request)
    {
        Log::info("==================== CopyrightController search() Start ====================");

        $q          = $request->get('q', []);
        $id         = $request->get('id', null);

        $image_source = ImageSource::query();

        if($q) {
            
            $validatedData_q = $request->validate(
                [ 
                    'q'     => 'min:1|max:50|regex:'. self::COPYRIGHT_NAME_REGEX,  
                ],
                [
                    'min'   => 'The search name may not be smaller than :min.',
                    'max'   => 'The search name may not be greater than :max.',
                    'regex' => 'Only number, letter, single whitesapce, \'-\' and \'_\' are allowed.',
                ]);
            
            if(!$validatedData_q) {
                Log::error('CopyrightController search() - Error unable to validate the query ' . $q . '.', ['file' => __FILE__ , 'line' => __LINE__]);
                Log::info("==================== CopyrightController search() ERROR ====================");
                return response()->json($validatedData_q->errors());
            }

            $linked_admin_programs_ids = array_keys(User::get_linked_admin_programs(Auth::user()));
            $image_source = $image_source->select('images_source.id', 'images_source.name')
            ->where('images_source.name', 'like', "%" . $q . "%")
            ->orderBy('images_source.id')->get();

        } else if($id) {
            Log::info("CopyrightController search() - Search with Copyright ID [" . $id . "]...", ['id' => $id, 'file' => __FILE__ , 'line' => __LINE__]);
            $image_source = $image_source->where('images_source.id', $id)->first();
        }

        Log::info("==================== CopyrightController search() Finished ====================");
        return response()->json($image_source); 
    }
}
