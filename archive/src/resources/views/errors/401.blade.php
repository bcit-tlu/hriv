@extends('errors::minimal', ['message' => '401 ' . __('Unauthorized')])

@section('title', __('Unauthorized'))
@section('code', '401')
@section('message', __('Unauthorized'))
