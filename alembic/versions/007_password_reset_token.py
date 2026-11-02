"""Password reset token and session invalidation tracking on personnel table

Revision ID: 007_password_reset_token
Revises: 006_cleaning_task_uq
Create Date: 2026-09-27 12:00:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '007_password_reset_token'
down_revision: Union[str, None] = '006_cleaning_task_uq'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Add reset_token_hash and reset_token_expires_at to personnel
    op.add_column(
        'personnel',
        sa.Column('reset_token_hash', sa.String(255), nullable=True)
    )
    op.add_column(
        'personnel',
        sa.Column('reset_token_expires_at', sa.DateTime(timezone=True), nullable=True)
    )

    # 2. Add token_version to personnel to support active session/JWT invalidation upon reset
    op.add_column(
        'personnel',
        sa.Column('token_version', sa.Integer(), nullable=False, server_default='1')
    )

    # 3. Create index on reset_token_hash for fast lookups
    op.create_index(
        op.f('ix_personnel_reset_token_hash'),
        'personnel',
        ['reset_token_hash'],
        unique=False
    )


def downgrade() -> None:
    op.drop_index(op.f('ix_personnel_reset_token_hash'), table_name='personnel')
    op.drop_column('personnel', 'token_version')
    op.drop_column('personnel', 'reset_token_expires_at')
    op.drop_column('personnel', 'reset_token_hash')
