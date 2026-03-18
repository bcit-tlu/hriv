@extends('layouts.app')
@section('title', $tableTitle . ' | Corgi')
@section('description', $tableDescription)

@section('content')

    @component('breadcrumb', ['links' => $breadCrumb])@endcomponent

    <manage-table 
        title="{{$tableTitle}}"
        description="{{$tableDescription}}"
        :headers="[
        {label: 'ID',         sortable: true,  type: 'number', width: '30px' },
        {label: 'Name',       sortable: true,  type: 'string', width: '200px'},
        {label: 'Path',       sortable: true,  type: 'string', width: '200px'},
        {label: 'Qty. Items', sortable: true,  type: 'string', width: '30px' },
        {label: 'Modified',   sortable: true,  type: 'date',   width: '70px' },
        {label: 'Program',    sortable: false, type: 'string', width: '150px'},
        {label: 'Actions',    sortable: false, type: 'action', width: '350px'}
        ]"
        @if (!empty($linkedAdminPrograms))
        :modaladdedit="{
            enable: true,
            title: 'Add/Edit Category',
            addtitle: 'Add New Category',
            edittitle: 'Edit Category'
        }"
        @endif
    >
        <template v-slot:modal-form="props">
            <manage-add-category :props="props" :linkedprograms="{{ json_encode($linkedAdminPrograms) }}"></manage-add-category>
        </template>

        <template v-slot:table-content="props">
            @foreach ($categories as $category)
            <tr class="md-table-row">
                <td class="md-table-cell md-numeric">
                    <a href="{{ route('category-list',  ['qid' => $category->id]) }}" title='Click to show the subcategories of the "{{ $category->name }}"'>
                        <div class="md-table-cell-container">{{ $category->id }}</div>
                    </a>
                </td> 
                <td class="md-table-cell">
                    <a href="{{ route('category-list',  ['qid' => $category->id]) }}" title='Click to show the subcategories of the "{{ $category->name }}"'>
                        <div class="md-table-cell-container">
                        @if ($category->status_id == 2)
                            (Disabled) 
                        @endif
                        {{ $category->name }}
                        </div>
                    </a>
                </td> 
                <td class="md-table-cell">
                    <a href="{{ route('category-list',  ['qid' => $category->id]) }}" title='Click to show the subcategories of the "{{ $category->name }}"'>
                        <div class="md-table-cell-container">{{ $category->name_path }}</div>
                    </a>
                </td> 
                <td class="md-table-cell md-numeric">
                    <a href="{{ route('category-list',  ['qid' => $category->id]) }}" title='Click to show the subcategories of the "{{ $category->name }}"'>
                        <div class="md-table-cell-container md-alignment-center">{{ $category->count_items }}</div>
                    </a>
                </td> 
                <td class="md-table-cell">
                    <div class="md-table-cell-container md-alignment-center">{{ $category->updated_at->format('Y/m/d H:i:s') }}</div>
                </td>
                <td class="md-table-cell">
                    <div class="md-table-cell-container">{{ $category->admin_program_display_name }}</div>
                </td> 
                <td class="md-table-cell">
                    <div class="md-table-cell-container">
                        @if ($category->editable)
                        <a href="/" 
                            class="md-button md-theme-default md-table-button" 
                            @click.prevent="props.showModal({{ $category->id }})">
                            <i class="fa fa-edit"></i>
                            Edit
                        </a>
                        @endif
                        <a href="{{ route('home',  ['categorySlug' => $category->slug_path]) }}" 
                            class="md-button md-theme-default md-table-button"
                            target="_blank">
                            <i class="fa fa-search"></i>
                            View
                        </a>

                        @if (($category->status_id == 1 || $category->status_id == 2) && $category->count_items == 0 && $category->editable)
                        <a href="/" 
                            class="md-button md-theme-default md-table-button"
                            @click.prevent="props.deleteModal('Confirm Delete', 'Do you want to delete the category <strong>{{ $category->name }}</strong>?', '{{ route('category-delete') }}', {{ $category->id }})">
                            <i class="fa fa-trash-alt"></i>
                            Delete
                        </a>
                        @endif
         
                        @if ($category->status_id == 1 && $category->editable)
                        <a href="/" 
                            class="md-button md-theme-default md-table-button"
                            @click.prevent="props.disableModal('Confirm Disable', 'Do you want to Disable the category <strong>{{ $category->name }}</strong>?', '{{ route('category-hide') }}' , {{ $category->id }})">
                            <i class="fa fa-eye-slash"></i>
                            Disable
                        </a>
                        @endif
                        @if ($category->status_id == 2 && $category->editable)
                        <a href="/" 
                            class="md-button md-theme-default md-table-button"
                            @click.prevent="props.enableModal('Confirm Enable', 'Do you want to Enable the category <strong>{{ $category->name }}</strong>?', '{{ route('category-show') }}' , {{ $category->id }})">
                            
                            <i class="fas fa-eye"></i>
                            Enable
                        </a>
                        @endif
                        @if ($category->count_images > 1 && $category->editable)
                        <a href="{{ route('image-sort',  ['qid' => $category->id]) }}" 
                            class="md-button md-theme-default md-table-button">
                            <i class="fa fa-sort-amount-up"></i>
                            Sort Images
                        </a>
                        @endif
                    </div>
                </td>
            </tr>
            @endforeach
        </template>
        <template v-slot:table-pagination="props">
            {{ $categories->onEachSide(2)->appends(request()->input())->links()}}    
        </template>
    </manage-table>

@endsection