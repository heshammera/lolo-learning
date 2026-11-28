package com.heshammera.lolo;

import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.AtomicFile;
import android.content.pm.ApplicationInfo;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.FileNotFoundException;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import org.json.JSONObject;

@CapacitorPlugin(name="OfflineLicenseVault")
public class OfflineLicenseVaultPlugin extends Plugin {
    private static final String ALIAS="lolo-offline-vault-test-v1";
    private static final byte[] AAD="LOLO-OFFLINE-VAULT-TEST-V1".getBytes(StandardCharsets.US_ASCII);
    private static final int MAX=16384;
    private static final Object LOCK=new Object();
    private void requireDebug() {
        if ((getContext().getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE)==0)
            throw new IllegalStateException("Test vault disabled");
    }
    private AtomicFile file() {
        return new AtomicFile(new File(getContext().getNoBackupFilesDir(),"offline-license-test.vault"));
    }
    private SecretKey key(boolean create) throws Exception {
        KeyStore ks=KeyStore.getInstance("AndroidKeyStore");ks.load(null);
        if (!ks.containsAlias(ALIAS)) {
            if(!create)throw new IllegalStateException("Vault key missing");
            KeyGenerator generator=KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES,"AndroidKeyStore");
            generator.init(new KeyGenParameterSpec.Builder(ALIAS,KeyProperties.PURPOSE_ENCRYPT|KeyProperties.PURPOSE_DECRYPT)
                .setKeySize(256).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setRandomizedEncryptionRequired(true).build());
            generator.generateKey();
        }
        SecretKey k=(SecretKey)ks.getKey(ALIAS,null);
        if(k==null)throw new IllegalStateException("Vault key unavailable");
        return k;
    }
    private JSONObject read() throws Exception {
        AtomicFile af=file();byte[] encrypted;
        try { encrypted=af.readFully(); }
        catch(FileNotFoundException e) {
            File b=af.getBaseFile();
            if(b.exists()||new File(b.getPath()+".bak").exists()||new File(b.getPath()+".new").exists())throw e;
            return null;
        }
        if(encrypted.length<29||encrypted.length>MAX+1024||encrypted[0]!=1)throw new IllegalStateException("Vault invalid");
        byte[] iv=java.util.Arrays.copyOfRange(encrypted,1,13);
        Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE,key(false),new GCMParameterSpec(128,iv));cipher.updateAAD(AAD);
        byte[] plain=cipher.doFinal(encrypted,13,encrypted.length-13);
        JSONObject result=new JSONObject(new String(plain,StandardCharsets.UTF_8));
        if(result.length()!=2||result.getLong("revision")<1||result.getLong("revision")>9007199254740991L||!(result.get("state") instanceof JSONObject))throw new IllegalStateException("Vault invalid");
        return result;
    }
    private void write(JSONObject value) throws Exception {
        byte[] plain=value.toString().getBytes(StandardCharsets.UTF_8);
        if(plain.length>MAX)throw new IllegalArgumentException("Vault too large");
        Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE,key(true));cipher.updateAAD(AAD);
        byte[] iv=cipher.getIV(),ct=cipher.doFinal(plain);
        if(iv.length!=12)throw new IllegalStateException("Invalid IV");
        byte[] bytes=ByteBuffer.allocate(1+iv.length+ct.length).put((byte)1).put(iv).put(ct).array();
        AtomicFile af=file();FileOutputStream out=null;
        try{out=af.startWrite();out.write(bytes);af.finishWrite(out);}
        catch(Exception e){if(out!=null)af.failWrite(out);throw e;}
    }
    @PluginMethod public void readState(PluginCall call) {
        synchronized(LOCK) {
            try {
                requireDebug();JSONObject current=read();JSObject out=new JSObject();
                out.put("revision",current==null?0:current.getLong("revision"));
                out.put("state",current==null?JSONObject.NULL:current.getJSONObject("state"));
                out.put("now",System.currentTimeMillis()/1000L);out.put("testOnly",true);
                call.resolve(out);
            }catch(Exception e){call.reject("Test vault unavailable");}
        }
    }
    @PluginMethod public void compareAndSet(PluginCall call) {
        synchronized(LOCK) {
            try {
                requireDebug();Object raw=call.getData().opt("expectedRevision");JSObject state=call.getObject("state");
                if(!(raw instanceof Number)||state==null||state.toString().getBytes(StandardCharsets.UTF_8).length>MAX-128)throw new IllegalArgumentException();
                long expected=((Number)raw).longValue();
                if(expected<0||expected>=9007199254740991L||((Number)raw).doubleValue()!=expected)throw new IllegalArgumentException();
                JSONObject prior=read();long revision=prior==null?0:prior.getLong("revision");
                if(expected!=revision){call.reject("Vault revision changed");return;}
                JSONObject next=new JSONObject();next.put("revision",revision+1);next.put("state",state);write(next);
                JSObject out=new JSObject();out.put("revision",revision+1);out.put("testOnly",true);call.resolve(out);
            }catch(Exception e){call.reject("Test vault write failed");}
        }
    }
}
