"""Initial schema refactor: consolidated bed_allocation, admission, primary_diagnosis, discharge datetime

Revision ID: 001_schema_refactor
Revises: 
Create Date: 2026-09-14 14:55:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = '001_schema_refactor'
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. PERSONNEL TABLE
    op.create_table(
        'personnel',
        sa.Column('personnel_id', sa.Integer(), nullable=False, primary_key=True),
        sa.Column('username', sa.String(length=50), nullable=False),
        sa.Column('email', sa.String(length=120), nullable=False),
        sa.Column('hashed_password', sa.String(length=255), nullable=False),
        sa.Column('full_name', sa.String(length=100), server_default='Staff Member', nullable=False),
        sa.Column('role', sa.String(length=30), server_default='NURSE', nullable=False),
        sa.Column('department', sa.String(length=50), server_default='EMERGENCY', nullable=False),
        sa.Column('is_active', sa.Boolean(), server_default='true', nullable=True),
        sa.Column('create_datetime', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
        sa.Column('last_logout_datetime', sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index(op.f('ix_personnel_personnel_id'), 'personnel', ['personnel_id'], unique=False)
    op.create_index(op.f('ix_personnel_username'), 'personnel', ['username'], unique=True)
    op.create_index(op.f('ix_personnel_email'), 'personnel', ['email'], unique=True)

    # 2. PATIENT TABLE
    op.create_table(
        'patient',
        sa.Column('patient_id', sa.Integer(), nullable=False, primary_key=True),
        sa.Column('first_name', sa.String(length=50), nullable=False),
        sa.Column('middle_name', sa.String(length=50), nullable=True),
        sa.Column('last_name', sa.String(length=50), nullable=False),
        sa.Column('date_of_birth', sa.Date(), nullable=False),
        sa.Column('gender', sa.String(length=20), nullable=False),
        sa.Column('phone', sa.String(length=30), nullable=True),
        sa.Column('address', sa.Text(), nullable=True),
        sa.Column('create_datetime', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
        sa.Column('update_datetime', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
    )
    op.create_index(op.f('ix_patient_patient_id'), 'patient', ['patient_id'], unique=False)
    op.create_index(op.f('ix_patient_first_name'), 'patient', ['first_name'], unique=False)
    op.create_index(op.f('ix_patient_last_name'), 'patient', ['last_name'], unique=False)
    op.create_index(op.f('ix_patient_date_of_birth'), 'patient', ['date_of_birth'], unique=False)
    op.create_index(op.f('ix_patient_phone'), 'patient', ['phone'], unique=False)

    # 3. ADMISSION TABLE (Consolidated stay record, primary_diagnosis, arrival_datetime, discharge_datetime)
    op.create_table(
        'admission',
        sa.Column('admission_id', sa.Integer(), nullable=False, primary_key=True),
        sa.Column('patient_id', sa.Integer(), nullable=False),
        sa.Column('arrival_datetime', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('discharge_datetime', sa.DateTime(timezone=True), nullable=True),
        sa.Column('primary_diagnosis', sa.Text(), nullable=True),
        sa.Column('acuity_level', sa.String(length=10), server_default='ESI_3', nullable=False),
        sa.Column('notes', sa.Text(), nullable=True),
        sa.Column('create_datetime', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
        sa.Column('update_datetime', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
        sa.ForeignKeyConstraint(['patient_id'], ['patient.patient_id'], ondelete='RESTRICT'),
    )
    op.create_index(op.f('ix_admission_admission_id'), 'admission', ['admission_id'], unique=False)
    op.create_index(op.f('ix_admission_patient_id'), 'admission', ['patient_id'], unique=False)

    # 4. PATIENT NURSE ASSIGNMENT TABLE
    op.create_table(
        'patient_nurse_assignment',
        sa.Column('assignment_id', sa.Integer(), nullable=False, primary_key=True),
        sa.Column('admission_id', sa.Integer(), nullable=False),
        sa.Column('nurse_id', sa.Integer(), nullable=False),
        sa.Column('start_datetime', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('end_datetime', sa.DateTime(timezone=True), nullable=True),
        sa.Column('status', sa.String(length=30), server_default='ACTIVE', nullable=False),
        sa.ForeignKeyConstraint(['admission_id'], ['admission.admission_id'], ondelete='RESTRICT'),
    )
    op.create_index(op.f('ix_patient_nurse_assignment_assignment_id'), 'patient_nurse_assignment', ['assignment_id'], unique=False)
    op.create_index(op.f('ix_patient_nurse_assignment_admission_id'), 'patient_nurse_assignment', ['admission_id'], unique=False)
    op.create_index(op.f('ix_patient_nurse_assignment_nurse_id'), 'patient_nurse_assignment', ['nurse_id'], unique=False)
    op.create_index(op.f('ix_patient_nurse_assignment_status'), 'patient_nurse_assignment', ['status'], unique=False)

    # 5. BED ALLOCATION TABLE (Consolidated bed table)
    op.create_table(
        'bed_allocation',
        sa.Column('allocation_id', sa.Integer(), nullable=False, primary_key=True),
        sa.Column('bed_code', sa.String(length=30), nullable=False),
        sa.Column('department', sa.String(length=50), server_default='EMERGENCY', nullable=False),
        sa.Column('room_number', sa.String(length=20), server_default='101', nullable=False),
        sa.Column('bed_type', sa.String(length=30), server_default='STANDARD', nullable=True),
        sa.Column('status', sa.String(length=30), server_default='AVAILABLE', nullable=False),
        sa.Column('version', sa.Integer(), server_default='1', nullable=False),
        sa.Column('admission_id', sa.Integer(), nullable=True),
        sa.Column('assigned_by_personnel_id', sa.Integer(), nullable=True),
        sa.Column('start_datetime', sa.DateTime(timezone=True), nullable=True),
        sa.Column('end_datetime', sa.DateTime(timezone=True), nullable=True),
        sa.Column('update_datetime', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
        sa.Column('create_datetime', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
    )
    op.create_index(op.f('ix_bed_allocation_allocation_id'), 'bed_allocation', ['allocation_id'], unique=False)
    op.create_index(op.f('ix_bed_allocation_bed_code'), 'bed_allocation', ['bed_code'], unique=True)
    op.create_index(op.f('ix_bed_allocation_status'), 'bed_allocation', ['status'], unique=False)
    op.create_index(op.f('ix_bed_allocation_admission_id'), 'bed_allocation', ['admission_id'], unique=False)

    # 6. EQUIPMENT TYPE TABLE
    op.create_table(
        'equipment_type',
        sa.Column('equipment_type_id', sa.Integer(), nullable=False, primary_key=True),
        sa.Column('name', sa.String(length=100), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
    )
    op.create_index(op.f('ix_equipment_type_equipment_type_id'), 'equipment_type', ['equipment_type_id'], unique=False)
    op.create_index(op.f('ix_equipment_type_name'), 'equipment_type', ['name'], unique=True)

    # 7. EQUIPMENT TABLE
    op.create_table(
        'equipment',
        sa.Column('equipment_id', sa.Integer(), nullable=False, primary_key=True),
        sa.Column('equipment_type_id', sa.Integer(), nullable=False),
        sa.Column('serial_number', sa.String(length=60), nullable=False),
        sa.Column('equipment_name', sa.String(length=100), nullable=False),
        sa.Column('department', sa.String(length=50), server_default='EMERGENCY', nullable=False),
        sa.Column('status', sa.String(length=30), server_default='AVAILABLE', nullable=False),
        sa.Column('last_inspected_datetime', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
        sa.ForeignKeyConstraint(['equipment_type_id'], ['equipment_type.equipment_type_id'], ondelete='RESTRICT'),
    )
    op.create_index(op.f('ix_equipment_equipment_id'), 'equipment', ['equipment_id'], unique=False)
    op.create_index(op.f('ix_equipment_equipment_type_id'), 'equipment', ['equipment_type_id'], unique=False)
    op.create_index(op.f('ix_equipment_serial_number'), 'equipment', ['serial_number'], unique=True)
    op.create_index(op.f('ix_equipment_status'), 'equipment', ['status'], unique=False)

    # 8. EQUIPMENT ALLOCATION TABLE
    op.create_table(
        'equipment_allocation',
        sa.Column('equipment_allocation_id', sa.Integer(), nullable=False, primary_key=True),
        sa.Column('equipment_id', sa.Integer(), nullable=False),
        sa.Column('admission_id', sa.Integer(), nullable=False),
        sa.Column('allocated_by_personnel_id', sa.Integer(), nullable=True),
        sa.Column('start_datetime', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('end_datetime', sa.DateTime(timezone=True), nullable=True),
        sa.Column('status', sa.String(length=30), server_default='ACTIVE', nullable=False),
        sa.ForeignKeyConstraint(['equipment_id'], ['equipment.equipment_id'], ondelete='RESTRICT'),
    )
    op.create_index(op.f('ix_equipment_allocation_equipment_allocation_id'), 'equipment_allocation', ['equipment_allocation_id'], unique=False)
    op.create_index(op.f('ix_equipment_allocation_equipment_id'), 'equipment_allocation', ['equipment_id'], unique=False)
    op.create_index(op.f('ix_equipment_allocation_admission_id'), 'equipment_allocation', ['admission_id'], unique=False)
    op.create_index(op.f('ix_equipment_allocation_status'), 'equipment_allocation', ['status'], unique=False)

    # 9. CLEANING TASK TABLE (Linked to bed_allocation)
    op.create_table(
        'cleaning_task',
        sa.Column('cleaning_id', sa.Integer(), nullable=False, primary_key=True),
        sa.Column('allocation_id', sa.Integer(), nullable=False),
        sa.Column('personnel_id', sa.Integer(), nullable=True),
        sa.Column('status', sa.String(length=30), server_default='PENDING', nullable=False),
        sa.Column('requested_datetime', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('started_datetime', sa.DateTime(timezone=True), nullable=True),
        sa.Column('completed_datetime', sa.DateTime(timezone=True), nullable=True),
        sa.Column('disinfection_notes', sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(['allocation_id'], ['bed_allocation.allocation_id'], ondelete='RESTRICT'),
    )
    op.create_index(op.f('ix_cleaning_task_cleaning_id'), 'cleaning_task', ['cleaning_id'], unique=False)
    op.create_index(op.f('ix_cleaning_task_allocation_id'), 'cleaning_task', ['allocation_id'], unique=False)
    op.create_index(op.f('ix_cleaning_task_status'), 'cleaning_task', ['status'], unique=False)


def downgrade() -> None:
    op.drop_table('cleaning_task')
    op.drop_table('equipment_allocation')
    op.drop_table('equipment')
    op.drop_table('equipment_type')
    op.drop_table('bed_allocation')
    op.drop_table('patient_nurse_assignment')
    op.drop_table('admission')
    op.drop_table('patient')
    op.drop_table('personnel')
