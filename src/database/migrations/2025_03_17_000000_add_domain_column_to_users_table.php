<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     *
     * LdapRecord's AuthenticatesWithLdap trait expects a "domain" column
     * on the users table (via getLdapDomainColumn()). This column stores
     * the LDAP connection name used to authenticate the user.
     */
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->string('domain')->nullable()->after('objectguid');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->dropColumn('domain');
        });
    }
};
