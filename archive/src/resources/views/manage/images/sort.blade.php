@extends('layouts.app')
@section('title', 'Sort Image | Corgi')
@section('description', 'Sort image of one category')

@section('content')
    @component('breadcrumb', ['links' => $breadCrumb])@endcomponent
    <manage-image-sort-list 
    :items="{{ json_encode($images) }}" 
    title="Sort Image" 
    thumnailbaseurl="{{ $thumnailbaseurl }}"
    description="This list represents the order in which the images are displayed to the users in the category <strong>{!! $category->name !!}</strong>.<br><strong>* Click and drag the image to sort the list.</strong>"
    urlsort="{!! route('image-save-sort-order') !!}"></manage-image-sort-list>
@endsection