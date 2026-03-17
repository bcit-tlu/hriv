<?php

namespace Tests\Unit;

use PHPUnit\Framework\TestCase;
use ReflectionClass;

class CheckForMaintenanceModeTest extends TestCase
{
    /**
     * Verify that CheckForMaintenanceMode extends PreventRequestsDuringMaintenance
     * instead of the removed CheckForMaintenanceMode base class (Laravel 8+).
     */
    public function test_extends_prevent_requests_during_maintenance(): void
    {
        $reflection = new ReflectionClass(\App\Http\Middleware\CheckForMaintenanceMode::class);
        $parent = $reflection->getParentClass();

        $this->assertNotFalse($parent, 'CheckForMaintenanceMode must extend a parent class');
        $this->assertEquals(
            'Illuminate\Foundation\Http\Middleware\PreventRequestsDuringMaintenance',
            $parent->getName(),
            'Must extend PreventRequestsDuringMaintenance, not the removed CheckForMaintenanceMode'
        );
    }
}
