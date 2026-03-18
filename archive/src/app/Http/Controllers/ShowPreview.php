<?php

namespace App\Http\Controllers;

use Config;
use Illuminate\Http\Request;

class ShowPreview extends Controller
{
    /**
     * Handle the incoming request.
     *
     * @param  \Illuminate\Http\Request  $request
     * @return \Illuminate\Http\Response
     */
    public function __invoke(Request $request)
    {        

        if(config('filesystems.enable_aws_storage') == true){
            // $redirect_path = config('filesystems.cdnroot') . "/" . config('filesystems.image_tiles_dir_path_with_storage') . $request->slug . "/preview.jpg";
            $redirect_path = config('filesystems.cdnroot') . "/"  . $request->slug . "/preview.jpg";
        } else {
            $redirect_path = config('filesystems.image_tiles_dir_path_with_storage') . $request->slug . "/preview.jpg";
        }

        return redirect($redirect_path);
    }
}
