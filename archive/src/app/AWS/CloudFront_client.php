<?php

namespace App\AWS;

// require 'vendor/autoload.php'; //done in index.php

use Config; 
use Aws\Credentials\Credentials;
use Aws\CloudFront\CloudFrontClient; 
use Aws\Exception\AwsException;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Facades\Log;
 
// This is a singleton class.
class CloudFront_client {
    // Hold the class instance.
    private static $_instance = null;

    protected $aws_cloudfront_client = null;
    protected $distributionId = null;

    // The constructor is private
    // to prevent initiation with outer code.
    private function __construct()
    {
      // https://docs.aws.amazon.com/sdk-for-php/v3/developer-guide/guide_configuration.htm
      // https://docs.aws.amazon.com/cloudfront/latest/APIReference/API_CreateInvalidation.html
      // https://docs.aws.amazon.com/sdk-for-php/v3/developer-guide/cloudfront-example-invalidation.html
      
      // Create an CloudFront client
      $this->aws_cloudfront_client = new CloudFrontClient([
        'region'  => config('aws_config.cloudfront_config.region'),
        'version' => '2018-06-18',
        'credentials'=> new Credentials(config('aws_config.cloudfront_config.key'), config('aws_config.cloudfront_config.secret'))
      ]);
      $this->distributionId = config('aws_config.cloudfront_config.distributionId');
    }
   
    // The object is created from within the class itself
    // only if the class has no instance.
    public static function getClient()
    {
      if (self::$_instance == null)
      {
        self::$_instance = new CloudFront_client();
      }

      return self::$_instance;
    }

    function listInvalidations()
    {
        try {
            $result = $this->aws_cloudfront_client->listInvalidations([
                'DistributionId' => $this->distributionId
            ]);
            return [ 'success' => true, 'result' => $result];
        } catch (AwsException $e) {
            return [ 'success' => false, 'result' => $e->getAwsErrorMessage()];
        }
    }

    function createInvalidation($slug, $s3_file_path)
    {   $callerReference = $slug . "-" . date("Y-m-d-H-i-s");
        $paths=['/' . $slug . '/*',
                $s3_file_path . '/*'];
        try {
            $result = $this->aws_cloudfront_client->createInvalidation([
                'DistributionId' => $this->distributionId,
                'InvalidationBatch' => [
                    'CallerReference' => $callerReference,
                    'Paths' => [
                        'Items' => $paths, 
                        'Quantity' => 2,
                    ],
                ]
            ]);

            $message = '';

            if (isset($result['Location']))
            {
                $message = 'The invalidation location is: ' . 
                    $result['Location'];
            }

            $message .= ' and the effective URI is ' . 
                $result['@metadata']['effectiveUri'] . '.';

            return [ 'success' => true, 'result' => $message];
        } catch (AwsException $e) {
            return [ 'success' => false, 'result' => $e->getAwsErrorMessage()];
        }
    }
  }