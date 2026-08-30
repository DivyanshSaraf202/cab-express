import os

class Config:
    """Application configuration parameters."""
    SECRET_KEY = os.environ.get('SECRET_KEY') or 'cab-express-secret-key'
    DATABASE_PATH = os.path.join(os.path.abspath(os.path.dirname(__file__)), 'app', 'cab_system.db')
