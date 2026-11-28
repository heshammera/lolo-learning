import os,unittest
from pathlib import Path
import re
from scripts.verify_neon_schema import EXPECTED,verify
from family_accounts import FamilyStore

class SchemaManifestTests(unittest.TestCase):
    def test_manifest_matches_migrations(self):
        root=Path(__file__).resolve().parents[1]
        names=[]
        for path in sorted((root/"database/migrations").glob("*.sql")):
            names.extend(re.findall(r"CREATE TABLE IF NOT EXISTS (lolo_[a-z_]+)",path.read_text()))
        self.assertEqual(len(names),26)
        self.assertEqual(set(EXPECTED),set(names))
    def test_missing_dsn_fails(self):
        with self.assertRaises(RuntimeError):verify(None)

@unittest.skipUnless(os.environ.get("LOLO_TEST_DATABASE_URL"),"Dedicated test database required")
class SchemaVerificationTests(unittest.TestCase):
    def test_read_only_verification_on_isolated_database(self):
        dsn=os.environ["LOLO_TEST_DATABASE_URL"]
        self.assertNotEqual(dsn,os.environ.get("LOLO_DATABASE_URL"))
        self.assertNotEqual(dsn,os.environ.get("DATABASE_URL"))
        FamilyStore(dsn).migrate()
        self.assertEqual(verify(dsn),26)

    def test_build_gate_preview_and_production_isolation(self):
        import subprocess
        root=Path(__file__).resolve().parents[1]
        dsn=os.environ["LOLO_TEST_DATABASE_URL"]
        self.assertNotEqual(dsn,os.environ.get("LOLO_DATABASE_URL"))
        self.assertNotEqual(dsn,os.environ.get("DATABASE_URL"))
        FamilyStore(dsn).migrate()
        # Preview must never attempt a connection, even when opt-in and DSN are present.
        env=dict(os.environ,VERCEL_ENV="preview",LOLO_USE_VERCEL_DATABASE="true",
                 LOLO_DATABASE_URL="postgresql://invalid:invalid@127.0.0.1:1/invalid")
        command=["sh","scripts/verify_neon_build.sh"]
        result=subprocess.run(command,cwd=root,env=env,capture_output=True,text=True,timeout=60)
        self.assertEqual(result.returncode,0)
        self.assertIn("LOLO_NEON_DRIVER=PASS",result.stdout)
        self.assertIn("SKIPPED: preview; no database connection.",result.stdout)
        # Same script connects only on production opt-in, using disposable CI database.
        env.update(VERCEL_ENV="production",LOLO_DATABASE_URL=dsn)
        result=subprocess.run(command,cwd=root,env=env,capture_output=True,text=True,timeout=60)
        self.assertEqual(result.returncode,0)
        self.assertIn("PASS: 26/26 tables",result.stdout)
        self.assertNotIn(dsn,result.stdout+result.stderr)

class DiagnosticTests(unittest.TestCase):
    def test_missing_dsn_category(self):
        from scripts.verify_neon_schema import VerificationError
        with self.assertRaisesRegex(VerificationError,"^CONFIG_MISSING$"):
            verify(None)

    def test_connection_error_is_redacted(self):
        import sys
        from types import SimpleNamespace
        from unittest.mock import patch, Mock
        from scripts.verify_neon_schema import VerificationError
        driver=SimpleNamespace(connect=Mock(side_effect=RuntimeError("password authentication failed for secret-credential")))
        with patch.dict(sys.modules,{"psycopg":driver}):
            with self.assertRaisesRegex(VerificationError,"^CONNECT_AUTH$"):
                verify("secret-dsn")

    def test_empty_schema_reports_only_count(self):
        import sys
        from types import SimpleNamespace
        from unittest.mock import patch,MagicMock,Mock
        from scripts.verify_neon_schema import VerificationError
        db=MagicMock()
        db.__enter__.return_value=db
        db.execute.return_value.fetchall.return_value=[]
        with patch.dict(sys.modules,{"psycopg":SimpleNamespace(connect=Mock(return_value=db))}):
            with self.assertRaisesRegex(VerificationError,"^TABLE_COUNT_0_OF_26$"):
                verify("secret-dsn")

    def test_driver_import_failure_is_redacted(self):
        import sys
        from unittest.mock import patch
        from scripts.verify_neon_schema import VerificationError
        with patch.dict(sys.modules,{"psycopg":None}):
            with self.assertRaisesRegex(VerificationError,"^DRIVER_IMPORT_FAILED$"):
                verify("secret-dsn")
