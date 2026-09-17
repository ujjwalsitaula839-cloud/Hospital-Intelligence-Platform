"""Bed asset and ledger split, equipment versioning, and partial unique indexes for concurrency protection

Revision ID: 002_bed_split
Revises: 001_schema_refactor
Create Date: 2026-09-16 18:45:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '002_bed_split'
down_revision: Union[str, None] = '001_schema_refactor'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. CREATE PHYSICAL BED TABLE (Asset Inventory)
    op.create_table(
        'bed',
        sa.Column('bed_id', sa.Integer(), nullable=False, primary_key=True),
        sa.Column('bed_code', sa.String(length=30), nullable=False),
        sa.Column('department', sa.String(length=50), server_default='EMERGENCY', nullable=False),
        sa.Column('room_number', sa.String(length=20), server_default='101', nullable=False),
        sa.Column('bed_type', sa.String(length=30), server_default='STANDARD', nullable=False),
        sa.Column('status', sa.String(length=30), server_default='AVAILABLE', nullable=False),
        sa.Column('version', sa.Integer(), server_default='1', nullable=False),
        sa.Column('create_datetime', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
        sa.Column('update_datetime', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
    )
    op.create_index(op.f('ix_bed_bed_id'), 'bed', ['bed_id'], unique=False)
    op.create_index(op.f('ix_bed_bed_code'), 'bed', ['bed_code'], unique=True)
    op.create_index(op.f('ix_bed_status'), 'bed', ['status'], unique=False)

    # 2. DROP OLD CLEANING_TASK AND BED_ALLOCATION (to rebuild clean foreign keys)
    op.drop_table('cleaning_task')
    op.drop_table('bed_allocation')

    # 3. RECREATE BED_ALLOCATION TABLE (Stay Ledger)
    op.create_table(
        'bed_allocation',
        sa.Column('allocation_id', sa.Integer(), nullable=False, primary_key=True),
        sa.Column('bed_id', sa.Integer(), nullable=False),
        sa.Column('admission_id', sa.Integer(), nullable=False),
        sa.Column('assigned_by_personnel_id', sa.Integer(), nullable=True),
        sa.Column('status', sa.String(length=30), server_default='RESERVED', nullable=False),
        sa.Column('start_datetime', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('end_datetime', sa.DateTime(timezone=True), nullable=True),
        sa.Column('create_datetime', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
        sa.Column('update_datetime', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
        sa.ForeignKeyConstraint(['bed_id'], ['bed.bed_id'], ondelete='RESTRICT'),
    )
    op.create_index(op.f('ix_bed_allocation_allocation_id'), 'bed_allocation', ['allocation_id'], unique=False)
    op.create_index(op.f('ix_bed_allocation_bed_id'), 'bed_allocation', ['bed_id'], unique=False)
    op.create_index(op.f('ix_bed_allocation_admission_id'), 'bed_allocation', ['admission_id'], unique=False)
    op.create_index(op.f('ix_bed_allocation_status'), 'bed_allocation', ['status'], unique=False)

    # Partial Unique Indexes for Bed Allocation
    op.create_index(
        'uq_single_active_bed_allocation',
        'bed_allocation',
        ['bed_id'],
        unique=True,
        postgresql_where=sa.text("status IN ('RESERVED', 'OCCUPIED') AND end_datetime IS NULL")
    )
    op.create_index(
        'uq_single_active_admission_bed',
        'bed_allocation',
        ['admission_id'],
        unique=True,
        postgresql_where=sa.text("status IN ('RESERVED', 'OCCUPIED') AND end_datetime IS NULL")
    )

    # 4. RECREATE CLEANING_TASK TABLE (Linked to bed.bed_id and optional allocation_id)
    op.create_table(
        'cleaning_task',
        sa.Column('cleaning_id', sa.Integer(), nullable=False, primary_key=True),
        sa.Column('bed_id', sa.Integer(), nullable=False),
        sa.Column('allocation_id', sa.Integer(), nullable=True),
        sa.Column('personnel_id', sa.Integer(), nullable=True),
        sa.Column('status', sa.String(length=30), server_default='PENDING', nullable=False),
        sa.Column('requested_datetime', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('started_datetime', sa.DateTime(timezone=True), nullable=True),
        sa.Column('completed_datetime', sa.DateTime(timezone=True), nullable=True),
        sa.Column('disinfection_notes', sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(['bed_id'], ['bed.bed_id'], ondelete='RESTRICT'),
        sa.ForeignKeyConstraint(['allocation_id'], ['bed_allocation.allocation_id'], ondelete='SET NULL'),
    )
    op.create_index(op.f('ix_cleaning_task_cleaning_id'), 'cleaning_task', ['cleaning_id'], unique=False)
    op.create_index(op.f('ix_cleaning_task_bed_id'), 'cleaning_task', ['bed_id'], unique=False)
    op.create_index(op.f('ix_cleaning_task_allocation_id'), 'cleaning_task', ['allocation_id'], unique=False)
    op.create_index(op.f('ix_cleaning_task_status'), 'cleaning_task', ['status'], unique=False)

    # 5. ADD VERSION COLUMN TO EQUIPMENT TABLE
    op.add_column('equipment', sa.Column('version', sa.Integer(), server_default='1', nullable=False))

    # 6. PARTIAL UNIQUE INDEX ON EQUIPMENT ALLOCATION (Only 1 active allocation per equipment item)
    op.create_index(
        'uq_single_active_equipment_allocation',
        'equipment_allocation',
        ['equipment_id'],
        unique=True,
        postgresql_where=sa.text("status = 'ACTIVE' AND end_datetime IS NULL")
    )


def downgrade() -> None:
    op.drop_index('uq_single_active_equipment_allocation', table_name='equipment_allocation')
    op.drop_column('equipment', 'version')
    op.drop_table('cleaning_task')
    op.drop_index('uq_single_active_admission_bed', table_name='bed_allocation')
    op.drop_index('uq_single_active_bed_allocation', table_name='bed_allocation')
    op.drop_table('bed_allocation')
    op.drop_table('bed')
