import unittest
from unittest.mock import patch
from family_accounts import FamilyError
from family_mail import pilot_mail_config,deliver_pilot_code

ENV={"LOLO_PILOT_MAIL_ENABLED":"true","LOLO_PILOT_SMTP_HOST":"smtp.example.test","LOLO_PILOT_SMTP_PORT":"465","LOLO_PILOT_SMTP_USERNAME":"fixture-user","LOLO_PILOT_SMTP_PASSWORD":"fixture-secret","LOLO_PILOT_MAIL_FROM":"sender@example.test","LOLO_PILOT_MAIL_TEST_INBOX":"adult@example.test"}
CODE="a"*43

class PilotMailTest(unittest.TestCase):
    def test_disabled_or_invalid_config(self):
        for env in ({},{**ENV,"LOLO_PILOT_SMTP_PORT":"25"},{**ENV,"LOLO_PILOT_MAIL_TEST_INBOX":"a@example.test\nb@example.test"}):
            with self.assertRaises(FamilyError):pilot_mail_config(env)
    @patch("family_mail.smtplib.SMTP_SSL")
    def test_fixed_recipient_and_tls(self,client):
        smtp=client.return_value.__enter__.return_value
        smtp.send_message.return_value={}
        config=pilot_mail_config(ENV)
        deliver_pilot_code(config,"register","fixture@example.test",CODE)
        self.assertEqual(client.call_args.args,("smtp.example.test",465))
        self.assertTrue(client.call_args.kwargs["context"].check_hostname)
        smtp.login.assert_called_once_with("fixture-user","fixture-secret")
        message=smtp.send_message.call_args.args[0]
        self.assertEqual(str(message["To"]),"adult@example.test")
        self.assertEqual(smtp.send_message.call_args.kwargs["to_addrs"],["adult@example.test"])
        self.assertIn(CODE,message.get_content())
        self.assertNotIn("fixture-secret",message.get_content())
    @patch("family_mail.smtplib.SMTP")
    def test_starttls_failure_never_authenticates(self,client):
        smtp=client.return_value.__enter__.return_value
        smtp.starttls.side_effect=RuntimeError("private-code")
        with self.assertRaises(FamilyError) as error:
            deliver_pilot_code(pilot_mail_config({**ENV,"LOLO_PILOT_SMTP_PORT":"587"}),"reset","fixture@example.test",CODE)
        self.assertNotIn("private-code",str(error.exception))
        smtp.login.assert_not_called()
        smtp.send_message.assert_not_called()
    @patch("family_mail.smtplib.SMTP_SSL")
    def test_nonfixture_denied_before_network(self,client):
        with self.assertRaises(FamilyError):
            deliver_pilot_code(pilot_mail_config(ENV),"register","real@example.invalid",CODE)
        client.assert_not_called()
