<?php

namespace App\Http\Controllers\User;

use Illuminate\Http\Request;
use App\Http\Controllers\Controller;
use Illuminate\Support\Facades\Log;

class ContactInfoController extends Controller
{
    public function index(Request $request)
    {

        $breadCrumb         = ['Home' => '/', 'Contact' => ''];
        $tableTitle         = 'Contact';
        $tableDescription   = ' ';
        
        return view('user.contact.index', [
                'breadCrumb' =>  $breadCrumb, 
                'tableTitle' => $tableTitle, 
                'tableDescription' => $tableDescription,
            ]
        );

    }
}
