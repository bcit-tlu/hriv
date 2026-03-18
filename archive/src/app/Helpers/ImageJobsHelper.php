<?php

namespace App\Helpers;

use Illuminate\Support\Facades\Log;

 
// This is a singleton class.
class ImageJobsHelper {
    // Hold the class instance.
    private static $_instance = null;

    // The constructor is private
    // to prevent initiation with outer code.
    private function __construct()
    {
    }
   
    // The object is created from within the class itself
    // only if the class has no instance.
    public static function getClient()
    {
      if (self::$_instance == null)
      {
        self::$_instance = new ImageJobsHelper();
      }
      return self::$_instance;
    }

    public static function get_process_timer_start($job_name, $image_slug){
        Log::info("==================== " . $job_name . " START ==================== \n for Image [". $image_slug . "]");
        return microtime(true);
    }
    public static function process_timer_end($time_start, $job_name, $image_slug){
        $time_end = microtime(true);
        $execution_time = number_format((float) ($time_end - $time_start), 10);
        Log::info("[" . $image_slug . "]" . "Execution time -->" . $execution_time . "\n ==================== " . $job_name . " END ====================\n");
    }    
}