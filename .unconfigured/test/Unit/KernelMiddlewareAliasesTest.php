<?php

namespace Tests\Unit;

use PHPUnit\Framework\TestCase;
use ReflectionClass;

class KernelMiddlewareAliasesTest extends TestCase
{
    /**
     * Verify that the Http Kernel uses $middlewareAliases instead of the
     * deprecated $routeMiddleware property (renamed in Laravel 9+).
     */
    public function test_uses_middleware_aliases_property(): void
    {
        $reflection = new ReflectionClass(\App\Http\Kernel::class);

        $this->assertTrue(
            $reflection->hasProperty('middlewareAliases'),
            'Kernel must define $middlewareAliases (Laravel 9+ naming)'
        );

        // Ensure our App\Http\Kernel class itself does not declare $routeMiddleware
        // (the parent framework class may still have it for backward compat)
        $ownProperties = array_filter(
            $reflection->getProperties(),
            fn($p) => $p->getDeclaringClass()->getName() === \App\Http\Kernel::class
        );
        $ownPropertyNames = array_map(fn($p) => $p->getName(), $ownProperties);

        $this->assertNotContains(
            'routeMiddleware',
            $ownPropertyNames,
            'App\Http\Kernel must not declare the deprecated $routeMiddleware property'
        );
    }

    /**
     * Verify expected middleware aliases are registered.
     */
    public function test_expected_aliases_registered(): void
    {
        $reflection = new ReflectionClass(\App\Http\Kernel::class);
        $property = $reflection->getProperty('middlewareAliases');
        $property->setAccessible(true);

        $instance = $reflection->newInstanceWithoutConstructor();
        $aliases = $property->getValue($instance);

        $expected = ['auth', 'guest', 'throttle', 'administrator', 'checkmaintenance'];
        foreach ($expected as $alias) {
            $this->assertArrayHasKey($alias, $aliases, "Missing middleware alias: {$alias}");
        }
    }
}
