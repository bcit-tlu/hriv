<div class="showing">
    @if ($paginator->firstItem())
    <span>Showing {{ $paginator->firstItem() }} to {{ $paginator->lastItem() }} of {{ $paginator->total() }} rows </span>
    <md-field>
        <md-select 
        v-model="props.pageShowing"
        :value="props.pageShowing"
        @input="value => { props.showing(props.pageShowing) }" md-dense>
            <md-option value="5">5</md-option>
            <md-option value="10">10</md-option>
            <md-option value="50">50</md-option>
            <md-option value="100">100</md-option>
        </md-select> 
    </md-field>
    <span> rows per page</span>
    @else
    <span>No results found</span>
    @endif
</div>
@if ($paginator->hasPages())
    <ul class="pagination" role="navigation">
        {{-- Previous Page Link --}}
        @if ($paginator->onFirstPage())
            <li class="page-item disabled" aria-disabled="true" aria-label="@lang('pagination.first')">
                <span class="page-link" aria-hidden="true">&lsaquo;&lsaquo; <span class="page-link-label">First</span></span>
            </li>
            <li class="page-item disabled" aria-disabled="true" aria-label="@lang('pagination.previous')">
                <span class="page-link" aria-hidden="true">&lsaquo; <span class="page-link-label">Previous</span></span>
            </li>
        @else
            <li class="page-item">
                <a class="page-link" href="{{ str_replace(['&page=1', '?page=1'], '', $paginator->url(1)) }}" rel="prev" aria-label="@lang('pagination.first')">&lsaquo;&lsaquo; <span class="page-link-label">First</span></a>
            </li>
            <li class="page-item">
                <a class="page-link" href="{{ str_replace(['&page=1', '?page=1'], '', $paginator->previousPageUrl()) }}" rel="prev" aria-label="@lang('pagination.previous')">&lsaquo; <span class="page-link-label">Previous</span></a>
            </li>
        @endif

        {{-- Pagination Elements --}}
        @php 
        if($paginator->currentPage() <= 5) {
            $elements = array_slice($elements, -3, 1);   
        } elseif($paginator->currentPage() > $paginator->lastPage() - 4) {
            $elements = array_slice($elements, -1, 1);   
        } else {
            $elements = array_slice($elements, -3, 1);   
        }
        @endphp
        @foreach ($elements as $element)
            {{-- "Three Dots" Separator --}}
            @if (is_string($element))
                <li class="page-item disabled" aria-disabled="true"><span class="page-link">{{ $element }}</span></li>
            @endif

            {{-- Array Of Links --}}
            @if (is_array($element))
                @php 
                if($paginator->currentPage() < 5) {
                    $start = $paginator->currentPage() <= 2 ? 0 : $paginator->currentPage() - 3;
                    $element = array_slice($element, $start, 5, true);   
                } if($paginator->currentPage() > $paginator->lastPage() - 5) {
                    $i = $paginator->lastPage() - $paginator->currentPage();
                    $start = $i <= 2 ? 5 : $i + 3;
                    $element = array_slice($element, -$start, 5, true);   
                }
                @endphp
                @foreach ($element as $page => $url)
                    @if ($page == $paginator->currentPage())
                        <li class="md-card page-item active" aria-current="page"><span class="page-link">{{ $page }}</span></li>
                    @else
                        <li class="page-item"><a class="page-link" href="{{ preg_replace('/[&|\?]page=1(?:&|$)/', '', $url) }}">{{ $page }}</a></li>
                    @endif
                @endforeach
            @endif
        @endforeach

        {{-- Next Page Link --}}
        @if ($paginator->hasMorePages())
            <li class="page-item">
                <a class="page-link" href="{{ $paginator->nextPageUrl() }}" rel="next" aria-label="@lang('pagination.next')"><span class="page-link-label">Next</span> &rsaquo;</a>
            </li>
            <li class="page-item">
                <a class="page-link" href="{{ $paginator->url($paginator->lastPage()) }}" rel="next" aria-label="@lang('pagination.last')"><span class="page-link-label">Last</span> &rsaquo;&rsaquo;</a>
            </li>
        @else
            <li class="page-item disabled" aria-disabled="true" aria-label="@lang('pagination.next')">
                <span class="page-link" aria-hidden="true"><span class="page-link-label">Next</span> &rsaquo;</span>
            </li>
            <li class="page-item disabled" aria-disabled="true" aria-label="@lang('pagination.last')">
                <span class="page-link" aria-hidden="true"><span class="page-link-label">Last</span> &rsaquo;&rsaquo;</span>
            </li>
        @endif
    </ul>
@endif