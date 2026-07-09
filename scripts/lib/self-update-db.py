#!/usr/bin/env python3
"""Safe sqlite helpers for forge-self-update.sh (parameterized, no string interpolation)."""

from __future__ import annotations

import argparse
import sqlite3
import sys
import time
from pathlib import Path


def connect(db_path: str) -> sqlite3.Connection:
    return sqlite3.connect(db_path)


def append_log(conn: sqlite3.Connection, update_id: str, message: str) -> None:
    conn.execute(
        "UPDATE forge_updates SET logs = COALESCE(logs, '') || ? || char(10) WHERE id = ?",
        (message, update_id),
    )
    conn.commit()


def set_status(
    conn: sqlite3.Connection,
    update_id: str,
    status: str,
    *,
    error: str | None = None,
    clear_error: bool = False,
    completed: bool = False,
    target_commit: str | None = None,
    previous_commit: str | None = None,
) -> None:
    fields: list[str] = ["status = ?"]
    values: list[object] = [status]

    if clear_error:
        fields.append("error_message = NULL")
    elif error is not None:
        fields.append("error_message = ?")
        values.append(error)

    if completed:
        fields.append("completed_at = ?")
        values.append(int(time.time()))

    if target_commit is not None:
        fields.append("target_commit_sha = ?")
        values.append(target_commit)

    if previous_commit is not None:
        fields.append("previous_commit_sha = ?")
        values.append(previous_commit)

    values.append(update_id)
    conn.execute(
        f"UPDATE forge_updates SET {', '.join(fields)} WHERE id = ?",
        values,
    )
    conn.commit()


def set_previous_commit(
    conn: sqlite3.Connection, update_id: str, previous_commit: str
) -> None:
    conn.execute(
        "UPDATE forge_updates SET previous_commit_sha = ? WHERE id = ?",
        (previous_commit, update_id),
    )
    conn.commit()


def get_error_message(conn: sqlite3.Connection, update_id: str) -> str:
    row = conn.execute(
        "SELECT COALESCE(error_message, '') FROM forge_updates WHERE id = ?",
        (update_id,),
    ).fetchone()
    return row[0] if row else ""


def main() -> int:
    parser = argparse.ArgumentParser(description="Forge self-update DB helper")
    parser.add_argument("--db", required=True)
    parser.add_argument("--update-id", required=True)
    sub = parser.add_subparsers(dest="command", required=True)

    log_cmd = sub.add_parser("log")
    log_cmd.add_argument("message")

    status_cmd = sub.add_parser("status")
    status_cmd.add_argument("status")
    status_cmd.add_argument("--error")
    status_cmd.add_argument("--clear-error", action="store_true")
    status_cmd.add_argument("--completed", action="store_true")
    status_cmd.add_argument("--target-commit")
    status_cmd.add_argument("--previous-commit")

    prev_cmd = sub.add_parser("previous-commit")
    prev_cmd.add_argument("sha")

    error_cmd = sub.add_parser("get-error")

    args = parser.parse_args()
    db_path = Path(args.db)
    if not db_path.is_file():
        return 0

    conn = connect(str(db_path))
    try:
        if args.command == "log":
            append_log(conn, args.update_id, args.message)
            return 0

        if args.command == "status":
            set_status(
                conn,
                args.update_id,
                args.status,
                error=args.error,
                clear_error=args.clear_error,
                completed=args.completed,
                target_commit=args.target_commit,
                previous_commit=args.previous_commit,
            )
            return 0

        if args.command == "previous-commit":
            set_previous_commit(conn, args.update_id, args.sha)
            return 0

        if args.command == "get-error":
            print(get_error_message(conn, args.update_id))
            return 0
    finally:
        conn.close()

    return 1


if __name__ == "__main__":
    sys.exit(main())
