"""add media_cache.metadata and super_favorites table

Revision ID: 0006
Revises: 0005
Create Date: 2026-04-19
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)

    # Add metadata column only if it doesn't already exist
    existing_cols = [c["name"] for c in inspector.get_columns("media_cache")]
    if "metadata" not in existing_cols:
        op.add_column("media_cache", sa.Column("metadata", sa.Text(), nullable=True))

    # Create super_favorites only if it doesn't already exist
    if "super_favorites" not in inspector.get_table_names():
        op.create_table(
            "super_favorites",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("meme_id", sa.Integer(), nullable=False),
            sa.Column("session_id", sa.Integer(), nullable=False),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                server_default=sa.text("CURRENT_TIMESTAMP"),
                nullable=False,
            ),
            sa.ForeignKeyConstraint(["meme_id"], ["memes.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["session_id"], ["sessions.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("meme_id", name="uq_superfav_meme"),
        )


def downgrade() -> None:
    op.drop_table("super_favorites")
    op.drop_column("media_cache", "metadata")
