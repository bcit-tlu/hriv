<?php

namespace App;

use Illuminate\Database\Eloquent\Model;

class Deleted_images_source extends Model
{
    protected $table = 'deleted_images_source';

    protected $fillable = [
        'username', 
        'user_display_name', 
        'item_name', 
        'deleted_at', 
        'admin_program_id',
        'admin_program_display_name',
        'user_data' ,
        'item_data'];
}