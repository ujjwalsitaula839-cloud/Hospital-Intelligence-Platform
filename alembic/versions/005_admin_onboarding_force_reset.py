"""Admin onboarding: must_change_password, password_history, CHECK constraints

Revision ID: 005_admin_onboarding
Revises: 004_patient_active_uq
Create Date: 2026-09-19 00:00:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '005_admin_onboarding'
down_revision: Union[str, None] = '004_patient_active_uq'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Add must_change_password column (default TRUE for new provisioned users)
    op.add_column(
        'personnel',
        sa.Column('must_change_password', sa.Boolean(), nullable=False, server_default=sa.true())
    )

    # 2. Backfill existing rows — they already have real passwords
    op.execute(sa.text("UPDATE personnel SET must_change_password = FALSE"))

    # 3. CHECK constraint: enforce valid roles at DB level
    op.create_check_constraint(
        'ck_personnel_role',
        'personnel',
        "role IN ('DOCTOR', 'NURSE', 'CLEANING_CREW', 'PHARMACY', 'ADMIN')"
    )

    # 4. CHECK constraint: enforce valid departments at DB level
    op.create_check_constraint(
        'ck_personnel_department',
        'personnel',
        "department IN ('EMERGENCY', 'ICU', 'SURGERY', 'PEDIATRICS', 'RADIOLOGY', "
        "'PHARMACY', 'LABORATORY', 'ADMINISTRATION', 'GENERAL', 'FACILITIES', 'ENVIRONMENTAL_SERVICES')"
    )

    # 5. Create password_history table for reuse prevention
    op.create_table(
        'password_history',
        sa.Column('history_id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('personnel_id', sa.Integer(),
                  sa.ForeignKey('personnel.personnel_id', ondelete='CASCADE'),
                  nullable=False),
        sa.Column('password_hash', sa.String(255), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index('ix_password_history_personnel_id', 'password_history', ['personnel_id'])


def downgrade() -> None:
    op.drop_index('ix_password_history_personnel_id', table_name='password_history')
    op.drop_table('password_history')
    op.drop_constraint('ck_personnel_department', 'personnel', type_='check')
    op.drop_constraint('ck_personnel_role', 'personnel', type_='check')
    op.drop_column('personnel', 'must_change_password')
