import importlib.util
import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location("lolo_hosted_dispatch",ROOT/"api/dispatch.py")
api=importlib.util.module_from_spec(spec);spec.loader.exec_module(api)
from hosted_validator import validate,library
class HostedTests(unittest.TestCase):
    def test_disabled_and_routes(self):
        with self.assertRaises(api.FamilyError):api.config({})
        self.assertEqual(api.route_value("/api/dispatch?route=draft%2Fsave"),"/api/draft/save")
        self.assertEqual(api.route_value("/api/dispatch?route=activity-engine.js"),"/activity-engine.js")
        self.assertEqual(api.route_value("/api/dispatch?route=login&route=session"),"")
        self.assertIn("Secure",api.cookie("fixture",1800))
    def test_catalog_and_exact_validator(self):
        entries=library()
        self.assertEqual(len(entries),29)
        implemented=[e for e in entries if e["status"]=="implemented"]
        self.assertEqual(len(implemented),27)
        content={"schemaVersion":1,"subjectId":"science","gradeId":"grade-1","title":"منهج تجريبي","units":[{"id":"u","title":"Unit","lessons":[{"id":"l","title":"Lesson","goal":"Goal","activities":[e["example"] for e in implemented]}]}]}
        self.assertTrue(validate(content)["valid"])
        content["units"][0]["lessons"][0]["activities"][0]["config"]={}
        self.assertFalse(validate(content)["valid"])
    def test_rejects_shared_database_and_preview(self):
        from cryptography.fernet import Fernet
        env={"VERCEL_ENV":"production","LOLO_ADMIN_SERVERLESS_ENABLED":"true","LOLO_ADMIN_ORIGIN":"https://admin.example.test","LOLO_ADMIN_DATABASE_URL":"fixture-dsn","LOLO_ADMIN_ENCRYPTION_KEY":Fernet.generate_key().decode()}
        self.assertEqual(api.config(env)[1].dsn,"fixture-dsn")
        for changes in ({"LOLO_DATABASE_URL":"fixture-dsn"},{"VERCEL_ENV":"preview"},{"DATABASE_URL":"fixture-dsn"},{"LOLO_ADMIN_ORIGIN":"http://admin.example.test"}):
            with self.assertRaises(api.FamilyError):api.config({**env,**changes})
