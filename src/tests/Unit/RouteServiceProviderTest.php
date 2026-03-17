<?php

namespace Tests\Unit;

use PHPUnit\Framework\TestCase;
use ReflectionClass;
use ReflectionMethod;

class RouteServiceProviderTest extends TestCase
{
    /**
     * Verify RouteServiceProvider no longer uses the deprecated $namespace
     * property or map() method pattern (Laravel 8+).
     */
    public function test_no_deprecated_namespace_property(): void
    {
        $reflection = new ReflectionClass(\App\Providers\RouteServiceProvider::class);

        $ownProperties = array_filter(
            $reflection->getProperties(),
            fn($p) => $p->getDeclaringClass()->getName() === \App\Providers\RouteServiceProvider::class
        );
        $ownPropertyNames = array_map(fn($p) => $p->getName(), $ownProperties);

        $this->assertNotContains(
            'namespace',
            $ownPropertyNames,
            'RouteServiceProvider must not declare the deprecated $namespace property'
        );
    }

    /**
     * Verify the deprecated map(), mapWebRoutes(), mapApiRoutes() methods
     * are no longer defined on the provider.
     */
    public function test_no_deprecated_map_methods(): void
    {
        $reflection = new ReflectionClass(\App\Providers\RouteServiceProvider::class);

        $ownMethods = array_filter(
            $reflection->getMethods(),
            fn($m) => $m->getDeclaringClass()->getName() === \App\Providers\RouteServiceProvider::class
        );
        $ownMethodNames = array_map(fn($m) => $m->getName(), $ownMethods);

        $this->assertNotContains('map', $ownMethodNames, 'Should not define deprecated map() method');
        $this->assertNotContains('mapWebRoutes', $ownMethodNames, 'Should not define deprecated mapWebRoutes()');
        $this->assertNotContains('mapApiRoutes', $ownMethodNames, 'Should not define deprecated mapApiRoutes()');
    }

    /**
     * Verify the boot() method exists with the modern route registration pattern.
     */
    public function test_boot_method_exists(): void
    {
        $reflection = new ReflectionClass(\App\Providers\RouteServiceProvider::class);

        $this->assertTrue(
            $reflection->hasMethod('boot'),
            'RouteServiceProvider must define a boot() method'
        );

        $boot = $reflection->getMethod('boot');
        $this->assertEquals(
            \App\Providers\RouteServiceProvider::class,
            $boot->getDeclaringClass()->getName(),
            'boot() must be defined on App\Providers\RouteServiceProvider'
        );
    }
}
