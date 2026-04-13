"""add started_at, meme_limit, mix_mode to sessions

Revision ID: 0003
Revises: 0002
Create Date: 2025-07-17
"""

from alembic import op
import sqlalchemy as sa

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("sessions", sa.Column("started_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("sessions", sa.Column("meme_limit", sa.Integer(), nullable=True))
    op.add_column("sessions", sa.Column("mix_mode", sa.String(20), nullable=False, server_default="shuffle"))


def downgrade() -> None:
    op.drop_column("sessions", "mix_mode")
    op.drop_column("sessions", "meme_limit")
    op.drop_column("sessions", "started_at")
