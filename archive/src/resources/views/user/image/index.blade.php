@extends('layouts.app')
@section('title', 'Learning and Teaching Centre')
@section('description', 'The Learning and Teaching Centre (LTC) designs and develops instructional materials and provides educational technology support.')

@if (!is_null($imageDetail))
    @push('scripts')
        <script type="text/javascript" src="{{ asset('zoomify/ZoomifyImageViewerPro-min.js') }}"></script>
        <script type="text/javascript">
        Z.showImage("zoomify-image-container", '{{$imageDetail->path}}',
        "zImageProperties=<IMAGE_PROPERTIES WIDTH='{{$imageDetail->width}}' HEIGHT='{{$imageDetail->height}}' NUMTILES='{{$imageDetail->numtiles}}' NUMIMAGES='{{$imageDetail->numimages}}' VERSION='{{$imageDetail->version}}' TILESIZE='{{$imageDetail->tilesize}}'/>&zSkinPath=/Assets/Skins/Default&zLogoVisible=0&zToolbarVisible=1&zToolbarPosition=0&zNavigatorVisible=1&zNavigatorTop=35&zLogoVisible=0&zPanButtonsVisible=0&zHelpVisible=0&zRotationVisible=2")</script>
    @endpush
@endif

@section('content')
    <!-- $imageSource->name  -->
    @component('breadcrumb', ['links' => $breadCrumb])@endcomponent
    @if (!is_null($imageDetail))
         <user-image-detail imagetitle="{{ $imageTitle }}" image_copyright = "{{ $imageSource->name }}" imagedescription="{{ $imageDescription }}" adminrole="{{ $adminRole }}"></user-image-detail>
    @endif
@endsection
