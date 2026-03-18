@extends('layouts.app')
@section('title', 'Learning and Teaching Centre')
@section('description', 'The Learning and Teaching Centre (LTC) designs and develops instructional materials and provides educational technology support.')

@section('content')

    @component('breadcrumb', ['links' => $breadCrumb])@endcomponent

    <user-category-list :items="{{ json_encode($categoriesAndImages->items()) }}">
        <template v-slot:tablepagination="props">
        {{ $categoriesAndImages->onEachSide(2)->appends(request()->input())->links()}}    
      </template>
    </user-category-list>

@endsection
