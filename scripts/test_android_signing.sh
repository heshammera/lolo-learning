#!/usr/bin/env bash
set -euo pipefail
umask 077
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
export LOLO_ANDROID_STORE_PASSWORD="$(openssl rand -hex 24)"
export LOLO_ANDROID_KEY_PASSWORD="$LOLO_ANDROID_STORE_PASSWORD"
export LOLO_ANDROID_KEY_ALIAS=ci-only
keytool -genkeypair -alias "$LOLO_ANDROID_KEY_ALIAS" -keyalg RSA -keysize 2048 -validity 365 -dname 'CN=Disposable CI only' -keystore "$tmp/test.p12" -storetype PKCS12 -storepass:env LOLO_ANDROID_STORE_PASSWORD -keypass:env LOLO_ANDROID_KEY_PASSWORD
export LOLO_ANDROID_KEYSTORE_BASE64="$(base64 -w0 "$tmp/test.p12")"
keytool -exportcert -alias "$LOLO_ANDROID_KEY_ALIAS" -keystore "$tmp/test.p12" -storepass:env LOLO_ANDROID_STORE_PASSWORD -file "$tmp/cert.der"
export LOLO_ANDROID_CERT_SHA256="$(sha256sum "$tmp/cert.der" | cut -d' ' -f1)"
bash ../scripts/sign_android_release.sh android/app/build/outputs/apk/release/app-release-unsigned.apk "$tmp/verified.apk"
test -s "$tmp/verified.apk"
export LOLO_ANDROID_CERT_SHA256="$(printf '%064d' 0)"
if bash ../scripts/sign_android_release.sh android/app/build/outputs/apk/release/app-release-unsigned.apk "$tmp/rejected.apk"; then
  echo 'Mismatched certificate incorrectly accepted' >&2
  exit 1
fi
test ! -e "$tmp/rejected.apk"
# The disposable certificate and test APK are never uploaded.
