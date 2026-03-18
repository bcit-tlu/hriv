<?php

namespace Tests\Unit;

use PHPUnit\Framework\TestCase;
use ReflectionMethod;

class ExceptionHandlerTest extends TestCase
{
    /**
     * Verify that the Exception Handler report() method accepts Throwable
     * instead of the legacy Exception type (required since Laravel 7+).
     */
    public function test_report_accepts_throwable(): void
    {
        $method = new ReflectionMethod(\App\Exceptions\Handler::class, 'report');
        $param = $method->getParameters()[0];

        $this->assertNotNull($param->getType(), 'report() parameter must have a type hint');
        $this->assertEquals('Throwable', $param->getType()->getName());
    }

    /**
     * Verify that the Exception Handler render() method accepts Throwable
     * instead of the legacy Exception type (required since Laravel 7+).
     */
    public function test_render_accepts_throwable(): void
    {
        $method = new ReflectionMethod(\App\Exceptions\Handler::class, 'render');
        $params = $method->getParameters();

        // Second parameter should be Throwable
        $this->assertNotNull($params[1]->getType(), 'render() second parameter must have a type hint');
        $this->assertEquals('Throwable', $params[1]->getType()->getName());
    }
}
