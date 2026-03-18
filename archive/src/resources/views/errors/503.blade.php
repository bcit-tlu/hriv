@extends('layouts.app')
@section('title', 'Corgi Maintenance')
@section('description', 'Corgi')
@section('code', '503')
@section('message', __($exception->getMessage() ?: 'Service Unavailable'))

@section('content')
 
<article style="padding: 125px; font: 20px Helvetica, sans-serif; color: #333; display: block; text-align: left; width: 1000px; margin: 0 auto;">
<h1 style="font-size: 50px; ">We&rsquo;ll be back soon!</h1>
    <div>
        <p>Sorry for the inconvenience but we&rsquo;re performing some maintenance at the moment. 
        <br>If you need to you can always <a href="mailto:vsm_team@bcit.ca" style="color: #dc8100; text-decoration: none;"><u>contact us</u></a>, otherwise we&rsquo;ll be back online shortly!</p>
        <p>&mdash; VSM Team</p>
    </div>
    
</article>

@endsection