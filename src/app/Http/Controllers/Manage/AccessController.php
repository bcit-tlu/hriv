<?php

namespace App\Http\Controllers\Manage;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use App\Http\Controllers\Controller;
use Illuminate\Pagination\Paginator;
use Illuminate\Support\Facades\Log;
use App\LdapMember;
use App\Ldap\User as LdapUser;

class AccessController extends Controller
{
    public function index(Request $request)
    {
        
        Paginator::defaultView('manage.pagination');

        $showing            = $request->get('showing', 10);
        $showing            = $showing > 100 ? 100 : $showing;
        $breadCrumb         = ['Home' => '/', 'User List' => ''];
        $tableTitle         = 'User List';
        $tableDescription   = 'List of all User Access Policies';

        // update any display_name that is NULL
        $null_display_name_members = LdapMember::select(
            'ldap_members.id',
            'ldap_members.cn',
            'ldap_members.display_name')
            ->whereNull('ldap_members.display_name')
            ->get();

        if(!$null_display_name_members->isEmpty()){
            Log::info("==================== Start updating members with null display_name ====================");
            foreach ($null_display_name_members as $member) {
                // if the account is in A0# format
                if (preg_match('/^A[0-9]+$/', $member->cn)) {

                    // search account info from LDAP using LdapRecord
                    $ldap_result = LdapUser::where('cn', '=', $member->cn)->first();
    
                    if(!is_null($ldap_result) && !is_null($ldap_result->displayname) && count($ldap_result->displayname) > 0){
                        $member->display_name = $ldap_result->displayname[0];
                        $member->save();
                    }
                    
                } else { // else account is a group, use the original cn with whitespace and uppercase first word letter 
                    $member->display_name = ucwords(str_replace("_"," ",$member->cn));
                    $member->save();
                }
            }
            Log::info("==================== End updating members with null display_name ====================\n");
        }

        // get all LdapMember list
        Log::info("==================== Start getting all LdapMember list ====================");
        $access_list = LdapMember::select(
            'ldap_members.id',
            'ldap_members.cn',
            'ldap_members.display_name',
            'auth_policies.display_name AS role_name',
            'users.last_login_at AS last_access_time',
            'users.email')
            ->selectRaw("
            CASE WHEN auth_policies.name = 'administrator' 
            THEN GROUP_CONCAT(admin_programs.display_name ORDER BY admin_programs.id)
            ELSE NULL
            END AS programs")// only admin shows programs
            ->leftjoin('auth_policies', 'auth_policies.id', '=', 'ldap_members.auth_policy_id')
            ->leftjoin('users', 'users.username', '=', 'ldap_members.cn')
            ->leftjoin('admin_program_user', 'admin_program_user.user_id', '=', 'users.id')
            ->leftjoin('admin_programs', 'admin_programs.id', '=', 'admin_program_user.admin_program_id')
            ->groupBy('ldap_members.id')
            ->orderBy('ldap_members.auth_policy_id', 'ASC')
            ->orderBy('ldap_members.id', 'ASC');

        Log::info("==================== End getting all LdapMember list ====================\n");

        return view('manage.access.list', [
            'access_list' => $access_list->paginate($showing),
            'breadCrumb' =>  $breadCrumb, 
            'tableTitle' => $tableTitle, 
            'tableDescription' => $tableDescription,
        ]);

    }
}
