#!/usr/bin/env bash
# Sign only a previously built unsigned APK. Never log secret values.
set -euo pipefail
umask 077
[[ $# == 2 ]] || { echo 'Usage: sign_android_release.sh unsigned.apk signed.apk' >&2; exit 2; }
for key in LOLO_ANDROID_KEYSTORE_BASE64 LOLO_ANDROID_STORE_PASSWORD LOLO_ANDROID_KEY_ALIAS LOLO_ANDROID_KEY_PASSWORD LOLO_ANDROID_CERT_SHA256; do
  [[ -n "${!key:-}" ]] || { echo "Missing signing configuration: $key" >&2; exit 2; }
done
expected="$(printf '%s' "$LOLO_ANDROID_CERT_SHA256" | tr -d ':' | tr '[:upper:]' '[:lower:]')"
[[ "$expected" =~ ^[a-f0-9]{64}$ ]] || { echo 'Invalid pinned certificate SHA-256' >&2; exit 2; }
[[ -f "$1" && ! -e "$2" ]] || { echo 'Unsigned input missing or output already exists' >&2; exit 2; }
sdk="${ANDROID_SDK_ROOT:-${ANDROID_HOME:-}}"
[[ -n "$sdk" ]] || { echo 'Android SDK not configured' >&2; exit 2; }
tools="$(find "$sdk/build-tools" -mindepth 1 -maxdepth 1 -type d | sort -V | tail -n 1)"
[[ -x "$tools/apksigner" && -x "$tools/zipalign" && -x "$tools/aapt" ]] || { echo 'Android build tools missing' >&2; exit 2; }
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
printf '%s' "$LOLO_ANDROID_KEYSTORE_BASE64" | base64 --decode > "$tmp/key"
# Check the actual keystore certificate independently before signing.
keytool -exportcert -alias "$LOLO_ANDROID_KEY_ALIAS" -keystore "$tmp/key" -storepass:env LOLO_ANDROID_STORE_PASSWORD -file "$tmp/cert.der"
key_digest="$(sha256sum "$tmp/cert.der" | cut -d' ' -f1)"
[[ "$key_digest" == "$expected" ]] || { echo "Keystore certificate differs from pinned certificate: $key_digest" >&2; exit 3; }
"$tools/zipalign" -P 16 -f 4 "$1" "$tmp/aligned.apk"
"$tools/apksigner" sign --ks "$tmp/key" --ks-key-alias "$LOLO_ANDROID_KEY_ALIAS" --ks-pass env:LOLO_ANDROID_STORE_PASSWORD --key-pass env:LOLO_ANDROID_KEY_PASSWORD --out "$tmp/signed.apk" "$tmp/aligned.apk"
verification="$("$tools/apksigner" verify --min-sdk-version 24 --print-certs "$tmp/signed.apk")"
# Normalize only whitespace and separators; do not weaken the pinned certificate check.
digests="$(printf '%s\n' "$verification" | sed -nE 's/^[[:space:]]*Signer #[0-9]+ certificate SHA-256 digest:[[:space:]]*([[:xdigit:]:]+)[[:space:]]*$/\1/p')"
[[ -n "$digests" && "$digests" != *"$tools/zipalign" -c -P 16 4 "$tmp/signed.apk"
badging="$("$tools/aapt" dump badging "$tmp/signed.apk")"
grep -Fq "package: name='com.heshammera.lolo' versionCode='${LOLO_ANDROID_VERSION_CODE:?Version required}'" <<< "$badging"
grep -Fxq "sdkVersion:'24'" <<< "$badging"
if grep -q '^application-debuggable' <<< "$badging"; then echo 'Debuggable release rejected' >&2; exit 3; fi
cp "$tmp/signed.apk" "$2"
echo "Verified signed release certificate: $actual"
\n'* ]] || { echo 'Expected exactly one signer certificate digest'; printf '%s\n' "$verification"; exit 3; }
actual="$(printf '%s' "$digests" | tr -d ':' | tr '[:upper:]' '[:lower:]')"
[[ "$actual" == "$expected" ]] || { echo "Release signer does not match pinned certificate: actual=$actual expected=$expected" >&2; exit 3; }
"$tools/zipalign" -c -P 16 4 "$tmp/signed.apk"
badging="$("$tools/aapt" dump badging "$tmp/signed.apk")"
grep -Fq "package: name='com.heshammera.lolo' versionCode='${LOLO_ANDROID_VERSION_CODE:?Version required}'" <<< "$badging"
grep -Fxq "sdkVersion:'24'" <<< "$badging"
if grep -q '^application-debuggable' <<< "$badging"; then echo 'Debuggable release rejected' >&2; exit 3; fi
cp "$tmp/signed.apk" "$2"
echo "Verified signed release certificate: $actual"
