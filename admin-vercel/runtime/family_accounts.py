"""Opt-in, operator-provisioned family identity foundation; no child voice data."""
import hashlib
import hmac
import re
import secrets
import unicodedata
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

EMAIL = re.compile(r"[^\s@]+@[^\s@]+\.[^\s@]+")
TOKEN = re.compile(r"[A-Za-z0-9_-]{43}")
AGE_BANDS = frozenset(("4-6", "7-9", "10-12", "13-17", "unspecified"))
SESSION_HOURS = 12
MAX_CHILDREN = 12
MIGRATIONS = Path(__file__).resolve().parent / "database" / "migrations"


class FamilyError(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status


def email_value(value):
    if not isinstance(value, str):
        raise FamilyError(400, "البريد الإلكتروني غير صالح.")
    value = value.strip().lower()
    if len(value) > 254 or not EMAIL.fullmatch(value) or any(unicodedata.category(c).startswith("C") for c in value):
        raise FamilyError(400, "البريد الإلكتروني غير صالح.")
    return value


def password_value(value):
    if not isinstance(value, str) or not 12 <= len(value) <= 128 or len(value.encode("utf-8", errors="replace")) > 512:
        raise FamilyError(400, "كلمة المرور يجب أن تكون بين 12 و128 حرفًا.")
    try:
        return value.encode("utf-8")
    except UnicodeEncodeError:
        raise FamilyError(400, "كلمة المرور غير صالحة.") from None


def derive(password, salt):
    return hashlib.scrypt(password, salt=salt, n=32768, r=8, p=1, maxmem=64*1024*1024, dklen=32)


def password_hash(value):
    salt = secrets.token_bytes(16)
    return "scrypt-v1:" + salt.hex() + ":" + derive(password_value(value), salt).hex()


def verify_password(value, stored):
    try:
        scheme, salt, expected = stored.split(":")
        salt, expected = bytes.fromhex(salt), bytes.fromhex(expected)
        if scheme != "scrypt-v1" or len(salt) != 16 or len(expected) != 32:
            return False
        return hmac.compare_digest(derive(password_value(value), salt), expected)
    except (ValueError, TypeError, FamilyError, AttributeError):
        return False


def digest_token(token):
    if not isinstance(token, str) or not TOKEN.fullmatch(token):
        raise FamilyError(401, "سجّل الدخول أولًا.")
    return hashlib.sha256(token.encode("ascii")).digest()


def child_fields(nickname, age_band):
    if not isinstance(nickname, str):
        raise FamilyError(400, "اختاري اسمًا مستعارًا للطفل.")
    nickname = nickname.strip()
    if not 1 <= len(nickname) <= 40 or any(unicodedata.category(c).startswith("C") for c in nickname):
        raise FamilyError(400, "الاسم المستعار غير صالح.")
    if not isinstance(age_band, str) or age_band not in AGE_BANDS:
        raise FamilyError(400, "الفئة العمرية غير صالحة.")
    return nickname, age_band

