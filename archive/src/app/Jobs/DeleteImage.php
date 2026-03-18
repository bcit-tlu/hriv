<?php

namespace App\Jobs;

use Config; 
use App\Image;
use App\ImageZoomify;
use App\Admin_program;
use App\Deleted_image_or_category;
use App\AWS\CloudFront_client;
use Carbon\Carbon;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Storage;


class DeleteImage implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    protected $image;
    protected $current_user;

    /**
     * Create a new job instance.
     *
     * @return void
     */
    public function __construct($image, $current_user)
    {
        $this->image = $image;
        $this->current_user = $current_user;
        $this->connection = 'database';
    }

    public function retryUntil()
    {
        return now()->addHours(24);
    }

    /**
     * Execute the job.
     *
     * @return void
     */
    public function handle()
    {
        set_time_limit(1800); //1800 seconds

        Log::info('[' . $this->image->slug . ']Deleting Image...');

        try {

            if(config('filesystems.enable_aws_storage') == true){
                // append '/corgi' to the beginning such that it matches the AWS S3 access path.
                $s3_path = config('filesystems.aws_s3_root_dir') . '/' . config('filesystems.image_tiles_dir_path_with_storage'). $this->image->slug;

                if( Storage::disk('s3')->exists($s3_path)){
                    Log::info('[ Image Slug: ' . $this->image->slug . ']Deleting Image Tiles from AWS S3...');
                    Storage::disk('s3')->deleteDirectory($s3_path);

                    $cloudFront_result=  CloudFront_client::getClient()->createInvalidation( $this->image->slug , $s3_path );
                    if( $cloudFront_result['success'] == true){
                        Log::info("[ Image ID:" . $this->image->slug . "] \n invalidation request created: \n " . $cloudFront_result["result"]);
                    } else {
                        Log::error('[' . $this->image->slug . ']Error: [ ' . $img_storage_path . ' ] \n Deleting Image Tiles from AWS CloudFront Cache FAILED \n ' . $cloudFront_result['result']);
                    }

                    Log::info('[ Image ID:' . $this->image->id . ']Deleting Image Zoomify Table Record...');
                    ImageZoomify::where('image_id', $this->image->id)->delete();

                    Log::info('[ Image ID:' . $this->image->id . ']Deleting Image Table Record...');
                    $deleted_record = Deleted_image_or_category::create([
                        'type'              => config('constants.image_label'), 
                        'username'          => $this->current_user->username, 
                        'user_display_name' => $this->current_user->name, 
                        'item_name'         => $this->image->name, 
                        'deleted_at'        => Carbon::now(),// 'Carbon::now()' application time  //'DB::raw('now()')' database time  
                        'user_data'         => $this->current_user->toJson(),
                        'item_data'         => $this->image->toJson()
                        ]);
                    $deleted_record->admin_program_id = $this->image->admin_program_id;
                    $deleted_record->admin_program_display_name = Admin_program::find($this->image->admin_program_id)->display_name;
                    $deleted_record->save();
                    $this->image->delete();
                    Log::notice("[" . $this->image->slug . "]Done deleting image [" . $this->image->name . "] with image ID [" . $this->image->id . "]\n");
                } else {
                    Log::error("[" . $this->image->slug . "]Error: [ " . $local_path . " ] \n Image folder DOES NOT EXIST on local storage \n");
                }

            } else {

                $local_path = config('filesystems.image_dir_path_without_app') . $this->image->slug;

                if( Storage::exists($local_path)){

                    Log::info('[ Image Slug: ' . $this->image->slug . ']Deleting Image Tiles...');
                    Storage::deleteDirectory($local_path);
                    
                    Log::info('[ Image ID:' . $this->image->id . ']Deleting Image Zoomify Table Record...');
                    ImageZoomify::where('image_id', $this->image->id)->delete();

                    Log::info('[ Image ID:' . $this->image->id . ']Deleting Image Table Record...');
                    $deleted_record = Deleted_image_or_category::create([
                        'type'              => config('constants.image_label'), 
                        'username'          => $this->current_user->username, 
                        'user_display_name' => $this->current_user->name, 
                        'item_name'         => $this->image->name, 
                        'deleted_at'        => Carbon::now(),// 'Carbon::now()' application time  //'DB::raw('now()')' database time  
                        'user_data'         => $this->current_user->toJson(),
                        'item_data'         => $this->image->toJson()
                        ]);
                    $deleted_record->admin_program_id = $this->image->admin_program_id;
                    $deleted_record->admin_program_display_name = Admin_program::find($this->image->admin_program_id)->display_name;
                    $deleted_record->save();
                    $this->image->delete();
                    Log::notice("[" . $this->image->slug . "]Done deleting image [" . $this->image->name . "] with image ID [" . $this->image->id . "]\n");
                } else {
                    Log::error("[" . $this->image->slug . "]Error: [ " . $local_path . " ] \n Image folder DOES NOT EXIST on local storage \n");
                }
            }

        } catch (Exception $e) {
            Log::error('[' . $this->image->slug . ']Error:' . $e->getMessage());
        }
    }
}
