<?php

namespace App;

use Illuminate\Database\Eloquent\Model;

use App\User;
use App\Image;
use App\Category;

class Admin_program extends Model
{
    protected $table = 'admin_programs';

    protected $fillable = ['cn', 'display_name'];

    /**
     * @return \Illuminate\Database\Eloquent\Relations\BelongsToMany
     */
    public function users()
    {
        return $this->belongsToMany(User::class);
    }

    public function images()
    {
    	return $this->hasMany(Image::class);
    }

    public function categories()
    {
    	return $this->hasMany(Category::class);
    }
}
