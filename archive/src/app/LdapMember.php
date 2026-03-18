<?php

namespace App;

use Illuminate\Database\Eloquent\Model;

class LdapMember extends Model
{
    
    /**
     * Get the post that owns the comment.
     */
    public function authPolicy()
    {
        return $this->belongsTo('App\AuthPolicy', 'auth_policy_id', 'id');
    }

    public static function updateDisplayName($cn, $diaplay_name)
    {
        $ldapMember = LdapMember::where('cn', '=', $cn)->get()->first();
        if(!is_null($ldapMember)){
            if(is_null($ldapMember->display_name) || strcmp($ldapMember->display_name, $diaplay_name) !== 0 ){
                $ldapMember->display_name = $diaplay_name;
                $ldapMember->save();
            }
        }
    }

}
