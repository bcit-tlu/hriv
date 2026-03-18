<?php

namespace App;

use Config;
use Illuminate\Support\Facades\Auth;
use Illuminate\Notifications\Notifiable;
use Illuminate\Contracts\Auth\MustVerifyEmail;
use Illuminate\Foundation\Auth\User as Authenticatable;

use LdapRecord\Laravel\Auth\HasLdapUser;
use LdapRecord\Laravel\Auth\LdapAuthenticatable;
use LdapRecord\Laravel\Auth\AuthenticatesWithLdap;
use App\AuthPolicy;
use App\LdapMember;
use App\Admin_program;
use Carbon\Carbon;
use Illuminate\Support\Facades\Log;

class User extends Authenticatable implements LdapAuthenticatable
{
    use Notifiable, HasLdapUser, AuthenticatesWithLdap;

    /**
     * The attributes that are mass assignable.
     *
     * @var array
     */
    protected $fillable = [
        'auth_policy_id', 'username', 'name', 'email', 'objectguid', 'domain'
    ];

    /**
     * Get the database column name for the LDAP guid (LdapRecord).
     */
    public function getLdapGuidColumn(): string
    {
        return 'objectguid';
    }

    /**
     * The attributes that should be hidden for arrays.
     *
     * @var array
     */
    protected $hidden = [
        'password',
    ];

    /**
     * @return \Illuminate\Database\Eloquent\Relations\BelongsToMany
     */
    public function admin_programs()
    {
        return $this->belongsToMany(Admin_program::class);
    }

    public static function get_linked_admin_programs($user = null)
    {
        if(!$user){
            $user = Auth::user();
        }

        if(User::isSuperAdmin($user)){
            // get all admin_programs list
            return Admin_program::all()->pluck('display_name','id')->all();
        } else {
            // get only the linking admin_programs list
            return $user->admin_programs()->select('admin_programs.id','admin_programs.display_name')->pluck('display_name','id')->all();
        }
    }

    public function sync_admin_programs($ids)
    {
        $existing_ids = $this->admin_programs()->pluck('admin_programs.id');

        // remove old missing admin_programs. e.g. no longer in the admin_programs
        if(!empty($existing_ids->diff($ids))){
            $this->admin_programs()->detach($existing_ids->diff($ids));
        }
        // add new linked admin_programs
        if(!empty($ids->diff($existing_ids))){
            $this->admin_programs()->attach($ids->diff($existing_ids));
        }
        
    }

    public static function isSuperAdmin($user = null, $ldapGroups = null) // Note that $user and $ldapGroups are optional variables here
    {
        if(env('APP_ENV') == 'dev')
        {
            return true;
        }
        
        // get all super admin cn list from ldap_members table
        $super_adminCn = AuthPolicy::where('name', 'super_administrator')
        ->first()
        ->ldapMember()->pluck('cn')->toArray();

        if(!$user){
            $user = Auth::user();
        }

        if(!$ldapGroups){
            // get account cn list from LDAP via LdapRecord
            $ldapGroups = self::getLdapMembers($user->ldap);
        }

        if($ldapGroups){
            return !empty(array_intersect($ldapGroups, $super_adminCn));
        } else {
            return false;
        }
    }

    public static function isAdmin() 
    {

        if(env('APP_ENV') == 'dev')
        {
            return true;
        }

        // get all admin cn list from ldap_members table
        $adminCn = AuthPolicy::where('name', 'administrator')
                    ->first()
                    ->ldapMember()->pluck('cn')->toArray();

        $user = Auth::user();
        // get account cn list from LDAP via LdapRecord
        $ldapGroups = self::getLdapMembers($user->ldap);

        if($ldapGroups){

            if(self::isSuperAdmin($user , $ldapGroups)){ // check if is super admin
                return true;
            }elseif(!empty(array_intersect($ldapGroups, $adminCn))){ // check if is admin
                // Check and sync the admin program with LDAP cn
                if( config('ldap.always_sync') == true || $user->isLastLdapCnCheckTimePassed24Hours()){
                    $all_admin_programs_cn = Admin_program::all()->pluck('cn')->toArray();
                    $intersect_array = array_intersect($ldapGroups, $all_admin_programs_cn);
                    $intersect_admin_programs_ids = Admin_program::select()->whereIn('cn',array_values($intersect_array))->pluck('id');
                    $user->sync_admin_programs($intersect_admin_programs_ids);
                    $user->saveLastLdapCnCheckTime();
                 }
                return true;
            } else { // else is student or regular user
                return false;
            }
        } else {
            return false;
        }
    }

    public static function saveLastLoginTime($user) 
    {
        $user->last_login_at = date('Y-m-d H:i:s');
        $user->save();
    }

    public function saveLastLdapCnCheckTime() 
    {
        $this->last_ldap_cn_check_at = date('Y-m-d H:i:s');
        $this->save();
    }

    public function isLastLdapCnCheckTimePassed24Hours() 
    {
        if(is_null($this->last_ldap_cn_check_at)) {
            return true;
        } else {
            return (Carbon::now()->timestamp >= Carbon::parse($this->last_ldap_cn_check_at)->addHours(24)->timestamp);
        }
    }

    public static function isValidUser($user) 
    {
        if(env('APP_ENV') == 'dev')
        {
            return true;
        }

        $validUsers = LdapMember::pluck('cn')->toArray();

        $ldapGroups = self::getLdapMembers($user);

        if($ldapGroups)
            return !empty(array_intersect($ldapGroups, $validUsers)); 
        return false;

    }

    /**
     * Extract group/member CN list from an LdapRecord model.
     *
     * @param \LdapRecord\Models\Model|null $ldapData
     * @return array|null
     */
    private static function getLdapMembers($ldapData) {

        if (!$ldapData) {
            return null;
        }

        $memberOf = $ldapData->getFirstAttribute('memberof')
            ? $ldapData->getAttribute('memberof')
            : [];

        if(!empty($memberOf)){

            $ldapGroups = $memberOf;
            $ldapGroups[] = $ldapData->getDn();
            $result=array_map(
                function($item){ return preg_replace('/(CN=)(.*?)(,.*)/', '$2', $item); }, 
                $ldapGroups
            );

            $mail = $ldapData->getFirstAttribute('mail');
            if ($mail) {
                array_push($result, $mail);
            }
            return $result;
        }

        return null;

    }
}
