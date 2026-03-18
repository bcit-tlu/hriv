@extends('layouts.app')
@section('title', $tableTitle . ' | Corgi')
@section('description', $tableDescription)

@section('content')

    @component('breadcrumb', ['links' => $breadCrumb])@endcomponent

    <contact-info
        title="{{$tableTitle}}"
        description="{{$tableDescription}}"
    >

    </contact-info>


@endsection