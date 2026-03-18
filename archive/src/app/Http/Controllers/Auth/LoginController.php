<?php

namespace App\Http\Controllers\Auth;

use Illuminate\Http\Request;
use Illuminate\Foundation\Auth\AuthenticatesUsers;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Log;

use App\Http\Controllers\Controller;
use App\User;
use App\LdapMember;

use Config;

class LoginController extends Controller
{
    /*
    |--------------------------------------------------------------------------
    | Login Controller
    |--------------------------------------------------------------------------
    |
    | This controller handles authenticating users for the application and
    | redirecting them to your home screen. The controller uses a trait
    | to conveniently provide its functionality to your applications.
    |
    */

    use AuthenticatesUsers;

    /**
    * Where to redirect users after login.
    *
    * @var string
    */
    protected $redirectTo = '/';

    /**
    * Create a new controller instance.
    *
    * @return void
    */
    public function __construct()
    {
        $this->middleware(['guest','checkmaintenance'])->except('logout');
    }

    public function login(Request $request)
    {
        $credentials = $request->only(['username', 'password']);
        if (Auth::attempt($credentials)) {
                // Get current user and save the last login time
                $current_user = Auth::user();
                User::saveLastLoginTime($current_user);
                LdapMember::updateDisplayName($current_user->username,$current_user->name);
                return redirect()->intended('/');
            }
        else {
            Log::info("this should not print if pw correct");
        }
        return redirect()->to('login')->withMessage('Username/Password incorrect!!!');
    }

    public function logout(Request $request)
    {
        Auth::logout();
        return response()->json($this->redirectTo);
    }

    public function username()
    {
        return 'username';
    }
}
