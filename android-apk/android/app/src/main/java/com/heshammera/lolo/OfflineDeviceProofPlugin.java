package com.heshammera.lolo;

import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.nio.charset.StandardCharsets;
import java.security.KeyPairGenerator;
import java.security.KeyStore;
import java.security.MessageDigest;
import java.security.Signature;
import java.security.spec.ECGenParameterSpec;

@CapacitorPlugin(name = "OfflineDeviceProof")
public class OfflineDeviceProofPlugin extends Plugin {
    private static final String ALIAS = "lolo-offline-proof-test-v1";
    private static final String UUID = "[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}";
    private static final String CHALLENGE = "LOLO-OFFLINE-TEST-V1\\n" + UUID + "\\n" + UUID + "\\n" + UUID + "\\n[A-Za-z0-9_-]{43}\\n[a-f0-9]{64}";
    private static String b64(byte[] value) {
        return Base64.encodeToString(value, Base64.URL_SAFE | Base64.NO_PADDING | Base64.NO_WRAP);
    }
    private static String hex(byte[] value) {
        StringBuilder s = new StringBuilder();
        for (byte b : value) s.append(String.format(java.util.Locale.ROOT, "%02x", b & 0xff));
        return s.toString();
    }
    private static synchronized KeyStore.PrivateKeyEntry entry() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore");
        store.load(null);
        if (!store.containsAlias(ALIAS)) {
            KeyPairGenerator generator = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, "AndroidKeyStore");
            generator.initialize(new KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_SIGN)
                .setAlgorithmParameterSpec(new ECGenParameterSpec("secp256r1"))
                .setDigests(KeyProperties.DIGEST_SHA256).build());
            generator.generateKeyPair();
        }
        KeyStore.Entry entry = store.getEntry(ALIAS, null);
        if (!(entry instanceof KeyStore.PrivateKeyEntry)) throw new IllegalStateException("Key unavailable");
        return (KeyStore.PrivateKeyEntry) entry;
    }
    @PluginMethod public void publicKey(PluginCall call) {
        try {
            byte[] raw = entry().getCertificate().getPublicKey().getEncoded();
            JSObject out = new JSObject();
            out.put("publicSpki", b64(raw));
            out.put("deviceKeySha256", hex(MessageDigest.getInstance("SHA-256").digest(raw)));
            out.put("testOnly", true);
            call.resolve(out);
        } catch (Exception e) { call.reject("Test device key unavailable"); }
    }
    @PluginMethod public void signChallenge(PluginCall call) {
        String message = call.getString("message");
        if (message == null || !message.matches(CHALLENGE)) { call.reject("Invalid test challenge"); return; }
        try {
            KeyStore.PrivateKeyEntry key = entry();
            String digest = hex(MessageDigest.getInstance("SHA-256").digest(key.getCertificate().getPublicKey().getEncoded()));
            if (!message.endsWith("\n" + digest)) { call.reject("Wrong device key"); return; }
            Signature signer = Signature.getInstance("SHA256withECDSA");
            signer.initSign(key.getPrivateKey());
            signer.update(message.getBytes(StandardCharsets.US_ASCII));
            JSObject out = new JSObject();
            out.put("signature", b64(signer.sign()));
            out.put("testOnly", true);
            call.resolve(out);
        } catch (Exception e) { call.reject("Test device signing unavailable"); }
    }
}
