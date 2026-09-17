"""Enforce NOT NULL constraints on audit fields and conditional integrity on cleaning tasks

Revision ID: 003_audit_not_null
Revises: 002_bed_split
Create Date: 2026-09-17 01:28:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '003_audit_not_null'
down_revision: Union[str, None] = '002_bed_split'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Enforce nullable=False on bed_allocation.assigned_by_personnel_id
    op.alter_column(
        'bed_allocation',
        'assigned_by_personnel_id',
        existing_type=sa.Integer(),
        nullable=False
    )

    # 2. Enforce nullable=False on equipment_allocation.allocated_by_personnel_id
    op.alter_column(
        'equipment_allocation',
        'allocated_by_personnel_id',
        existing_type=sa.Integer(),
        nullable=False
    )

    # 3. Add check constraint to ensure cleaning_task.personnel_id is non-null once active or completed
    op.create_check_constraint(
        'chk_cleaning_task_personnel_when_active',
        'cleaning_task',
        "status = 'PENDING' OR personnel_id IS NOT NULL"
    )


def downgrade() -> None:
    op.drop_constraint('chk_cleaning_task_personnel_when_active', 'cleaning_task', type_='check')
    op.alter_column(
        'equipment_allocation',
        'allocated_by_personnel_id',
        existing_type=sa.Integer(),
        nullable=True
    )
    op.alter_column(
        'bed_allocation',
        'assigned_by_personnel_id',
        existing_type=sa.Integer(),
        nullable=True
    )
