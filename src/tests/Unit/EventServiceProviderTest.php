<?php

namespace Tests\Unit;

use PHPUnit\Framework\TestCase;
use ReflectionMethod;

class EventServiceProviderTest extends TestCase
{
    /**
     * Verify EventServiceProvider::boot() does not call parent::boot()
     * (deprecated in Laravel 11). Check by inspecting source code.
     */
    public function test_boot_does_not_call_parent_boot(): void
    {
        $method = new ReflectionMethod(\App\Providers\EventServiceProvider::class, 'boot');
        $file = $method->getFileName();
        $startLine = $method->getStartLine();
        $endLine = $method->getEndLine();

        $lines = array_slice(file($file), $startLine - 1, $endLine - $startLine + 1);
        $source = implode('', $lines);

        $this->assertStringNotContainsString(
            'parent::boot',
            $source,
            'EventServiceProvider::boot() must not call parent::boot() (deprecated in Laravel 11)'
        );
    }

    /**
     * Verify boot() has void return type declaration.
     */
    public function test_boot_has_void_return_type(): void
    {
        $method = new ReflectionMethod(\App\Providers\EventServiceProvider::class, 'boot');
        $returnType = $method->getReturnType();

        $this->assertNotNull($returnType, 'boot() should have a return type');
        $this->assertEquals('void', $returnType->getName());
    }
}
