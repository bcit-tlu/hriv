<?php

namespace App\AWS;

// require 'vendor/autoload.php'; //done in index.php

use Config; 
use Aws\Credentials\Credentials;
use Aws\S3\S3Client;
use Aws\S3\Transfer;
use Aws\Exception\AwsException;
use Aws\S3\Exception;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Facades\Log;
 
// This is a singleton class.
class S3_client {
    // Hold the class instance.
    private static $_instance = null;

    protected $aws_s3_client = null;
    protected $bucket = null;
    protected $dest = null;

    // The constructor is private
    // to prevent initiation with outer code.
    private function __construct()
    {
       // Create an S3 client
      $this->aws_s3_client = new S3Client([
        'region'  => config('aws_config.s3_config.region'),
        'version' => '2006-03-01',
        'credentials'=> new Credentials(config('aws_config.s3_config.key'), config('aws_config.s3_config.secret'))
      ]);
      $this->bucket = config('aws_config.s3_config.bucket');
      $this->dest = 's3://' . $this->bucket;  // The expensive process (e.g.,db connection) goes here.
    }
   
    // The object is created from within the class itself
    // only if the class has no instance.
    public static function getClient()
    {
      if (self::$_instance == null)
      {
        self::$_instance = new S3_client();
      }

      return self::$_instance;
    }

    public function list_all_files(){
      try {
        // API reference
        // https://docs.aws.amazon.com/aws-sdk-php/v3/api/api-s3-2006-03-01.html#listobjects
         $results = $this->aws_s3_client->listObjects([
             'Bucket' => $this->bucket,
             'MaxKeys' => 1000, // this limits the maxmimum amount of file names return.
         ]);

         $final_list = array();
         foreach ($results["Contents"] as $r) {
          array_push($final_list, $r['Key']);
         }
    
         return  $final_list;
      } catch (S3Exception $e) {
          return $e->getMessage() . PHP_EOL;
      }
    }

    public function create_upload_dir_promise($local_source)
    {
      try {
        // API reference
        // https://docs.aws.amazon.com/sdk-for-php/v3/developer-guide/s3-transfer.html

        // Where the files will be transferred to
        $destination = $this->dest . $local_source;

        // Create a transfer object
        $manager = new Transfer(
          $this->aws_s3_client, 
          $local_source, 
          $destination,
          ["concurrency" => 20] // transfer 20 files each batch. Beneficial only for small files.
        );

        // // Initiate the transfer and get a promise
        // // https://github.com/guzzle/promises#quick-start
        return [ 'success' => true, 'promise' => $manager->promise()];
        
      } catch (AwsException $e) {
        return [ 'success' => false, 'promise' => $e];
      }

    }
}