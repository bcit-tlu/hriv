<?php

namespace App\Http\Controllers\User;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Pagination\Paginator;
use Illuminate\Validation\Rule;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Storage;

use Config;
use App\Http\Controllers\Controller;
use App\Image;
use App\Category;
use Illuminate\Support\Facades\Auth;
use App\User;
use App\ImageSource;
class ImageController extends Controller
{

    public function index(Request $request)
    {
        Paginator::defaultView('user.pagination');
        $showing = $request->get('showing', 10);

        $showing = $showing > 100 ? 100 : $showing;

        $images = \App\Image::query();
        
        $imageItems = $images->get()->slice($images->paginate($showing)->first()->id, $showing);
        // dd($images->get()); die;
        return view('user.image.index', ['images' => $images->paginate($showing), 'imageItems' => $imageItems]);
    }

    public function image_detail(Request $request) {

        $selectedImageSlug = $request->route('slug');
        // database search to make sure image exists
        $currentImage = Image::where('slug', 'like', $selectedImageSlug)->first();
        $isAdminUser = Auth::user()->isAdmin();

        if($isAdminUser){
            if (!$currentImage || ($currentImage->status_id != 1 && $currentImage->status_id != 2)) {
                Log::info('[' . $selectedImageSlug . '] slug Image record doesn\'t exist');
                return view('user.image.index', ['imageDetail' => null, 'breadCrumb' => ['Home' => '/', 'Not Found' => ''],
                'imageTitle' => 'Not Found', 'imageDescription' => 'Not Found', 'adminRole' => User::isAdmin()]);
            }
        } else {
            if (!$currentImage || $currentImage->status_id != 1) {
                Log::info('[' . $selectedImageSlug . '] slug Image record doesn\'t exist');
                return view('user.image.index', ['imageDetail' => null, 'breadCrumb' => ['Home' => '/', 'Not Found' => ''],
                'imageTitle' => 'Not Found', 'imageDescription' => 'Not Found', 'adminRole' => User::isAdmin()]);
            }
        }
        
        // search the image by slug
        $imageDetail = Image::getImageDetailBySlug($selectedImageSlug);
        $imageDetail->path = (string)$imageDetail->path;

        $breadCrumb = ['Home' => '/'];

        $imageCategorySlug = DB::table('corgi.categories')
            ->join('corgi.images', 'corgi.categories.id', '=', 'corgi.images.category_id')
            ->select('categories.slug')
            ->where('corgi.categories.id', '=', $currentImage->category_id)
            ->first()->slug;
        $imageCategory = Category::where('slug_path', 'like', "%/{$imageCategorySlug}/")->first();

        if ($currentImage) {
            $categoryNameTree = array_values(array_filter(explode("/", $imageCategory->name_path)));
            $categorySlugTree = array_values(array_filter(explode("/", $imageCategory->slug_path)));
            
            $path = "/";
            foreach ($categoryNameTree as $key => $parent) {
                if ($key == count($categoryNameTree)) {
                    $breadCrumb[$parent] = '';
                } else {
                    $path .= rtrim($categorySlugTree[$key], '/') . "/";
                    $breadCrumb[$parent] = $path;
                }
            }
            $breadCrumb[$currentImage->name] = "";
        }

        $imagesource = ImageSource::where('id', $currentImage->image_source_id)->first();

        if ($currentImage->status_id == 2) {
            $currentImageTitle = config('constants.disabled_label') . $currentImage->title;
        } else {
            $currentImageTitle = $currentImage->title;
        }

        return view('user.image.index', [
            'imageDetail' => $imageDetail, 
            'breadCrumb' => $breadCrumb,
            'imageTitle' => $currentImageTitle, 
            'imageDescription' => $currentImage->description, 
            'imageSource' => $imagesource,
            'adminRole' => $isAdminUser]);
    }

}
