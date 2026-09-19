"""Add is_active to patient and partial unique index on active admissions

Revision ID: 004_patient_active_uq
Revises: 003_audit_not_null
Create Date: 2026-09-18 17:20:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '004_patient_active_uq'
down_revision: Union[str, None] = '003_audit_not_null'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Resolve dirty data: close any older duplicate open admissions per patient
    # Ensures no unique constraint violation occurs during index creation
    op.execute(sa.text("""
        WITH duplicate_admissions AS (
            SELECT admission_id,
                   ROW_NUMBER() OVER (PARTITION BY patient_id ORDER BY arrival_datetime DESC) as rn
            FROM admission
            WHERE discharge_datetime IS NULL
        )
        UPDATE admission
        SET discharge_datetime = NOW()
        WHERE admission_id IN (
            SELECT admission_id FROM duplicate_admissions WHERE rn > 1
        );
    """))

    # 2. Add is_active column to patient for soft-deletion / HIPAA compliance
    op.add_column(
        'patient',
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default=sa.true())
    )
    op.create_index(op.f('ix_patient_is_active'), 'patient', ['is_active'], unique=False)

    # 3. Create partial unique index: guarantees at DB level max 1 active admission per patient
    op.create_index(
        'uq_single_active_admission_per_patient',
        'admission',
        ['patient_id'],
        unique=True,
        postgresql_where=sa.text("discharge_datetime IS NULL")
    )

    # 4. Add last_login_datetime column to personnel
    op.add_column(
        'personnel',
        sa.Column('last_login_datetime', sa.DateTime(timezone=True), nullable=True)
    )


def downgrade() -> None:
    op.drop_column('personnel', 'last_login_datetime')
    op.drop_index('uq_single_active_admission_per_patient', table_name='admission')
    op.drop_index(op.f('ix_patient_is_active'), table_name='patient')
    op.drop_column('patient', 'is_active')
