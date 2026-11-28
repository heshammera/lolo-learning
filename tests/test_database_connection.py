import unittest
from database_connection import database_dsn

class DatabaseConnectionTests(unittest.TestCase):
    def test_no_implicit_preview_or_production_connection(self):
        for env in ({"DATABASE_URL":"mock"},{"VERCEL_ENV":"preview","LOLO_USE_VERCEL_DATABASE":"true","DATABASE_URL":"mock"},{"VERCEL_ENV":"production","DATABASE_URL":"mock"}):
            self.assertIsNone(database_dsn(env=env))
            self.assertIsNone(database_dsn("budget",env))
    def test_opt_in_production_and_separate_budget_scope(self):
        env={"VERCEL_ENV":"production","LOLO_USE_VERCEL_DATABASE":"true","DATABASE_URL":"mock"}
        self.assertEqual(database_dsn(env=env),"mock")
        self.assertIsNone(database_dsn("budget",env))
        env["LOLO_BUDGET_USE_FAMILY_DB"]="true"
        self.assertEqual(database_dsn("budget",env),"mock")
    def test_explicit_urls_win(self):
        env={"LOLO_DATABASE_URL":"family","LOLO_BUDGET_DATABASE_URL":"budget","DATABASE_URL":"unused"}
        self.assertEqual(database_dsn(env=env),"family")
        self.assertEqual(database_dsn("budget",env),"budget")
