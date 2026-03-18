<?php

namespace App;

use Illuminate\Database\Eloquent\Model;

class Deleted_image_or_category extends Model
{
    protected $table = 'deleted_images_n_categories';

    protected $fillable = [
        'type', 
        'username', 
        'user_display_name', 
        'item_name', 
        'deleted_at', 
        'admin_program_id',
        'admin_program_display_name',
        'user_data' ,
        'item_data'];

}
