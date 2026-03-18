<?php

namespace App;

use Monolog\Formatter\JsonFormatter;
use Monolog\LogRecord;

class CustomJsonFormatter extends JsonFormatter
{
    public function format(LogRecord $record): string
    {
        $customizedRecord = [
            'message' => $record->message,
            'record name' => $record->context['name'] ?? null,
            'record id' => $record->context['id'] ?? null,
            'level' => $record->level->getName(),
            'line number' => $record->context['line'] ?? null,
            'file name' => $record->context['file'] ?? null,
            'timestamp' => $record->datetime->format('Y-m-d H:i:s'),
        ];

        return json_encode($customizedRecord, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES) . "\n";
    }
}
