<?php

namespace Tests\Unit;

use PHPUnit\Framework\TestCase;
use ReflectionClass;

class TrustProxiesTest extends TestCase
{
    /**
     * Verify TrustProxies extends the built-in Illuminate middleware
     * instead of the removed Fideloper\Proxy package.
     */
    public function test_extends_illuminate_trust_proxies(): void
    {
        $reflection = new ReflectionClass(\App\Http\Middleware\TrustProxies::class);
        $parent = $reflection->getParentClass();

        $this->assertNotFalse($parent, 'TrustProxies must extend a parent class');
        $this->assertEquals(
            'Illuminate\Http\Middleware\TrustProxies',
            $parent->getName(),
            'TrustProxies must extend Illuminate\Http\Middleware\TrustProxies, not Fideloper\Proxy'
        );
    }

    /**
     * Verify headers property does not use the removed HEADER_X_FORWARDED_ALL constant.
     * It should use individual header constants combined with bitwise OR.
     */
    public function test_headers_use_individual_forwarded_constants(): void
    {
        $reflection = new ReflectionClass(\App\Http\Middleware\TrustProxies::class);
        $property = $reflection->getProperty('headers');
        $property->setAccessible(true);

        $instance = $reflection->newInstanceWithoutConstructor();
        $headers = $property->getValue($instance);

        // HEADER_X_FORWARDED_ALL was removed in Symfony 6. The value should be
        // a combination of individual forwarded header constants.
        $this->assertIsInt($headers, 'Headers must be an integer bitmask');
        $this->assertGreaterThan(0, $headers, 'Headers bitmask must be non-zero');
    }
}
