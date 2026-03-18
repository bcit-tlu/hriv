<?php

namespace App\Jobs;

use Config; 
use App\Image;
use App\Category;
use App\ImageZoomify;
use App\Helpers\ImageJobsHelper;
use App\AWS\S3_client;
use App\AWS\CloudFront_client;
use Jcupitt\Vips;

use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Storage;


class ProcessImage implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    protected $image;
    protected $path;
    protected $thumbnailUrl;
    protected $job_name;

    /**
     * Create a new job instance.
     *
     * @return void
     */
    public function __construct(Image $image, $path, $thumbnailUrl)
    {
        $this->image = $image;
        $this->path = $path;
        $this->thumbnailUrl = $thumbnailUrl;
        $this->connection = 'database'; 
        $this->tries = 1;
        $this->timeout = 7200;
        $this->job_name = get_class($this);
    }

    public function retryUntil()
    {
        return now()->addHours(24);
    }


    public function zoomify_image()
    {
        try {
            $this->time_start = ImageJobsHelper::get_process_timer_start($this->job_name, $this->image->slug);

            // Zoomify Image
            Log::info('[' . $this->image->slug . ']Creating zoomify image...');
            Storage::deleteDirectory(config('filesystems.image_dir_path_without_app') . $this->image->slug);
            // $zoomify = new Zoomify(['processor' => 'GD']);
            // $result = $zoomify->process(
            //     storage_path(config('filesystems.temp_images_dir_path'). $this->path),
            //     storage_path(config('filesystems.image_tiles_dir_path'). $this->image->slug));
            $output_options = ['layout' => 'zoomify'];
            $srcpath = storage_path(config('filesystems.temp_images_dir_path') . $this->path);
            $dstpath = storage_path(config('filesystems.image_tiles_dir_path') . $this->image->slug);
            $im = Vips\Image::newFromFile($srcpath, ['access' => 'VIPS_ACCESS_RANDOM']);
            $im->dzsave($dstpath, $output_options);
            unset($im);
            Log::info('[' . $this->image->slug . ']Done zoomify image!');
            // Preview Image
            Log::info('[' . $this->image->slug . ']Creating preview image...');

            // $img = InterventionImage::make(storage_path(config('filesystems.temp_images_dir_path') . $this->path))
            //     ->fit(350, 230)
            //     ->save(storage_path($this->thumbnailUrl));
            // $img->destroy();

            $thumb = Vips\Image::newFromFile($srcpath, ['access' => 'VIPS_ACCESS_SEQUENTIAL']);
            $thumb_im = Vips\Image::thumbnail_image($thumb, 350, ['crop' => 'VIPS_INTERESTING_CENTRE']);
            $thumb_im->jpegsave(storage_path($this->thumbnailUrl)); // Note that this image save on LOCAL not on AWS S3

            unset($thumb);
            unset($thumb_im);

            Log::info('[' . $this->image->slug . ']Done preview image!');

            // Save information of zoomify xml
            Log::info('[' . $this->image->slug . ']Saving zoomify data in images_zoomify table...');
            $xml = simplexml_load_file(
                storage_path(config('filesystems.image_tiles_dir_path') . $this->image->slug . '/ImageProperties.xml')
            );

            $imageZoomify = ImageZoomify::where('image_id', $this->image->id)->first();
            $imageZoomify = $imageZoomify ?? new ImageZoomify();
            $imageZoomify->image_id = $this->image->id;
            $imageZoomify->width = $xml->attributes()['WIDTH'];
            $imageZoomify->height = $xml->attributes()['HEIGHT'];
            $imageZoomify->numimages = $xml->attributes()['NUMIMAGES'];
            $imageZoomify->numtiles = $xml->attributes()['NUMTILES'];
            $imageZoomify->version = $xml->attributes()['VERSION'];
            $imageZoomify->tilesize = $xml->attributes()['TILESIZE'];
            $imageZoomify->save();
            Log::notice('[' . $this->image->slug . ']Done zoomify data in images_zoomify table!');

            ImageJobsHelper::process_timer_end($this->time_start, $this->job_name, $this->image->slug);
            
        } catch (Exception $e) {

            $this->image->status_id = 5;
            $this->image->save();
            Log::error('[' . $this->image->slug . ']Error:' . $e->getMessage());
            ImageJobsHelper::process_timer_end($this->time_start, $this->job_name, $this->image->slug);
            error_log("error in zoomify_image() function . $e");
        }
    }

    public function upload_tiles_folder_to_s3()
    {
        $this->time_start_aws = ImageJobsHelper::get_process_timer_start("AWS S3 Upload Dir", $this->image->slug);

        try {
            $img_storage_path = storage_path(config('filesystems.image_tiles_dir_path') . $this->image->slug) ;


            // Remove the old tiles from S3 if exists already
            if( Storage::disk('s3')->exists($img_storage_path)){
                Log::info('[ Image Slug: ' . $this->image->slug . '] Deleting OLD Image Tiles from AWS S3...  [ OLD Image Tiles path : ' . $img_storage_path . ']  ');
                Storage::disk('s3')->deleteDirectory($img_storage_path);
                
                Log::info('[ Image Slug: ' . $this->image->slug . '] Deleting OLD Image Tiles from AWS CloudFront Cache...');
                $cloudFront_result=  CloudFront_client::getClient()->createInvalidation( $this->image->slug , $img_storage_path );
                if( $cloudFront_result['success'] == true){
                    Log::info("[ Image ID:" . $this->image->slug . "] \n invalidation request created: \n " . $cloudFront_result["result"]);
                } else {
                    Log::error("[" . $this->image->slug . "] Error: [ " . $img_storage_path . " ] \n Deleting Image Tiles from AWS CloudFront Cache FAILED \n " . $cloudFront_result["result"]);
                }
            } 

            Log::info('[ Image Slug: ' . $this->image->slug . '] Start to Upload Image Tiles to AWS S3...');
            // Upload new tiles to S3 using the same OLD Image Tiles path
            $client =  S3_client::getClient()->create_upload_dir_promise( $img_storage_path );
        
            if( $client['success'] == true){
                $promise = $client['promise'];
                $promise->then(
                    // $onFulfilled
                    function ($value) {
                        Log::notice("Done upload. The promise was fulfilled." );
                        ImageJobsHelper::process_timer_end($this->time_start_aws, "AWS S3 Upload Dir", $this->image->slug);

                        $this->cleanup_local_images_dir();
                    },
                    // $onRejected
                    function ($reason) {
                        $this->image->status_id = 5;
                        $this->image->save();
                        Log::error("==================== The promise was rejected.  \n" . $reason);
                        ImageJobsHelper::process_timer_end($this->time_start_aws, "AWS S3 Upload Dir", $this->image->slug);
        
                    }
                );
        
                $promise->wait();  // need to wait till the promise finished
            } else {

                $this->image->status_id = 5;
                $this->image->save();
                Log::error("==================== Create promise failed \n" . $client['promise']);
                ImageJobsHelper::process_timer_end($this->time_start_aws, "AWS S3 Upload Dir", $this->image->slug);
            }

        } catch (Exception $e) {

            $this->image->status_id = 5;
            $this->image->save();
            Log::error('[' . $this->image->slug . ']Error in upload_tiles_folder_to_s3():' . $e->getMessage());
            ImageJobsHelper::process_timer_end($this->time_start_aws, "AWS S3 Upload Dir", $this->image->slug);
        }

    }

    public function cleanup_local_images_dir()
    {
        try {
            //
            // error_log("inside cleanup_local_images_dir() function");
             $this->time_start_cleanup_dir = ImageJobsHelper::get_process_timer_start("CleanupLocalImageDirectory", $this->image->slug);

            // Delete temporary image
            Log::info('[' . $this->image->slug . ']Deleting temporary images...');
            File::delete(storage_path(config('filesystems.temp_images_dir_path') . $this->path));
            $files = Storage::allFiles(config('filesystems.temp_images_dir_path'));
            $now = time();
            foreach ($files as $file) {
                $fileFullPath = storage_path(config('filesystems.temp_images_dir_path') . $file);
                if ($now - filemtime($fileFullPath) >= 60 * 60 * 24) { // 1 days
                    File::delete($fileFullPath);
                }
            }
            Log::notice('[' . $this->image->slug . ']Done Deleting temporary images!');

            if(config('filesystems.enable_aws_storage') == true){
                Log::info('[' . $this->image->slug . ']Deleting local images...');

                File::deleteDirectory(storage_path(config('filesystems.image_tiles_dir_path')  . $this->image->slug)); 
                // NOTE 'Storage::deleteDirectory' FAILS on production Rancher+NFS Share !!!!!!! TBC
                // Storage::deleteDirectory(config('filesystems.image_dir_path_without_app')  . $this->image->slug);

                Log::notice('[' . $this->image->slug . ']Done Deleting local images...');
            } 

            ImageJobsHelper::process_timer_end($this->time_start_cleanup_dir, "CleanupLocalImageDirectory", $this->image->slug);

            $this->enable_image();

        } catch (\Exception $e) {

            $this->image->status_id = 5;
            $this->image->save();
            Log::error('[' . $this->image->slug . ']Error in cleanup_local_images_dir():' . $e->getMessage());
            ImageJobsHelper::process_timer_end($this->time_start_cleanup_dir, "CleanupLocalImageDirectory", $this->image->slug);
        }
    }

    public function enable_image()
    {
        try {
             
            $this->time_start_enable_image = ImageJobsHelper::get_process_timer_start("EnableImage", $this->image->slug);
            
            // Enable image
            Log::info('[' . $this->image->slug . ']Enabling image for user...');
            $category=Category::find($this->image->category_id);
            if($category->status_id == 1 || $category->status_id == 2){ // if the category is disabled, then the image should be disable as well. Vice versa.
                $this->image->status_id = $category->status_id;
            } else {
                $this->image->status_id = 1;
            }

            if (config('filesystems.enable_aws_storage') == true) {
                $this->image->path = '/' . $this->image->slug ;
                $this->image->thumbnail = '/' . $this->image->slug . '/preview' . config('filesystems.image_extension');
            }
            
            $this->image->save();
            Log::notice("[" . $this->image->slug . "]Done enabling image for user!\n");
            ImageJobsHelper::process_timer_end($this->time_start_enable_image, "EnableImage", $this->image->slug);

        } catch (Exception $e) {

            $this->image->status_id = 5;
            $this->image->save();
            Log::error('[' . $this->image->slug . ']Error in enable_image():' . $e->getMessage());
            ImageJobsHelper::process_timer_end($this->time_start_enable_image, "EnableImage", $this->image->slug);
        }
    }
    

    /**
     * Execute the job.
     *
     * @return void
     */
    public function handle()
    {
        set_time_limit(7200); //7200 seconds

        $this->zoomify_image();

        if(config('filesystems.enable_aws_storage') == true){
            $this->upload_tiles_folder_to_s3();
        } else {
            $this->cleanup_local_images_dir();
        }
    }
}
