<?php

namespace App;

use Illuminate\Database\Eloquent\Model;

class ImageZoomify extends Model
{

    protected $table = 'images_zoomify';

    /**
     * The attributes that are mass assignable.
     *
     * @var array
     */
    protected $fillable = [
        'image_id', 'width', 'height', 'numimages', 'numtiles', 'version', 'tilesize'
    ];

}
