@extends('layouts.app')
@section('title', $tableTitle . ' | Corgi')
@section('description', $tableDescription)

@section('content')

    @component('breadcrumb', ['links' => $breadCrumb])@endcomponent

    <manage-table 
        title="{{$tableTitle}}"
        description="{{$tableDescription}}"
        :disableaddsearch = "true"
        :headers="[
        {label: 'ID',           sortable: false,  type: 'number', width: '50px' },
        {label: 'Email',           sortable: false,  type: 'string', width: '100px'},
        {label: 'Name',         sortable: false,  type: 'string', width: '200px'},
        {label: 'Role', sortable: false,  type: 'string', width: '130px'},
        {label: 'Last Access',  sortable: false,  type: 'string', width: '70px'},
        {label: 'Programs',     sortable: false,  type: 'string', width: '200px'},
        ]"
    >

        <template v-slot:table-content="props">
            @foreach ($access_list as $access)
            <tr class="md-table-row">

                <td class="md-table-cell md-numeric">
                    <div class="md-table-cell-container">{{ $access->id }}</div>
                </td> 
                <td class="md-table-cell">
                    <div class="md-table-cell-container">{{ $access->email }}</div>
                </td> 
                <td class="md-table-cell">
                    <div class="md-table-cell-container">{{ is_null($access->display_name) ? ucwords(str_replace("_"," ",$access->cn)) : $access->display_name }}</div>
                </td> 
                <td class="md-table-cell">
                    <div class="md-table-cell-container">{{ $access->role_name }}</div>
                </td>
                <td class="md-table-cell">
                    <div class="md-table-cell-container">{{ is_null($access->last_access_time) ? null : date_format(new DateTime($access->last_access_time),'Y/m/d H:i:s')  }}</div>
                </td>
                <td class="md-table-cell">
                    <div class="md-table-cell-container">{{ html_entity_decode(str_replace(',', ' &#9679; ', $access->programs))  }}</div>
                </td>

            </tr>
            @endforeach
        </template>
        <template v-slot:table-pagination="props">
            {{ $access_list->onEachSide(2)->appends(request()->input())->links()}}    
        </template>
    </manage-table>

@endsection