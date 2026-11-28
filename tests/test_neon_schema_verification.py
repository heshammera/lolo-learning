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
