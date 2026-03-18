<?php

namespace App\Http\Controllers\User;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Pagination\Paginator;
use Illuminate\Validation\Rule;

use App\Http\Controllers\Controller;
use App\Category;

class CategoryController extends Controller
{

    public function index(Request $request, $categorySlug = null)
    {
        Paginator::defaultView('user.pagination');
        $showing             = $request->get('showing', 10);
        $q                   = $request->get('q', null);
        $categoriesAndImages = new Category();
        $categorySlug = rtrim($categorySlug, '/');
        
        if ($q) {
            $breadCrumb = ['Home' => '/', 'Search' => ''];
        } elseif ($categorySlug) {
            $breadCrumb = ['Home' => '/'];
            $currentCategory = Category::where('slug_path', 'like', "%/{$categorySlug}/")->first();
            
            if ($currentCategory) {
                $categoryNameTree = array_filter(explode("/", $currentCategory->name_path));
                $categorySlugTree = array_filter(explode("/", $currentCategory->slug_path));

                $path = "/";
                foreach ($categoryNameTree as $key => $parent) {
                    if ($key == count($categoryNameTree)) {
                        $breadCrumb[$parent] = '';
                    } else {
                        $path .= rtrim($categorySlugTree[$key], '/') . "/";
                        $breadCrumb[$parent] = $path;
                    }
                }
                $categorySlug = trim($currentCategory->slug_path, '/'); // this updates the sub category to its full slug path
            }
        }
        else {
            $breadCrumb = ['Home' => ''];
        }
        
        return view('user.category.index', 
            [
                'categoriesAndImages' => $categoriesAndImages->getListAll($categorySlug, $q)->paginate($showing),
                'breadCrumb' => $breadCrumb
        ]);

    }

}
