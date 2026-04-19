"""add session_memes.extra_count for duplicate URL tracking

Revision ID: 0005
Revises: 0004
Create Date: 2026-04-19
"""

from alembic import op
import sqlalchemy as sa

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "session_memes",
        sa.Column("extra_count", sa.Integer(), nullable=False, server_default="0"),
    )


def downgrade() -> None:
    op.drop_column("session_memes", "extra_count")
