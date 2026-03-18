<?php

/*
|--------------------------------------------------------------------------
| Web Routes
|--------------------------------------------------------------------------
|
| Here is where you can register web routes for your application. These
| routes are loaded by the RouteServiceProvider within a group which
| contains the "web" middleware group. Now create something great!
|
 */

Auth::routes([
    'reset' => false,
    'verify' => false,
    'register' => false,
]);

Route::middleware('public')->prefix('detail')->group(function () {
    Route::get('/{slug}/preview', 'ShowPreview')->name('preview');
});

Route::middleware('auth', 'administrator', 'disablepreventback', 'checkmaintenance')->prefix('manage')->group(function () {
    Route::prefix('images')->group(function () {
        Route::get('/', 'Manage\ImageController@index')->name('image-list');
        Route::get('/add', 'Manage\ImageController@add')->name('image-add');
        Route::get('/edit/{id}', 'Manage\ImageController@add')->name('image-edit');
        Route::post('/save', 'Manage\ImageController@save')->name('image-save');
        Route::post('/delete', 'Manage\ImageController@delete')->name('image-delete');
        Route::get('/sort', 'Manage\ImageController@sort')->name('image-sort');
        Route::post('/save-sort-order', 'Manage\ImageController@saveSortOrder')->name('image-save-sort-order');
        Route::get('/get-sources', 'Manage\ImageController@getSources')->name('image-get-sources');
        Route::post('/upload', 'Manage\ImageController@upload')->name('image-upload');
    });

    Route::prefix('categories')->group(function () {
        Route::get('/', 'Manage\CategoryController@index')->name('category-list');
        Route::post('/save', 'Manage\CategoryController@save')->name('category-save');
        Route::post('/delete', 'Manage\CategoryController@delete')->name('category-delete');
        Route::post('/hide', 'Manage\CategoryController@hide')->name('category-hide');
        Route::post('/show', 'Manage\CategoryController@show')->name('category-show');
        Route::post('/search', 'Manage\CategoryController@search')->name('category-search');
    });

    Route::prefix('faq')->group(function () {
        Route::get('/', 'ShowFaq')->name('manage-faq');
    });

    // Route::prefix('access')->group(function () {
    //     Route::get('/', 'Manage\AccessController@index')->name('manage-access');
    // });

    Route::prefix('copyright')->group(function () {
        Route::get('/', 'Manage\CopyrightController@index')->name('manage-copyright');
        Route::post('/save', 'Manage\CopyrightController@save')->name('copyright-save');
        Route::post('/delete', 'Manage\CopyrightController@delete')->name('copyright-delete');
        Route::post('/search', 'Manage\CopyrightController@search')->name('copyright-search');
    });
    
});

Route::middleware('auth', 'disablepreventback', 'checkmaintenance')->prefix('/')->group(function () {
    Route::get('/home', 'User\CategoryController@index')->name('home'); // '/{slug?}' conlif with the last {categorySlug?} route
    Route::get('/contact', 'User\ContactInfoController@index')->name('contact-info');  
    Route::get('/detail/{slug?}', 'User\ImageController@image_detail')->name('image-detail');
    Route::get('/{categorySlug?}', 'User\CategoryController@index')->where('categorySlug', '^[\-a-zA-Z0-9]+\/?([\-a-zA-Z0-9]+\/?)*$')->name('home');
});