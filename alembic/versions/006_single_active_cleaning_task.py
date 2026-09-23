"""Single active cleaning task per bed invariant and deduplication

Revision ID: 006_cleaning_task_uq
Revises: 005_admin_onboarding
Create Date: 2026-09-23 00:45:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '006_cleaning_task_uq'
down_revision: Union[str, None] = '005_admin_onboarding'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Deduplicate any existing duplicate active tasks (keep the latest active per bed)
    # Satisfies check constraint chk_cleaning_task_personnel_when_active by assigning admin personnel_id
    op.execute(sa.text("""
        UPDATE cleaning_task
        SET status = 'COMPLETED',
            personnel_id = COALESCE(personnel_id, (SELECT personnel_id FROM personnel WHERE role = 'ADMIN' ORDER BY personnel_id ASC LIMIT 1), 1),
            completed_datetime = NOW(),
            disinfection_notes = COALESCE(disinfection_notes, '') || ' [Auto-resolved: superseded by newer task]'
        WHERE cleaning_id IN (
            SELECT cleaning_id
            FROM (
                SELECT cleaning_id,
                       ROW_NUMBER() OVER (PARTITION BY bed_id ORDER BY requested_datetime DESC, cleaning_id DESC) as rn
                FROM cleaning_task
                WHERE status IN ('PENDING', 'IN_PROGRESS')
            ) sub
            WHERE sub.rn > 1
        );
    """))

    # 2. Add partial unique index to guarantee at most one active (PENDING/IN_PROGRESS) cleaning task per physical bed
    op.create_index(
        'uq_single_active_cleaning_task_per_bed',
        'cleaning_task',
        ['bed_id'],
        unique=True,
        postgresql_where=sa.text("status IN ('PENDING', 'IN_PROGRESS')")
    )


def downgrade() -> None:
    op.drop_index('uq_single_active_cleaning_task_per_bed', table_name='cleaning_task')
