package com.heshammera.lolo;

import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.util.AtomicFile;
import java.io.File;
import java.io.FileOutputStream;
import java.util.Calendar;

public class LearningReminderReceiver extends BroadcastReceiver {
    static final String ACTION="com.heshammera.lolo.DAILY_LEARNING_REMINDER";
    static final String CHANNEL="learning_reminders_v1";
    static final int NOTIFICATION_ID=4102;
    private static final Object LOCK=new Object();
    static AtomicFile state(Context c) {
        return new AtomicFile(new File(c.getNoBackupFilesDir(),"daily-learning-reminder-v1"));
    }
    static int hour(Context c) {
        synchronized(LOCK) {
            try {
                byte[] b=state(c).readFully();
                return b.length==1&&b[0]>=0&&b[0]<=23?b[0]:-1;
            }catch(Exception e){return -1;}
        }
    }
    static boolean canNotify(Context c) {
        NotificationManager n=c.getSystemService(NotificationManager.class);
        if(n==null||!n.areNotificationsEnabled())return false;
        if(Build.VERSION.SDK_INT>=33&&c.checkSelfPermission("android.permission.POST_NOTIFICATIONS")!=android.content.pm.PackageManager.PERMISSION_GRANTED)return false;
        if(Build.VERSION.SDK_INT>=26){
            NotificationChannel ch=n.getNotificationChannel(CHANNEL);
            if(ch!=null&&ch.getImportance()==NotificationManager.IMPORTANCE_NONE)return false;
        }
        return true;
    }
    static void channel(Context c){
        if(Build.VERSION.SDK_INT>=26){
            NotificationManager n=c.getSystemService(NotificationManager.class);
            NotificationChannel ch=new NotificationChannel(CHANNEL,"تذكيرات التعلّم",NotificationManager.IMPORTANCE_DEFAULT);
            ch.setDescription("تذكير يومي اختياري بدون معلومات شخصية");ch.setLockscreenVisibility(Notification.VISIBILITY_PRIVATE);
            n.createNotificationChannel(ch);
        }
    }
    static PendingIntent alarmIntent(Context c){
        return PendingIntent.getBroadcast(c,4101,new Intent(c,LearningReminderReceiver.class).setAction(ACTION),PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
    }
    static long next(int h,long now){
        Calendar t=Calendar.getInstance();t.setTimeInMillis(now);t.set(Calendar.HOUR_OF_DAY,h);t.set(Calendar.MINUTE,0);t.set(Calendar.SECOND,0);t.set(Calendar.MILLISECOND,0);
        if(t.getTimeInMillis()<=now)t.add(Calendar.DAY_OF_YEAR,1);
        return t.getTimeInMillis();
    }
    static void schedule(Context c,int h){
        AlarmManager manager=c.getSystemService(AlarmManager.class);
        if(manager==null)throw new IllegalStateException("Alarm unavailable");
        // Inexact and battery-friendly. No exact-alarm permission.
        manager.set(AlarmManager.RTC_WAKEUP,next(h,System.currentTimeMillis()),alarmIntent(c));
    }
    static void enable(Context c,int h)throws Exception{
        synchronized(LOCK){
            if(h<0||h>23||!canNotify(c))throw new IllegalArgumentException("Permission or time invalid");
            AtomicFile af=state(c);FileOutputStream out=null;
            try{out=af.startWrite();out.write(h);af.finishWrite(out);}
            catch(Exception e){if(out!=null)af.failWrite(out);throw e;}
            try{schedule(c,h);}catch(Exception e){disable(c);throw e;}
        }
    }
    static void disable(Context c){
        synchronized(LOCK){
            state(c).delete();
            AlarmManager manager=c.getSystemService(AlarmManager.class);
            if(manager!=null)manager.cancel(alarmIntent(c));
            NotificationManager n=c.getSystemService(NotificationManager.class);
            if(n!=null)n.cancel(NOTIFICATION_ID);
        }
    }
    @Override public void onReceive(Context c,Intent intent){
        synchronized(LOCK){
            int h=hour(c);if(h<0)return;
            if(!canNotify(c)){disable(c);return;}
            String action=intent.getAction();
            if(ACTION.equals(action)){
                Calendar now=Calendar.getInstance();
                // If delivery was delayed until another day or a different hour, do not issue a stale alert.
                if(now.get(Calendar.HOUR_OF_DAY)==h){
                    channel(c);
                    Intent open=new Intent(c,MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP|Intent.FLAG_ACTIVITY_SINGLE_TOP);
                    PendingIntent content=PendingIntent.getActivity(c,4103,open,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
                    Notification.Builder b=Build.VERSION.SDK_INT>=26?new Notification.Builder(c,CHANNEL):new Notification.Builder(c);
                    Notification n=b.setSmallIcon(R.mipmap.ic_launcher).setContentTitle("LOLO")
                        .setContentText("وقت مناسب لتدريب قصير؟ افتح التطبيق عندما يناسبك.")
                        .setVisibility(Notification.VISIBILITY_PRIVATE).setAutoCancel(true).setContentIntent(content).build();
                    try{c.getSystemService(NotificationManager.class).notify(NOTIFICATION_ID,n);}catch(SecurityException e){disable(c);return;}
                }
            }else if(!Intent.ACTION_BOOT_COMPLETED.equals(action)&&!Intent.ACTION_TIME_CHANGED.equals(action)&&!Intent.ACTION_TIMEZONE_CHANGED.equals(action))return;
            schedule(c,h);
        }
    }
}
