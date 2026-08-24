import sqlite3, os
from flask import current_app
from flask_login import UserMixin

def get_db(db_path=None):
    if not db_path:
        try: db_path = current_app.config['DATABASE_PATH']
        except Exception:
            from config import Config
            db_path = Config.DATABASE_PATH
    os.makedirs(os.path.dirname(db_path), exist_ok=True)
    conn = sqlite3.connect(db_path, timeout=10, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn

def init_db(db_path=None):
    with get_db(db_path) as conn:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL, email TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'passenger'
            );
            CREATE TABLE IF NOT EXISTS rides (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                passenger_id INTEGER NOT NULL, passenger_name TEXT NOT NULL,
                driver_id INTEGER DEFAULT NULL, driver_name TEXT DEFAULT NULL,
                pickup_address TEXT NOT NULL, pickup_lat REAL NOT NULL, pickup_lng REAL NOT NULL,
                dropoff_address TEXT NOT NULL, dropoff_lat REAL NOT NULL, dropoff_lng REAL NOT NULL,
                fare REAL NOT NULL, status TEXT DEFAULT 'pending',
                driver_lat REAL DEFAULT NULL, driver_lng REAL DEFAULT NULL,
                otp TEXT DEFAULT NULL, rating INTEGER DEFAULT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        """)

class User(UserMixin):
    def __init__(self, id, username, email, role):
        self.id, self.username, self.email, self.role = id, username, email, role

    @staticmethod
    def get_by_id(uid, db_path=None):
        with get_db(db_path) as conn:
            u = conn.execute("SELECT * FROM users WHERE id = ?", (uid,)).fetchone()
            return User(u['id'], u['username'], u['email'], u['role']) if u else None

    @staticmethod
    def get_by_username(uname, db_path=None):
        with get_db(db_path) as conn:
            return conn.execute("SELECT * FROM users WHERE username = ?", (uname,)).fetchone()
