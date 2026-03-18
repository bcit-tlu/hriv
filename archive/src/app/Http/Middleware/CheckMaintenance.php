<?php

namespace App\Http\Middleware;


use Closure;
use Carbon\Carbon;
use DB;
use Illuminate\Support\Facades\Cache;
use Exception;
use Illuminate\Support\Facades\Log;



class CheckMaintenance
{
    private function getMaintenanceInfoFromDB(){
        try {
            $value=DB::table('maintenance_info')->latest()->first();
            if( is_null($value) ){
                $value=(object)array("enable"=>false, "message"=>"");
            }
        } catch (Exception $e) {
            Log::critical($e->getMessage());
            $value=(object)array("enable"=>true, "message"=>"Sorry for the inconvenience. Corgi service is unavailable at the moment.");
        }

        return array(
            "enable"=>$value->enable, 
            "message"=>$value->message, 
            "fetch_time"=>Carbon::now()->timestamp
        );
    }

    private function isMaintenanceCheckTimeExpired($maintenance){
        // return (Carbon::now()->timestamp >= Carbon::parse($maintenance["fetch_time"])->addHours(1)->timestamp) ;  // time Expired after 1 hour
        
        return (Carbon::now()->timestamp >= Carbon::parse($maintenance["fetch_time"])->addMinutes(15)->timestamp) ; // time Expired after 15 minutes

        // return (Carbon::now()->timestamp >= Carbon::parse($maintenance["fetch_time"])->addSeconds(3)->timestamp) ; // for testing only, update maintenance every 3 seconds
    }

    private function getAndUpdateMaintenanceInCache($key){
        if (!Cache::has($key)) {
            $maintenance = $this->getMaintenanceInfoFromDB();
            Cache::put($key, $maintenance, now()->addMinutes(15));
            // Cache::put($key, $maintenance, now()->addMinutes(1));
        } else {
            $maintenance = Cache::get($key);
            if( $this->isMaintenanceCheckTimeExpired($maintenance) ){ // if last fetch passed 1 hour, fetch the maintenance info from DB again
                $maintenance = $this->getMaintenanceInfoFromDB();
                Cache::put($key, $maintenance, now()->addMinutes(15));
                // Cache::put($key, $maintenance, now()->addMinutes(1));
            }
        }
        return $maintenance;
    }

    /**
     * Handle an incoming request.
     *
     * @param  \Illuminate\Http\Request  $request
     * @param  \Closure  $next
     * @return mixed
     */
    public function handle($request, Closure $next)
    {
        $key = 'maintenance';
        if (!$request->session()->has($key) ||
            ($request->session()->has($key) && $this->isMaintenanceCheckTimeExpired($request->session()->get($key)))) {
            
                $request->session()->put($key, $this->getAndUpdateMaintenanceInCache($key));
        }
        
  
        return $next($request);
    }

    
}
