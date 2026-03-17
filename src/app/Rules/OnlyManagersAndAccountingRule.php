<?php

namespace App\Rules;

use Illuminate\Database\Eloquent\Model as Eloquent;
use LdapRecord\Laravel\Auth\Rule;
use LdapRecord\Models\Model as LdapRecord;

class OnlyManagersAndAccountingRule implements Rule
{
    /**
     * Determines if the user is allowed to authenticate.
     */
    public function passes(LdapRecord $user, ?Eloquent $model = null): bool
    {
        return \App\User::isValidUser($user);
    }
}
