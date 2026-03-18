@extends('layouts.app')
@section('title', 'Login Corgi')
@section('description', 'Corgi')

@section('content')

<div class="md-layout md-alignment-center-center md-layout-nowrap md-gutter md-login-form">
    <div class="md-layout-item">
        <md-card>
            <md-card-content>
                <form novalidate method="POST" action="{{ route('login') }}">
                    @csrf
                    <md-card-header>
                        <div class="md-title">
                            <img src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxNDcuNiAxMzMuNiI+PHN0eWxlIHR5cGU9InRleHQvY3NzIj4uc3Qwe2ZpbGw6IzAwM0U2Qjt9LnN0MXtmaWxsOiNGRkZGRkY7fTwvc3R5bGU+PHJlY3QgY2xhc3M9InN0MCIgd2lkdGg9IjEzMy41IiBoZWlnaHQ9IjEzMy42Ii8+PHBhdGggY2xhc3M9InN0MCIgZD0iTTEzNi4yIDkuNlYyLjVoLTEuN1YxaDUuMXYxLjVoLTEuN3Y3LjFIMTM2LjJ6TTE0NiA5LjZ2LTZoMGwtMS4zIDZoLTEuMmwtMS40LTZoMHY2aC0xLjVWMWgyLjNsMS4yIDUuNGgwbDEuMy01LjRoMi4ydjguNkgxNDZ6Ii8+PHBhdGggY2xhc3M9InN0MSIgZD0iTTI1LjQgODguN2M4LjkgMCAxNS44LTIuNiAxNS44LTEzLjIgMC01LjItMS45LTkuMS03LTEwLjl2LTAuMWMzLjgtMS43IDUuOS00LjkgNS45LTkuNyAwLTguNS00LjgtMTEuOS0xNS4zLTExLjlIMTMuNXY0NS45SDI1LjR6TTY3LjQgNzNjLTEgNi4zLTMuMSA5LjUtNi44IDkuNSAtNC45IDAtNy00LjMtNy0xN0M1My42IDUzLjkgNTYgNDkgNjAuNyA0OWMzLjQgMCA1LjQgMi45IDYuMyA4LjdsNy0wLjZjLTEuMS05LjMtNC43LTE0LjgtMTMuNS0xNC44IC0xMC45IDAtMTQuNyAxMC4xLTE0LjcgMjMuMyAwIDE0LjggMy42IDIzLjcgMTQuNiAyMy43IDguNCAwIDEyLjYtNS4zIDE0LjEtMTUuNUw2Ny40IDczek04OC41IDg4LjdWNDIuOGgtNy42djQ1LjlIODguNXpNMTExLjcgODguN3YtMzloOS41di02LjlIOTQuN3Y2LjloOS41djM5SDExMS43eiIvPjxwYXRoIGNsYXNzPSJzdDAiIGQ9Ik0yMC45IDYxLjhWNDkuNmg0LjJjMy43IDAgNy4zIDAuOSA3LjMgNS44IDAgNS0zLjQgNi41LTcuMyA2LjVIMjAuOXpNMjAuOSA4MS45VjY4aDVjNSAwIDcuNSAyIDcuNSA3IDAgNS0yLjMgNi44LTcuNiA2LjhIMjAuOXoiLz48L3N2Zz4=" alt="BCIT" height=60/> Login</div>
                        @if (session('message'))
                        <div class="md-subhead">{{ session('message') }}</div>
                        @endif
                    </md-card-header>
                    <md-field>
                        <label for="username">username@bcit.ca / username@my.bcit.ca</label>
                        <md-input type="text" name="username" id="username" required autofocus/>
                        <span class="md-error">The email is required</span>
                        <span class="md-error">Invalid email</span>
                    </md-field>
                    <md-field>
                        <label for="password">Password</label>
                        <md-input type="password" name="password" id="password" required autocomplete="current-password"/>
                        <span class="md-error">The email is required</span>
                        <span class="md-error">Invalid email</span>
                    </md-field>
                    <md-card-actions>
                        <md-button type="submit" class="md-primary" >Login</md-button>
                    </md-card-actions>
                </form>
            </md-card-content>
            <md-card-media>
                <img src="/images/login.jpg" alt="Login" height="328" width="400" />
            </md-card-media>
        </md-card>
    </div>    
</div>


@endsection
