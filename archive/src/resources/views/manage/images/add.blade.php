@extends('layouts.app')
@section('title', 'Add Image | Corgi')
@section('description', 'Form to add a new image in the Corgi System.')

@section('content')


    @if ($is_edit)
        @component('breadcrumb', ['links' => ['Home' => '/', 'Images' => route('image-list'), 'Edit Image' => '']])@endcomponent
    @else
        @component('breadcrumb', ['links' => ['Home' => '/', 'Images' => route('image-list'), 'Add Image' => '']])@endcomponent
    @endif

    <manage-add-image 
    imagelisturl="{!! route('image-list') !!}" 
    posturl="{!! route('image-save') !!}" 
    searchcopyrighturl="{!! route('copyright-search') !!}"
    searchcategoryurl="{!! route('category-search') !!}"
    uploadimageurl="{!! route('image-upload') !!}"
    dataform='{!! json_encode($image) !!}'
    is_edit="{{ $is_edit }}"
    :linkedprograms="{{ json_encode($linkedAdminPrograms) }}"
    >
        
    </manage-add-image>
    

@endsection
