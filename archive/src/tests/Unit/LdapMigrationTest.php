<?php

namespace Tests\Unit;

use PHPUnit\Framework\TestCase;
use ReflectionClass;

class LdapMigrationTest extends TestCase
{
    /**
     * Verify User model implements LdapAuthenticatable interface (LdapRecord).
     */
    public function test_user_implements_ldap_authenticatable(): void
    {
        $reflection = new ReflectionClass(\App\User::class);

        $this->assertTrue(
            $reflection->implementsInterface(\LdapRecord\Laravel\Auth\LdapAuthenticatable::class),
            'User must implement LdapRecord LdapAuthenticatable interface'
        );
    }

    /**
     * Verify User model uses LdapRecord traits instead of Adldap2 traits.
     */
    public function test_user_uses_ldaprecord_traits(): void
    {
        $traits = class_uses_recursive(\App\User::class);

        $this->assertArrayHasKey(
            \LdapRecord\Laravel\Auth\HasLdapUser::class,
            $traits,
            'User must use LdapRecord HasLdapUser trait'
        );

        $this->assertArrayHasKey(
            \LdapRecord\Laravel\Auth\AuthenticatesWithLdap::class,
            $traits,
            'User must use LdapRecord AuthenticatesWithLdap trait'
        );

        // Verify old Adldap2 trait is not used
        $traitNames = array_keys($traits);
        foreach ($traitNames as $name) {
            $this->assertStringNotContainsString(
                'Adldap',
                $name,
                "User must not use any Adldap2 traits, found: {$name}"
            );
        }
    }

    /**
     * Verify User model overrides getLdapGuidColumn to return 'objectguid'.
     */
    public function test_user_guid_column_is_objectguid(): void
    {
        $user = (new ReflectionClass(\App\User::class))->newInstanceWithoutConstructor();
        $this->assertEquals('objectguid', $user->getLdapGuidColumn());
    }

    /**
     * Verify the LDAP model class exists and extends ActiveDirectory User.
     */
    public function test_ldap_user_model_exists(): void
    {
        $this->assertTrue(
            class_exists(\App\Ldap\User::class),
            'App\Ldap\User LDAP model must exist'
        );

        $reflection = new ReflectionClass(\App\Ldap\User::class);
        $this->assertTrue(
            $reflection->isSubclassOf(\LdapRecord\Models\ActiveDirectory\User::class),
            'App\Ldap\User must extend LdapRecord ActiveDirectory User'
        );
    }

    /**
     * Verify OnlyManagersAndAccountingRule implements LdapRecord Rule interface.
     */
    public function test_validation_rule_implements_ldaprecord_interface(): void
    {
        $reflection = new ReflectionClass(\App\Rules\OnlyManagersAndAccountingRule::class);

        $this->assertTrue(
            $reflection->implementsInterface(\LdapRecord\Laravel\Auth\Rule::class),
            'OnlyManagersAndAccountingRule must implement LdapRecord Rule interface'
        );

        // Verify it has the correct passes() method signature
        $method = $reflection->getMethod('passes');
        $params = $method->getParameters();

        $this->assertCount(2, $params);
        $this->assertEquals('LdapRecord\Models\Model', $params[0]->getType()->getName());
    }

    /**
     * Verify no Adldap references remain in controllers.
     */
    public function test_no_adldap_references_in_controllers(): void
    {
        $controllerDir = __DIR__ . '/../../app/Http/Controllers';
        $iterator = new \RecursiveIteratorIterator(
            new \RecursiveDirectoryIterator($controllerDir)
        );

        foreach ($iterator as $file) {
            if ($file->isFile() && $file->getExtension() === 'php') {
                $content = file_get_contents($file->getPathname());
                $this->assertStringNotContainsString(
                    'Adldap',
                    $content,
                    "File {$file->getPathname()} still contains Adldap references"
                );
            }
        }
    }

    /**
     * Verify config/app.php uses LdapRecord service providers.
     */
    public function test_app_config_uses_ldaprecord_providers(): void
    {
        $configFile = __DIR__ . '/../../config/app.php';
        $content = file_get_contents($configFile);

        $this->assertStringContainsString(
            'LdapRecord\Laravel\LdapServiceProvider',
            $content,
            'config/app.php must reference LdapRecord service provider'
        );

        $this->assertStringNotContainsString(
            'Adldap\Laravel\AdldapServiceProvider',
            $content,
            'config/app.php must not reference Adldap service provider'
        );
    }
}
