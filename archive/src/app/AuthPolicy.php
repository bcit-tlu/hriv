<?php

namespace App;

use Illuminate\Database\Eloquent\Model;

class AuthPolicy extends Model
{
    
    /**
     * Get all of the posts for the user.
     */
    public function ldapMember()
    {
        return $this->hasMany('App\LdapMember');
    }

}
