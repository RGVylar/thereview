"""add media_cache table and session.current_position

Revision ID: 0004
Revises: 0003
Create Date: 2026-04-18
"""

from alembic import op
import sqlalchemy as sa

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "sessions",
        sa.Column("current_position", sa.Integer(), nullable=False, server_default="0"),
    )

    op.create_table(
        "media_cache",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("session_id", sa.Integer(), sa.ForeignKey("sessions.id", ondelete="CASCADE"), nullable=False),
        sa.Column("meme_id", sa.Integer(), sa.ForeignKey("memes.id", ondelete="CASCADE"), nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default="pending"),
        sa.Column("error", sa.Text(), nullable=True),
        sa.UniqueConstraint("session_id", "meme_id", name="uq_media_session_meme"),
    )


def downgrade() -> None:
    op.drop_table("media_cache")
    op.drop_column("sessions", "current_position")
