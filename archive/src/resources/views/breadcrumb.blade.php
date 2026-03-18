<nav class="breadcrumb">
    <div class="nav-wrapper col s12">
        @foreach ($links as $label => $link)
        @if (!empty($link)) <a href="{{$link}}" title="{{$label}}"> @else <span> @endif
            <strong>{{$label}}</strong>
        @if ($link) </a> @else </span> @endif
        @endforeach
    </div>
</nav>