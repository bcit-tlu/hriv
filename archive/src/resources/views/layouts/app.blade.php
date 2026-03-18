<!doctype html>
<html lang="{{ str_replace('_', '-', app()->getLocale()) }}">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="csrf-token" content="{{ csrf_token() }}">

    <title>LTC - @yield('title')</title>
    <meta name="description" content="@yield('description')">

    <link rel="apple-touch-icon" sizes="114x114" href="/images/favicon/apple-touch-icon.png">
    <link rel="icon" type="image/png" sizes="32x32" href="/images/favicon/favicon-32x32.png">
    <link rel="icon" type="image/png" sizes="16x16" href="/images/favicon/favicon-16x16.png">
    <link rel="manifest" href="/images/favicon/site.webmanifest">
    <link rel="mask-icon" href="/images/favicon/safari-pinned-tab.svg" color="#5bbad5">
    <meta name="msapplication-TileColor" content="#2d89ef">
    <meta name="theme-color" content="#ffffff">

    <!-- Styles -->
    <link rel="stylesheet" media="all" href="/css/app.css" />
</head>
<body>
     <div id="app" class="app" v-show="true" style="display: none;">
        <div class="page-container">
            <md-app md-waterfall md-mode="fixed-last">
                <md-app-toolbar class="md-dense md-primary">
                    <div class="md-toolbar-row">
                        <div v-if="menuResponsiveSeen" class="md-toolbar-section-start md-layout-item md-size-10">
                            <md-button class="md-icon-button" @click="menuVisible = !menuVisible">
                                <md-icon>menu</md-icon>
                            </md-button>
                        </div>

                        <div class="md-toolbar-section-start md-layout-item">
                            <span class="md-title"><img src="/images/logo.png" alt="Corgi"/></span>
                        </div>

                        @auth
                        <div v-if="menuSeen" class="md-toolbar-offset md-layout-item md-size-60">
                            <md-menu>
                                <md-button md-menu-trigger href="/" class="md-small-size-15">Home</md-button>
                            </md-menu>
                            @can('administrator')
                            <md-menu md-size="medium" md-align-trigger>
                                <md-button md-menu-trigger>Manage</md-button>
                                <md-menu-content>
                                    <md-menu-item href="{{ route('manage-faq') }}">FAQ</md-menu-item>
                                    <md-menu-item href="{{ route('image-list') }}">Images</md-menu-item>
                                    <md-menu-item href="{{ route('category-list') }}">Categories</md-menu-item>
                                    <md-menu-item href="{{ route('manage-copyright') }}">Copyright</md-menu-item>        
                                    {{-- <md-menu-item href="{{ route('manage-access') }}">User List</md-menu-item>                                    --}}
                                </md-menu-content>
                            </md-menu>
                            @endcan
                            <md-menu>
                                <md-button md-menu-trigger href="{{ route('contact-info') }}" class="md-small-size-15">Contact</md-button>
                            </md-menu>
                        </div>

                        
                        <div v-if="menuSeen" class="md-toolbar-section-end md-layout-item">
                            <a href="{{ route('logout') }}" class="md-button md-theme-default"
                             @click.prevent="logout('{!! route('logout') !!}')">
                                <div class="md-ripple">
                                    <div class="md-button-content">Logout</div> 
                                    <md-button class="md-icon-button">
                                        <md-icon class="far fa-sign-out"></md-icon>    
                                    </md-button>
                                </div>
                            </a>
                        </div>
                        @endauth
                                               
                    </div>
                </md-app-toolbar>

                <md-app-drawer :md-active.sync="menuVisible" v-if="menuResponsiveSeen">
                    <md-toolbar md-elevation="0">Menu</md-toolbar>

                    <md-list>
                        <md-list-item href="/">
                            <span class="md-list-item-text">Home</span>
                        </md-list-item>

                        @can('administrator')
                        <md-list-item md-expand>
                            <span class="md-list-item-text">Manage</span>
                            <md-list slot="md-expand">
                                <md-list-item class="md-inset" href="{{ route('manage-faq') }}">FAQ</md-list-item>
                                <md-list-item class="md-inset" href="{{ route('image-list') }}">Images</md-list-item>
                                <md-list-item class="md-inset" href="{{ route('category-list') }}">Categories</md-list-item>
                                <md-list-item class="md-inset" href="{{ route('manage-copyright') }}">Copyright</md-list-item>
                                {{-- <md-list-item class="md-inset" href="{{ route('manage-access') }}">User List</md-list-item>                                    --}}
                            </md-list>
                        </md-list-item>
                        @endcan

                        @auth
                        <md-list-item href="/" @click.prevent="logout('{!! route('logout') !!}')">
                            <md-icon class="far fa-sign-out"></md-icon>
                            <span class="md-list-item-text">Logout</span>
                        </md-list-item>
                        @endauth
                    </md-list>
                </md-app-drawer>

                <md-app-content>
                    @if(Session::has('maintenance') and Session::get('maintenance')['enable'] )
                        <md-toolbar class="md-toolbar-row md-dense maintenance-message-bar">  
                            <div>
                                <span class="material-icons"> sms_failed </span>
                                {{ Session::get('maintenance')['message']}}
                            </div>
                        </md-toolbar>
                        <br/>
                    @endif

                    @yield('content')
                </md-app-content>
            </md-app>
        </div>
    </div>

    <script src="/js/manifest.js"></script>
    <script src="/js/vendor.js"></script>
    <script src="/js/app.js"></script>
    @stack('scripts')

</body>
</html>
