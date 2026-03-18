@extends('layouts.app')
@section('title', $tableTitle . ' | Corgi')
@section('description', $tableDescription)

@section('content')

    @component('breadcrumb', ['links' => ['Home' => '/', 'Images' => '']])@endcomponent


    <manage-table
        title="{{$tableTitle}}"
        description="{{$tableDescription}}"
        :headers="[
            { label: 'ID',       sortable: true,  type: 'number', width: '30px' },
            { label: 'Name',     sortable: true,  type: 'string', width: '200px'},
            { label: 'Copyright', sortable: true,  type: 'string', width: '200px'},
            { label: 'Category', sortable: true,  type: 'string', width: '200px'},
            { label: 'Status',   sortable: true,  type: 'string', width: '70px' },
            { label: 'Modified', sortable: true,  type: 'date',   width: '70px' },
            { label: 'Program',  sortable: false, type: 'string', width: '150px'},
            { label: 'Actions',  sortable: false, type: 'date',   width: '350px'}
        ]"
        @if (!empty($linkedAdminPrograms))
        :buttonaddedit="{
            enable: true,
            label: 'Add',
            title: 'Add New Image',
            href: '{!! route('image-add') !!}',
        }"
        @endif
    >
        <template v-slot:table-content="props">
            @foreach ($images as $image)
            <tr class="md-table-row">
                <td class="md-table-cell md-numeric">
                    <div class="md-table-cell-container">{{ $image->id }}</div>
                </td>
                <td class="md-table-cell">
                    <div class="md-table-cell-container">{{ $image->name }}</div>
                </td>
                <td class="md-table-cell">
                    <div class="md-table-cell-container">{{ $image->image_source_name }}</div>
                </td>
                <td class="md-table-cell">
                    <div class="md-table-cell-container">{{ $image->category_name}}</div>
                </td>
                <td class="md-table-cell">
                    <div class="md-table-cell-container md-alignment-center">{{ $image->status_name}}</div>
                </td>
                <td class="md-table-cell">
                    <div class="md-table-cell-container md-alignment-center">{{ $image->updated_at->format('Y/m/d H:i:s') }}</div>
                </td>
                <td class="md-table-cell">
                    <div class="md-table-cell-container">{{ $image->admin_program_display_name }}</div>
                </td> 
                <td class="md-table-cell">
                    <div class="md-table-cell-container">
                        <a v-if= "{{ ($image->editable && ($image->status_name == 'Enabled' || $image->status_name == 'Disabled' || $image->status_name == 'Error')) ? 'true' : 'false' }}"
                            href="{{ route('image-edit', ['id' => $image->id]) }}" 
                            class="md-button md-theme-default md-table-button">
                            <i class="fa fa-edit"></i>
                            Edit
                        </a>

                        <a v-if= "{{ ($image->status_name == 'Enabled' || $image->status_name == 'Disabled') ? 'true' : 'false' }}"
                            href="{{ route('image-detail', ['slug' => $image->slug]) }}"
                            class="md-button md-theme-default md-table-button"
                            target="_blank">
                            <i class="fa fa-search"></i>
                            View
                        </a>

                        <a v-if= "{{ ($image->editable && ($image->status_name == 'Enabled' || $image->status_name == 'Disabled' || $image->status_name == 'Error')) ? 'true' : 'false' }}" @click.prevent="props.deleteModal('Confirm Delete', 'Do you want to delete the image <strong>{{ $image->name }}</strong>?', '{{ route('image-delete') }}', {{ $image->id }})"
                            class="md-button md-theme-default md-table-button"
                            :image-id={{ $image->id }}>
                            <i class="fa fa-trash-alt"></i>
                            Delete
                        </a>
                    </div>
                </td>
            </tr>
            @endforeach
        </template>
        <template v-slot:table-pagination="props">
            {{ $images->onEachSide(2)->appends(request()->input())->links()}}
        </template>
    </manage-table>
@endsection
