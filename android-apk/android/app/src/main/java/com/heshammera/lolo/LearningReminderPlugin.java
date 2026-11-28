package com.heshammera.lolo;
import android.os.Build;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

@CapacitorPlugin(name="LearningReminder",permissions={@Permission(alias="notifications",strings={"android.permission.POST_NOTIFICATIONS"})})
public class LearningReminderPlugin extends Plugin {
    private JSObject snapshot(){
        JSObject r=new JSObject();int h=LearningReminderReceiver.hour(getContext());
        r.put("enabled",h>=0);r.put("hour",h>=0?h:17);r.put("permission",LearningReminderReceiver.canNotify(getContext()));return r;
    }
    @PluginMethod public void status(PluginCall call){call.resolve(snapshot());}
    @PluginMethod public void requestNotificationPermission(PluginCall call){
        LearningReminderReceiver.channel(getContext());
        if(Build.VERSION.SDK_INT>=33&&getContext().checkSelfPermission("android.permission.POST_NOTIFICATIONS")!=android.content.pm.PackageManager.PERMISSION_GRANTED){
            requestPermissionForAlias("notifications",call,"permissionResult");return;
        }
        call.resolve(snapshot());
    }
    @PermissionCallback private void permissionResult(PluginCall call){call.resolve(snapshot());}
    @PluginMethod public void enable(PluginCall call){
        try{Object raw=call.getData().opt("hour");if(!(raw instanceof Number))throw new IllegalArgumentException();
            int h=((Number)raw).intValue();if(((Number)raw).doubleValue()!=h)throw new IllegalArgumentException();
            LearningReminderReceiver.channel(getContext());LearningReminderReceiver.enable(getContext(),h);call.resolve(snapshot());
        }catch(Exception e){call.reject("Unable to schedule reminder");}
    }
    @PluginMethod public void disable(PluginCall call){
        try{LearningReminderReceiver.disable(getContext());call.resolve(snapshot());}
        catch(Exception e){call.reject("Unable to cancel reminder");}
    }
}
