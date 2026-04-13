"""unique constraint on (user_id, url) in memes

Revision ID: 0002
Revises: 0001
Create Date: 2026-04-13

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0002"
down_revision: Union[str, None] = "0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Remove duplicate rows (keep oldest) before adding constraint
    op.execute("""
        DELETE FROM memes
        WHERE id NOT IN (
            SELECT MIN(id)
            FROM memes
            GROUP BY user_id, url
        )
    """)
    op.create_unique_constraint("uq_user_meme_url", "memes", ["user_id", "url"])


def downgrade() -> None:
    op.drop_constraint("uq_user_meme_url", "memes", type_="unique")
