package com.heshammera.lolo;

import android.os.Bundle;
import android.content.pm.ApplicationInfo;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override public void onCreate(Bundle savedInstanceState) {
        // Synthetic proof bridge is intentionally absent in release builds.
        if ((getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0) {
            registerPlugin(OfflineDeviceProofPlugin.class);
            registerPlugin(OfflineLicenseVaultPlugin.class);
        }
        super.onCreate(savedInstanceState);
    }
}
