import sqlite3
import os
import logging
from flask import current_app
from flask_login import UserMixin

logger = logging.getLogger(__name__)


def get_db(db_path=None):
    """Connect to SQLite database."""
    if not db_path:
        try:
            db_path = current_app.config['DATABASE_PATH']
        except Exception:
            from config import Config
            db_path = Config.DATABASE_PATH

    os.makedirs(os.path.dirname(db_path), exist_ok=True)
    conn = sqlite3.connect(db_path, timeout=10, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn


def init_db(db_path=None):
    """Initialize database tables for users and rides."""
    with get_db(db_path) as conn:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL,
                email TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                role TEXT NOT NULL DEFAULT 'passenger'
            );

            CREATE TABLE IF NOT EXISTS rides (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                passenger_id INTEGER NOT NULL,
                passenger_name TEXT NOT NULL,
                driver_id INTEGER DEFAULT NULL,
                driver_name TEXT DEFAULT NULL,
                pickup_address TEXT NOT NULL,
                pickup_lat REAL NOT NULL,
                pickup_lng REAL NOT NULL,
                dropoff_address TEXT NOT NULL,
                dropoff_lat REAL NOT NULL,
                dropoff_lng REAL NOT NULL,
                fare REAL NOT NULL,
                status TEXT DEFAULT 'pending',
                driver_lat REAL DEFAULT NULL,
                driver_lng REAL DEFAULT NULL,
                otp TEXT DEFAULT NULL,
                rating INTEGER DEFAULT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        """)


class User(UserMixin):
    """Flask-Login User Model Class."""
    def __init__(self, user_id, username, email, role):
        self.id = user_id
        self.username = username
        self.email = email
        self.role = role

    @staticmethod
    def get_by_id(user_id, db_path=None):
        """Fetch user by primary key ID."""
        with get_db(db_path) as conn:
            row = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
            if row:
                return User(row['id'], row['username'], row['email'], row['role'])
            return None

    @staticmethod
    def get_by_username(username, db_path=None):
        """Fetch user row dictionary by username."""
        with get_db(db_path) as conn:
            return conn.execute("SELECT * FROM users WHERE username = ?", (username,)).fetchone()
