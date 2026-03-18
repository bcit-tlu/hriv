<?php

namespace App\Http\Controllers\Manage;

use Config; 
use App\Category;
use App\Http\Controllers\Controller;
use App\Image;
use App\ImageSource;
use App\ImageZoomify;
use App\Jobs\DeleteImage;
use App\Jobs\ProcessImage;
use Illuminate\Http\Request;
use Illuminate\Pagination\Paginator;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Validator;
use Illuminate\Support\Facades\Auth;
use App\User;

class ImageController extends Controller
{
    const IMAGE_NAME_REGEX = '/^[\-\w]+(?: [\-\w]+)*$/'; // Only number, letter, single whitesapce, \'-\' and \'_\' are allowed

    public function index(Request $request)
    {

        Paginator::defaultView('manage.pagination');

        $showing = $request->get('showing', 10);
        $showing = $showing > 100 ? 100 : $showing;
        $tableTitle = 'Images';
        $tableDescription = 'List of the images';

        $searchText = $request->get('q', null);
        $sorting = $request->get('sorting', null);
        $defaultSort = 'Name';
        $query = new Image();

        $current_user = Auth::user();
        $linked_admin_programs = User::get_linked_admin_programs($current_user);

        $images = $query->getManageQueryList($current_user, array_keys($linked_admin_programs), $searchText, $sorting);

        return view('manage.images.list', [
            'images' => $images->paginate($showing), 
            'tableTitle' => $tableTitle, 
            'tableDescription' => $tableDescription,
            'linkedAdminPrograms' => $linked_admin_programs
            ]);
    }

    public function delete(Request $request)
    {
        Log::notice("==================== ImageController delete() Start ====================");

        $imageId = $request->get('itemID');
        $image = Image::find($imageId);

        if (!$image) {
            Log::warning('Image record doesn\'t exist', ['name' => $image->name, 'id' => $imageId, 'line' => __LINE__, 'file' => __FILE__]);
            Log::notice("==================== CopyrightController save() Aborted ====================");
            abort(404);
        }

        if ($image->status_id == 4) {
            // Status == 4 the image is still processing and should not be deleted
            Log::warning('Image is still processing and should not be deleted', ['name' => $image->name, 'id' => $imageId, 'line' => __LINE__, 'file' => __FILE__]);
            Log::notice("==================== CopyrightController save() Aborted ====================");
            abort(404);
        }
        
        $imageZoomify = ImageZoomify::where('image_id', $imageId)->first();

        if (!$imageZoomify && $image->status_id != 5) {
            Log::warning('ImageZoomify record doesn\'t exist', ['name' => $image->name, 'id' => $imageId, 'line' => __LINE__, 'file' => __FILE__]);
            Log::notice("==================== CopyrightController save() Aborted ====================");
            abort(404);
        }

        try {
            Log::info('ImageController delete() function started - Deleting Image with id: [' . $imageId . ']');

            // set status_id=3 to temperely hide the image from the user untill all the tiles are deteled
            $image->status_id = 3;
            $current_user = Auth::user();
            if($image->save()){
                DeleteImage::dispatch($image, $current_user)->onQueue("deleteImageQueue")->delay(now()->addSeconds(5));

                if($image->image_source_id != $request->get('copyright_id')){
                    $imagesource_deleted = $image->imagesource;
                    if($imagesource_deleted->image_count > 0){
                        $imagesource_deleted->image_count = $imagesource_deleted->image_count - 1;
                        $imagesource_deleted->save();
                        Log::info("ImageController delete() function - successfully updated ImageCount to [" . $imagesource_deleted->image_count . "]");
                    } elseif ($imagesource_deleted->image_count <= 0) {
                        $imagesource_deleted->image_count = 0;
                        $imagesource_deleted->save();
                        Log::info("ImageController delete() function - successfully updated ImageCount to [" . $imagesource_deleted->image_count . "]");
                    }
                    else {
                        //do nothing
                    }
                }
                else {
                    //do nothing
                }
                Log::notice('Deletion job dispatched', ['name' => $image->name, 'id' => $imageId, 'line' => __LINE__, 'file' => __FILE__]);
                Log::notice("==================== ImageController delete() Finished ====================");
                return json_encode(['result' => true]);
            } else {
                Log::warning('Failed to delete image', ['name' => $image->name, 'id' => $imageId, 'line' => __LINE__, 'file' => __FILE__]);
                Log::notice("==================== ImageController delete() Aborted ====================");
                return json_encode(['result' => false]);
            }

        } catch (Exception $e) {
            Log::error("Image deletion failed with exception: " . $e->getMessage(), ['name' => $image->name, 'id' => $imageId, 'line' => __LINE__, 'file' => __FILE__]);
            Log::notice("==================== ImageController delete() ERROR ====================");
            abort(404);
        }
    }

    public function add(Request $request, $id = false)
    {
        $image = null;
        $is_edit = false;

        if ($id) {
            $image = Image::where('id', $id)->first();
            if($image){
                $is_edit = true;
                $image->category_name = $image->category->name;
                $image->copyright_name = $image->imagesource->name;   
            }
        }

        if ($image && $image->zoomify) {
            $image['size'] = $image->zoomify->numtiles * $image->zoomify->tilesize * 100;
        }

        $linked_admin_programs = User::get_linked_admin_programs(Auth::user());

        if(!empty($linked_admin_programs)){
            Log::info('User AUTHORIZED. Proceeding...');

            return view('manage.images.add', [
                'image' => $image, 
                'is_edit' => $is_edit,
                'linkedAdminPrograms' => $linked_admin_programs]);
        } else {
            Log::warning('User NOT AUTHORIZED. Aborting...');
            Log::notice("==================== ImageController add() Aborted ====================");
            abort(401);
        }
    }

    public function save(Request $request)
    {

        Log::notice("==================== ImageController save() Start ====================");
        $id = $request->get('id', null);

        // 10 min time limit
        set_time_limit(1800);

        $validateField = [
            'name' => 'required|unique:images,name|max:90|min:3|regex:' . self::IMAGE_NAME_REGEX,
            'title' => 'required|max:90|min:3',
            'description' => 'required',
            'copyright_id' => 'required|exists:images_source,id',
            'category_id' => 'required|exists:categories,id',
            'path' => 'required|max:255',
            'programId'     => 'required|integer|exists:admin_programs,id'
        ];

        if ($id) {
            $validateField['name'] = 'required|unique:images,name,' . $id . '|max:90|min:3|regex:' . self::IMAGE_NAME_REGEX;
        }

        $validateMessages = [
            'category_id.required' => 'The category field is required.',
            'path.required' => 'The image field is required.',
            'copyright_id.required' => 'The copyright field is required.',
            'regex' => 'The :attribute format is invalid. Only number, letter, single whitesapce, \'-\' and \'_\' are allowed.',
        ];

        $validatedData = $request->validate($validateField, $validateMessages);

        if ($validatedData) {

            Log::info("ImageController save() - Data validation passed...");

            try {
                $name = $request->get('name');
                $path = $request->get('path');
                $hasImageToUpload = filter_var($request->get('success_new_upload'), FILTER_VALIDATE_BOOLEAN); // DO NOT use (bool)$var cast ! $var="false" will result (bool)$var=true
                $imgExtension = config('filesystems.image_extension'); // only jpg for preview.  originally was " $imgExtension = substr($path, strrpos($path, '.')); "
                $programId = $request->get('programId', null);

                if ($id) { // edit image
                    Log::notice("==================== ImageController save() - Edit Image ====================");
                    $image = Image::find($id);
                    Log::info('Start editing image.', ['name' => $image->name, 'id' => $id, 'line' => __LINE__, 'file' => __FILE__]);
                    if(!$image || $image->status_id == 4){ // no image found , abort
                        Log::warning('Image ID [' . $id . '] Image record doesn\'t exist or is still processing');
                        Log::notice("==================== ImageController save() - Edit Image Aborted ====================");
                        abort(404);
                    }
                    
                    // NEVER update 'slug', 'path', and 'thumbnail' in edit !!!
                    if ($hasImageToUpload) { // slug is never updated once created. so this '$thumbnailUrl' should stay the same
                        Log::info("ImageController save() - Has image to upload");
                        $thumbnailUrl = config('filesystems.image_tiles_dir_path') . $image->slug . '/preview' . $imgExtension;
                    }

                    if($image->image_source_id != $request->get('copyright_id')){
                        $imagesource_old = $image->imagesource ;//= $request->get('copyright_id');
                        if($imagesource_old->image_count > 0){
                            $imagesource_old->image_count = $imagesource_old->image_count - 1;
                            $imagesource_old->save();
                        } elseif ($imagesource_old->image_count < 0) {
                            $imagesource_old->image_count = 0;
                            $imagesource_old->save();
                        }
                        else {
                            //do nothing
                        }
                        
                        $image->image_source_id = $request->get('copyright_id');
                        $imagesource_new = ImageSource::find($request->get('copyright_id'));
                        $imagesource_new->image_count = $imagesource_new->image_count + 1;
                        $imagesource_new->save();

                    }
                    
                } else { // add new image
                    Log::notice("==================== ImageController save() - Add New Image ====================");
                    Log::info('Image ID not found. Creating a new image now.');
                    $image = new Image();
                    $slug = Str::slug($name."-".Str::orderedUuid(), "-");
                    $image->slug = $slug;
                    $image->path = Storage::url(config('filesystems.image_tiles_dir_path') . $image->slug); 

                    $thumbnailUrl = config('filesystems.image_tiles_dir_path') . $image->slug . '/preview' . $imgExtension; // Note that this image path is for save thumbnail at LOCAL not on AWS S3
                    $image->thumbnail = Storage::url($thumbnailUrl); 

                    $image->image_source_id = $request->get('copyright_id');
                    $imagesource_new = ImageSource::find($request->get('copyright_id'));
                    $imagesource_new->image_count = $imagesource_new->image_count+1;
                    $imagesource_new->save();
                    
                    $image->order = 999;
                }

                $image->status_id = $hasImageToUpload ? 4 : $image->status_id; // If new image uploaded, set status_id to 4 for Processing
                $image->admin_program_id = $programId;
                $image->name = $name;
                $image->title = $request->get('title');
                $image->description = $request->get('description');
                $image->category_id = $request->get('category_id');

                if ($image->save()) {
                    Log::notice("Image saved successfully", ['name' => $image->name, 'id' => $image->id, 'line' => __LINE__, 'file' => __FILE__]);
                    if ($hasImageToUpload) { // request job for proccess new image in VIPS
                        ProcessImage::dispatch($image, $path, $thumbnailUrl)->onQueue("createImageQueue")->delay(now()->addSeconds(5));
                    }
                }
                Log::notice("==================== ImageController save() Finished ====================");

                return response()->json(true);

            } catch (Exception $e) {
                Log::error('Image save error with exception ' . $e->getMessage(), ['line' => __LINE__, 'file' => __FILE__]);
                Log::notice("==================== ImageController save() ERROR ====================");
                abort(500, $e->getMessage());
            }

        } else {
            Log::error('Image data validated error' . $validatedData->errors(), ['line' => __LINE__, 'file' => __FILE__]);
            Log::notice("==================== ImageController save() ERROR ====================");
            return response()->json($validatedData->errors());
        }

    }

    public function upload(Request $request)
    {

        Log::notice("==================== ImageController upload() Start ====================");
        $messages = [
            'required' => 'The :attribute field is required.',
            'mimetypes' => 'Invalid file format. Only Image is allowed.',
            'max' => 'The file exceeds the allowed size. The maximum allowed size is 1GB.',
        ];
        $validator = Validator::make($request->all(), [
            'file' => 'required|mimetypes:image/jpeg,image/png,image/tiff|max:1024000',
        ], $messages);

        $response = null;
        $code = null;

        try {

            if ($request->hasFile('file')) {

                if ($validator->fails()) {
                    Log::warning('File upload validation failed.');
                    $response = ['message' => $validator->errors()->get('file')];
                    $code = 500;

                } else {

                    $fileLocalName = $request->file('file')->hashName() . "-" . session()->getId() . '.' . $request->file('file')->getClientOriginalExtension();
                    $file = $request->file('file')->storeAs('temp', $fileLocalName, 'public');

                    Log::info('File upload success', ['name' => $fileLocalName, 'line' => __LINE__, 'file' => __FILE__]);

                    $response = ['message' => 'Upload success.', 'fileLocalName' => $fileLocalName];
                    $code = 200;
                }

            } else {
                Log::info('File upload failed. File invalid or not found.');
                $response = ['message' => 'File invalid or not found!'];
                $code = 400;

            }

        } catch (Exception $e) {
            Log::error("File upload failed with exception: " . $e->getMessage(), ['line' => __LINE__, 'file' => __FILE__]);
            Log::notice("==================== ImageController upload() ERROR ====================");
            $response = ['message' => 'Services unavailable. Contact VSM team vsm_team@bcit.ca', 'error' => $e->getMessage()];
            $code = 500;
        }

        Log::notice("==================== ImageController upload() Finished ====================");

        return response()->json($response, $code);
    }

    public function sort(Request $request)
    {
        Log::notice("==================== ImageController sort() Start ====================");

        $categoryId = $request->get('qid', null);
        $breadCrumb = ['Home' => '/', 'Categories' => route('category-list')];

        $category = Category::find($categoryId);

        if (!$category) {
            Log::warning("Category not found. Aborting.");
            Log::notice("==================== ImageController sort() Aborted ====================");
            abort(404);
        }
        
        if ($category->status_id == 2) {
            $breadCrumb['(Disabled) '.$category->name] = '';    
        } else {
            $breadCrumb[$category->name] = '';
        }

        Log::info("Sorting images for category:", ['name' => $category->name, 'line' => __LINE__, 'file' => __FILE__]);

        $images = Image::select('id', 'name', 'path', 'thumbnail', 'order', 'status_id')
            ->where('category_id', $categoryId)
            ->where(function($query) {
                $query->where('status_id', 1)  // // Enable
                      ->orWhere('status_id', 2); // // Disable
            })
            ->orderBy('order')
            ->orderBy('id')
            ->get();
        
        $thumnailbaseurl = "";
        if(config('filesystems.enable_aws_storage') == true){
            $thumnailbaseurl = config('filesystems.cdnroot');
        }

        Log::info("Sorting Completed.");

        Log::notice("==================== ImageController sort() Finished ====================");

        return view('manage.images.sort', [
            'breadCrumb' => $breadCrumb,
            'images' => $images,
            'category' => $category,
            'thumnailbaseurl' => $thumnailbaseurl,
        ]);

    }

    public function saveSortOrder(Request $request)
    {
        Log::info("==================== ImageController saveSortOrder() Start ====================");

        $images = $request->get('images', []);

        if (!$images) {
            Log::warning("Images not found. Aborting...");
            Log::info("==================== ImageController saveSortOrder() Aborted ====================");
            abort(400);
        }

        foreach ($images as $order => $image) {
            $image = Image::find($image['id']);
            $image->order = $order;
            $image->save();
        }

        Log::info("Images sorted successfully.", ['line' => __LINE__, 'file' => __FILE__]);

        Log::info("==================== ImageController saveSortOrder() Finished ====================");
        return response()->json($images);

    }

    public function getSources(Request $request)
    {
        Log::info('Getting all image resources.', ['line' => __LINE__, 'file' => __FILE__]);
        return response()->json(ImageSource::all());

    }

}
