<?php

namespace App\Http\Middleware;

use Closure;

class AllowPublic
{
    /**
     * Handle an incoming request.
     *
     * @param  \Illuminate\Http\Request  $request
     * @param  \Closure  $next
     * @return mixed
     */
    public function handle($request, Closure $next)
    {
        if ($request->is('detail/*/preview')) {
            return $next($request);
        }
            
        abort(401);       

    }
}
