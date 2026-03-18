<?php

use Monolog\Handler\StreamHandler;
use Monolog\Handler\SyslogUdpHandler;

$active_channel;

env('APP_ENV') == 'dev' ? $active_channel = ['localDev_Json', 'Dev'] : $active_channel = ['stderr'];

return [

    /*
    |--------------------------------------------------------------------------
    | Default Log Channel
    |--------------------------------------------------------------------------
    |
    | This option defines the default log channel that gets used when writing
    | messages to the logs. The name specified in this option should match
    | one of the channels defined in the "channels" configuration array.
    |
    */

    'default' => env('LOG_CHANNEL', 'stack'),

    /*
    |--------------------------------------------------------------------------
    | Log Channels
    |--------------------------------------------------------------------------
    |
    | Here you may configure the log channels for your application. Out of
    | the box, Laravel uses the Monolog PHP logging library. This gives
    | you a variety of powerful log handlers / formatters to utilize.
    |
    | Available Drivers: "single", "daily", "slack", "syslog",
    |                    "errorlog", "monolog",
    |                    "custom", "stack"
    |
    */

    'channels' => [
        'stack' => [
            'driver' => 'stack',
            'channels' => $active_channel,
            'ignore_exceptions' => false,
        ],

        // Used in production environment - with json formatter
        'stderr' => [
            'driver' => 'monolog',
            'handler' => StreamHandler::class,
            'formatter' => App\CustomJsonFormatter::class,
            'with' => [
                'stream' => 'php://stderr',
            ],
            'level' => 'notice',
        ],

        // Used in local environment - with json formatter
        'localDev_Json' => [
            'driver' => 'single',
            'formatter' => App\CustomJsonFormatter::class,
            'path' => storage_path('logs/localDev_Json.log'),
            'level' => 'debug',
        ],

        // Used in local environment - with line formatter
        'Dev' => [
            'driver' => 'single',
            'formatter' => Monolog\Formatter\LineFormatter::class,
            'formatter_with' => [
                'dateFormat' => 'Y-m-d H:i:s',
                'format' => "%level_name% | %datetime% >>> %message% | %context.file%:%context.line%\n",
            ],
            'path' => storage_path('logs/Dev.log'),
            'level' => 'debug',
        ],
    ],

];
