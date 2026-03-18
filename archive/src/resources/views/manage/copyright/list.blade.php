@extends('layouts.app')
@section('title', $tableTitle . ' | Corgi')
@section('description', $tableDescription)

@section('content')

    @component('breadcrumb', ['links' => $breadCrumb])@endcomponent

    <manage-table 
        title="{{$tableTitle}}"
        description="{{$tableDescription}}"
        :headers="[
        {label: 'ID',           sortable: true,  type: 'number', width: '50px' },
        {label: 'Name',         sortable: true,  type: 'string', width: '200px'},
        {label: 'Image Count',  sortable: true,  type: 'number', width: '50px'},
        {label: 'Program',      sortable: true,  type: 'string', width: '150px'},
        {label: 'Modified',     sortable: true,  type: 'date',   width: '70px' },
        { label: 'Actions',     sortable: false, type: 'date',   width: '350px'}
        ]"
        @if (!empty($linkedAdminPrograms))
        :modaladdedit="{
            enable: true,
            title: 'Add/Edit Copyright',
            addtitle: 'Add New Copyright',
            edittitle: 'Edit Copyright'
        }"
        @endif
    >
        <template v-slot:modal-form="props">
            <manage-add-copyright :props="props" :linkedprograms="{{ json_encode($linkedAdminPrograms) }}"></manage-add-copyright>
        </template>

        <template v-slot:table-content="props">
            @foreach ($copyright_list as $copyright)
            <tr class="md-table-row">

                <td class="md-table-cell md-numeric">
                    <div class="md-table-cell-container">{{ $copyright->id }}</div>
                </td> 
                <td class="md-table-cell">
                    <div class="md-table-cell-container">{{ $copyright->name }}</div>
                </td> 
                <td class="md-table-cell md-numeric">
                    <div class="md-table-cell-container">{{ $copyright->count }}</div>
                </td>
                <td class="md-table-cell">
                    <div class="md-table-cell-container">{{ is_null($copyright->cn) ? "Not Found" : ((is_null($copyright->program_name)) ? ucwords(str_replace("_"," ",$copyright->cn)) : $copyright->program_name) }}</div>
                </td>   
                <td class="md-table-cell">
                    <div class="md-table-cell-container">{{ is_null($copyright->modified) ? null : date_format(new DateTime($copyright->modified),'Y/m/d H:i:s')  }}</div>
                </td>

                <td class="md-table-cell">
                    <div class="md-table-cell-container">
                        <a v-if= "{{ ($copyright->editable) ? 'true' : 'false' }}"
                            class="md-button md-theme-default md-table-button" 
                            @click.prevent="props.showModal({{ $copyright->id }})">
                            <i class="fa fa-edit"></i>
                            Edit
                        </a>

                        <a v-if= "{{ ($copyright->editable && $copyright->count == 0 ) ? 'true' : 'false' }}" 
                          @click.prevent="props.deleteModal('Confirm Delete', 'Do you want to delete the copyright <strong>{{ $copyright->name }}</strong>?', '{{ route('copyright-delete') }}', {{ $copyright->id }})"
                            class="md-button md-theme-default md-table-button"
                            :copyright-id={{ $copyright->id }}>
                            <i class="fa fa-trash-alt"></i>
                            Delete
                        </a>
                    </div>
                </td>
                            


            </tr>
            @endforeach
        </template>
        <template v-slot:table-pagination="props">
            {{ $copyright_list->onEachSide(2)->appends(request()->input())->links()}}    
        </template>
    </manage-table>

@endsection