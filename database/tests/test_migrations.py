import importlib.util
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('hip_migrate', ROOT / 'migrate.py')
migrate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(migrate)


class UnitTests(unittest.TestCase):
    def test_missing_url(self):
        with patch.dict(os.environ, {}, clear=True), self.assertRaises(ValueError):
            migrate.database_url()

    def test_asyncpg_url(self):
        with patch.dict(os.environ, {'DATABASE_URL': 'postgresql+asyncpg://u:p@localhost/db?sslmode=require'}):
            self.assertEqual(migrate.database_url(), 'postgresql://u:p@localhost/db?sslmode=require')

    def test_checksum_portability(self):
        with tempfile.TemporaryDirectory() as temp:
            a, b = Path(temp)/'a.sql', Path(temp)/'b.sql'
            a.write_bytes(b'SELECT 1;\n')
            b.write_bytes(b'SELECT 1;\r\n')
            self.assertEqual(migrate.checksum_for(a), migrate.checksum_for(b))

    def test_postgresql_syntax(self):
        from pglast import parse_sql
        for path in [*migrate.migration_files(), ROOT/'preflight.sql']:
            with self.subTest(file=path.name):
                self.assertTrue(parse_sql(path.read_text(encoding='utf-8')))


@unittest.skipUnless(os.environ.get('HIP_TEST_DATABASE_URL'), 'Disposable PostgreSQL test database not configured')
class IntegrationTests(unittest.TestCase):
    def setUp(self):
        import psycopg
        self.pg = psycopg
        self.conn = psycopg.connect(os.environ['HIP_TEST_DATABASE_URL'])
        self.addCleanup(self.conn.close)
        self.addCleanup(self.conn.rollback)
        count = self.conn.execute("SELECT count(*) FROM pg_tables WHERE schemaname='public'").fetchone()[0]
        if count:
            self.fail('Refusing test database: public schema must be empty.')

    def install(self):
        # Nested savepoint; outer transaction always rolls back in cleanup.
        migrate.run('upgrade', self.conn)

    def fixture(self):
        user = self.conn.execute("INSERT INTO users(username,email,hashed_password,role) VALUES ('tester','t@example.test','test-hash','nurse') RETURNING id").fetchone()[0]
        patient = self.conn.execute("INSERT INTO patient_records(patient_id) VALUES ('P') RETURNING id").fetchone()[0]
        dept = self.conn.execute("SELECT id FROM departments WHERE code='ER'").fetchone()[0]
        enc = self.conn.execute("INSERT INTO encounters(encounter_code,patient_record_id,department_id,chief_complaint,status,created_by) VALUES ('E',%s,%s,'Test','EN_ROUTE',%s) RETURNING id", (patient,dept,user)).fetchone()[0]
        bed = self.conn.execute("INSERT INTO bed_registry(bed_code,department,department_id) VALUES ('B','ER',%s) RETURNING id", (dept,)).fetchone()[0]
        return user,enc,bed

    def test_install_and_repeat(self):
        self.install()
        self.install()
        self.assertEqual(self.conn.execute('SELECT count(*) FROM hip_schema_migrations').fetchone()[0], 3)
        self.assertEqual(self.conn.execute("SELECT count(*) FROM pg_tables WHERE schemaname='public'").fetchone()[0], 19)

    def test_legacy_preservation(self):
        self.conn.execute((ROOT/'migrations/001_legacy_baseline.sql').read_text())
        self.conn.execute("INSERT INTO users(id,username,email,hashed_password,role) VALUES (10,'legacy','legacy@example.test','old-hash','nurse')")
        self.conn.execute("INSERT INTO patient_records(patient_id,name,diagnosis,room,assigned_user_id) VALUES ('OLD','Retained','Original','ER-01','10')")
        self.conn.execute("INSERT INTO bed_registry(bed_code,department,status,assigned_patient_id) VALUES ('ER-01','ER','RESERVED','OLD')")
        self.install()
        self.assertEqual(self.conn.execute('SELECT patient_id,name,room FROM patient_records').fetchone(), ('OLD','Retained','ER-01'))
        self.assertEqual(self.conn.execute('SELECT count(*) FROM user_roles').fetchone()[0], 1)
        self.assertEqual(self.conn.execute('SELECT count(*) FROM encounters').fetchone()[0], 0)

    def test_failed_backfill_rolls_back(self):
        self.conn.execute((ROOT/'migrations/001_legacy_baseline.sql').read_text())
        self.conn.execute("INSERT INTO bed_registry(bed_code,department,status,assigned_patient_id) VALUES ('B','ER','RESERVED','missing')")
        with self.assertRaises(self.pg.errors.RaiseException):
            self.install()
        self.assertIsNone(self.conn.execute("SELECT to_regclass('public.encounters')").fetchone()[0])
        self.assertIsNone(self.conn.execute("SELECT to_regclass('public.hip_schema_migrations')").fetchone()[0])

    def test_active_assignment_uniqueness(self):
        self.install()
        user,enc,bed = self.fixture()
        sql = 'INSERT INTO bed_assignments(encounter_id,bed_id,assigned_by) VALUES (%s,%s,%s)'
        self.conn.execute(sql, (enc,bed,user))
        with self.assertRaises(self.pg.errors.UniqueViolation), self.conn.transaction():
            self.conn.execute(sql, (enc,bed,user))
        self.conn.execute('UPDATE bed_assignments SET ended_at=now(), ended_by=%s', (user,))
        self.conn.execute(sql, (enc,bed,user))

    def test_fk_and_completion_constraints(self):
        self.install()
        user,enc,_ = self.fixture()
        with self.assertRaises(self.pg.errors.ForeignKeyViolation), self.conn.transaction():
            self.conn.execute('INSERT INTO nurse_assignments(encounter_id,nurse_id,assigned_by) VALUES (%s,999999,%s)', (enc,user))
        with self.assertRaises(self.pg.errors.CheckViolation), self.conn.transaction():
            self.conn.execute("INSERT INTO preparation_tasks(encounter_id,title,task_type,status,created_by) VALUES (%s,'Room','ROOM','COMPLETED',%s)", (enc,user))

    def test_checksum_mismatch(self):
        self.install()
        self.conn.execute("UPDATE hip_schema_migrations SET checksum='changed' WHERE version='001_legacy_baseline.sql'")
        with self.assertRaises(ValueError):
            self.install()


if __name__ == '__main__':
    unittest.main()
