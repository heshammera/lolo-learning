package com.heshammera.lolo;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Only releases the cosmetic native cover; no data, permissions or network operations. */
@CapacitorPlugin(name="StartupSplash")
public class StartupSplashPlugin extends Plugin {
    @PluginMethod public void painted(PluginCall call) {
        if (!(getActivity() instanceof MainActivity)) {call.reject("No startup activity");return;}
        ((MainActivity)getActivity()).webSplashPainted(call::resolve);
    }
}
