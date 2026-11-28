"""Operator-only delivery of synthetic fixture codes to one approved adult test inbox."""
import os
import re
import smtplib
import ssl
from email.message import EmailMessage
from family_accounts import FamilyError, email_value, digest_token

FAIL="Pilot email could not be delivered. Check configuration privately."


def mailbox(value):
    value=email_value(value)
    # Restrict envelope/header syntax; no display names or header injection.
    if not re.fullmatch(r"[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,63}",value):
        raise FamilyError(400,"Invalid pilot mailbox.")
    return value


def pilot_mail_config(env=None):
    env=os.environ if env is None else env
    if env.get("LOLO_PILOT_MAIL_ENABLED")!="true":
        raise FamilyError(503,"Pilot mail disabled.")
    host=env.get("LOLO_PILOT_SMTP_HOST","")
    port=env.get("LOLO_PILOT_SMTP_PORT","")
    user=env.get("LOLO_PILOT_SMTP_USERNAME","")
    password=env.get("LOLO_PILOT_SMTP_PASSWORD","")
    if not re.fullmatch(r"[A-Za-z0-9.-]{1,253}",host) or port not in ("465","587") or not user or not password:
        raise FamilyError(503,"Pilot mail configuration incomplete.")
    return {"host":host,"port":int(port),"username":user,"password":password,
            "sender":mailbox(env.get("LOLO_PILOT_MAIL_FROM")),
            "inbox":mailbox(env.get("LOLO_PILOT_MAIL_TEST_INBOX"))}


def deliver_pilot_code(config,purpose,email,code):
    email=email_value(email)
    if purpose not in ("register","reset") or not email.endswith("@example.test"):
        raise FamilyError(400,"Synthetic fixture required.")
    digest_token(code)  # validate format only
    message=EmailMessage()
    message["From"]=config["sender"]
    message["To"]=config["inbox"]
    message["Subject"]="LOLO Learning - synthetic account test"
    action="registration" if purpose=="register" else "password recovery"
    message.set_content(f"Closed synthetic test only; not a real child account.\nFixture: {email}\nAction: {action}\nOne-time code: {code}\nExpires within 15 minutes. Do not forward.\n")
    context=ssl.create_default_context()
    try:
        if config["port"]==465:
            with smtplib.SMTP_SSL(config["host"],465,timeout=10,context=context) as smtp:
                smtp.login(config["username"],config["password"])
                refused=smtp.send_message(message,from_addr=config["sender"],to_addrs=[config["inbox"]])
        elif config["port"]==587:
            with smtplib.SMTP(config["host"],587,timeout=10) as smtp:
                smtp.ehlo()
                smtp.starttls(context=context)
                smtp.ehlo()
                smtp.login(config["username"],config["password"])
                refused=smtp.send_message(message,from_addr=config["sender"],to_addrs=[config["inbox"]])
        else:
            raise FamilyError(503,FAIL)
        if refused:
            raise FamilyError(503,FAIL)
    except Exception:
        # Provider exceptions can contain recipient addresses or message material.
        raise FamilyError(503,FAIL) from None
