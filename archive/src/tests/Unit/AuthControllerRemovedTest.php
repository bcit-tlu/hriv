<?php

namespace Tests\Unit;

use PHPUnit\Framework\TestCase;

class AuthControllerRemovedTest extends TestCase
{
    /**
     * Verify that the dead AuthController (which used the removed
     * AuthenticatesAndRegistersUsers trait from Laravel 5.1) has been removed.
     * LoginController handles authentication instead.
     */
    public function test_legacy_auth_controller_removed(): void
    {
        $this->assertFalse(
            file_exists(__DIR__ . '/../../app/Http/Controllers/Auth/AuthController.php'),
            'AuthController file should be removed - it used the deleted AuthenticatesAndRegistersUsers trait'
        );
    }

    /**
     * Verify that LoginController still exists and uses AuthenticatesUsers trait
     * from laravel/ui package.
     */
    public function test_login_controller_exists_with_authenticates_users(): void
    {
        $this->assertTrue(
            class_exists(\App\Http\Controllers\Auth\LoginController::class),
            'LoginController must exist as the active authentication controller'
        );

        $this->assertTrue(
            in_array(
                \Illuminate\Foundation\Auth\AuthenticatesUsers::class,
                class_uses(\App\Http\Controllers\Auth\LoginController::class)
            ),
            'LoginController must use the AuthenticatesUsers trait from laravel/ui'
        );
    }
}
